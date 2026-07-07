const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'app.db');
const legacyJsonFile = path.join(dataDir, 'accounts.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('wal_autocheckpoint = 1000');

function closeDb() {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    try { db.close(); } catch (_) {}
}

function checkpointDb() {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
}

process.once('exit', closeDb);
process.once('SIGINT', () => { closeDb(); process.exit(0); });
process.once('SIGTERM', () => { closeDb(); process.exit(0); });

db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT NOT NULL DEFAULT '',
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        last_ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_ip_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
    CREATE INDEX IF NOT EXISTS idx_device_ip_history_device_id ON device_ip_history(device_id);
    CREATE INDEX IF NOT EXISTS idx_device_ip_history_user_id ON device_ip_history(user_id);
`);

function nowIso() {
    return new Date().toISOString();
}

function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
}

function sanitizeDeviceName(deviceName) {
    const value = String(deviceName || '').trim();
    return value || 'Unknown device';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
    const { hash } = hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createToken() {
    return crypto.randomBytes(32).toString('hex');
}

function mapUserRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || '',
        passwordSalt: row.password_salt,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastSeenAt: row.last_seen_at || null
    };
}

function mapDeviceRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        tokenHash: row.token_hash,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at || null,
        lastIp: row.last_ip || '',
        userAgent: row.user_agent || '',
        revokedAt: row.revoked_at || null
    };
}

function getMeta(key) {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setMeta(key, value) {
    db.prepare(`
        INSERT INTO meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
}

function importLegacyJsonIfNeeded() {
    const alreadyMigrated = getMeta('legacy_accounts_json_migrated');
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;

    if (alreadyMigrated === '1' || userCount > 0 || !fs.existsSync(legacyJsonFile)) {
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(legacyJsonFile, 'utf8'));
    } catch (error) {
        setMeta('legacy_accounts_json_migrated', '1');
        return;
    }

    const accounts = Array.isArray(parsed && parsed.accounts) ? parsed.accounts : [];
    if (!accounts.length) {
        setMeta('legacy_accounts_json_migrated', '1');
        return;
    }

    const insertUser = db.prepare(`
        INSERT OR IGNORE INTO users (
            id, username, display_name, avatar_url, password_salt, password_hash,
            created_at, updated_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertDevice = db.prepare(`
        INSERT OR IGNORE INTO devices (
            id, user_id, name, token_hash, created_at, last_seen_at, last_ip, user_agent, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const migrate = db.transaction(() => {
        for (const account of accounts) {
            insertUser.run(
                account.id,
                normalizeUsername(account.username),
                String(account.displayName || account.username || 'User'),
                String(account.avatarUrl || ''),
                String(account.passwordSalt || ''),
                String(account.passwordHash || ''),
                String(account.createdAt || nowIso()),
                String(account.updatedAt || account.createdAt || nowIso()),
                account.lastSeenAt || account.updatedAt || account.createdAt || nowIso()
            );

            const devices = Array.isArray(account.devices) ? account.devices : [];
            for (const device of devices) {
                insertDevice.run(
                    device.id || crypto.randomUUID(),
                    account.id,
                    sanitizeDeviceName(device.name),
                    String(device.tokenHash || ''),
                    String(device.createdAt || nowIso()),
                    device.lastSeenAt || device.createdAt || nowIso(),
                    String(device.lastIp || ''),
                    String(device.userAgent || ''),
                    device.revokedAt || null
                );
            }
        }
    });

    migrate();
    setMeta('legacy_accounts_json_migrated', '1');
}

importLegacyJsonIfNeeded();

function getUserById(userId) {
    return mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

function getUserByUsername(username) {
    return mapUserRow(db.prepare('SELECT * FROM users WHERE username = ?').get(normalizeUsername(username)));
}

function getDeviceByTokenHash(tokenHash) {
    return mapDeviceRow(db.prepare(`
        SELECT * FROM devices
        WHERE token_hash = ? AND revoked_at IS NULL
    `).get(tokenHash));
}

function insertIpHistory(deviceId, userId, ipAddress, userAgent, eventType, seenAt = nowIso()) {
    const normalizedIp = String(ipAddress || '').trim();
    if (!normalizedIp) return;

    const previous = db.prepare(`
        SELECT ip_address, user_agent, event_type
        FROM device_ip_history
        WHERE device_id = ?
        ORDER BY id DESC
        LIMIT 1
    `).get(deviceId);

    if (
        previous &&
        previous.ip_address === normalizedIp &&
        previous.user_agent === String(userAgent || '') &&
        previous.event_type === String(eventType || 'activity')
    ) {
        return;
    }

    db.prepare(`
        INSERT INTO device_ip_history (
            device_id, user_id, ip_address, user_agent, event_type, seen_at
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        deviceId,
        userId,
        normalizedIp,
        String(userAgent || ''),
        String(eventType || 'activity'),
        seenAt
    );
}

function getPublicAccount(user, options = {}) {
    const activeCount = options.activeCount || 0;
    const deviceCountRow = db.prepare(`
        SELECT COUNT(*) AS count
        FROM devices
        WHERE user_id = ? AND revoked_at IS NULL
    `).get(user.id);

    return {
        id: user.id,
        username: user.username,
        name: user.displayName,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl || '',
        online: activeCount > 0,
        status: activeCount > 0 ? 'online' : 'offline',
        lastSeen: user.lastSeenAt || null,
        deviceCount: deviceCountRow ? deviceCountRow.count : 0
    };
}

function getSessionAccount(user, activeCount = 0) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl || '',
        online: activeCount > 0,
        status: activeCount > 0 ? 'online' : 'offline',
        lastSeen: user.lastSeenAt || null
    };
}

function getDeviceSummary(device, activeDeviceIds = new Set(), currentDeviceId = null) {
    return {
        id: device.id,
        name: device.name,
        current: device.id === currentDeviceId,
        online: activeDeviceIds.has(device.id),
        createdAt: device.createdAt,
        lastSeen: device.lastSeenAt || null,
        lastIp: device.lastIp || '',
        userAgent: device.userAgent || ''
    };
}

function registerAccount({ username, password, displayName, deviceName, userAgent, ip }) {
    const normalized = normalizeUsername(username);
    const cleanedDisplayName = String(displayName || '').trim();
    const cleanedPassword = String(password || '');

    if (!normalized || normalized.length < 3) {
        throw new Error('Username must be at least 3 characters.');
    }

    if (cleanedPassword.length < 6) {
        throw new Error('Password must be at least 6 characters.');
    }

    if (!cleanedDisplayName) {
        throw new Error('Display name is required.');
    }

    if (getUserByUsername(normalized)) {
        throw new Error('This username is already in use.');
    }

    const passwordInfo = hashPassword(cleanedPassword);
    const token = createToken();
    const issuedAt = nowIso();
    const userId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();

    const insert = db.transaction(() => {
        db.prepare(`
            INSERT INTO users (
                id, username, display_name, avatar_url, password_salt, password_hash,
                created_at, updated_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            normalized,
            cleanedDisplayName,
            '',
            passwordInfo.salt,
            passwordInfo.hash,
            issuedAt,
            issuedAt,
            issuedAt
        );

        db.prepare(`
            INSERT INTO devices (
                id, user_id, name, token_hash, created_at, last_seen_at, last_ip, user_agent, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
            deviceId,
            userId,
            sanitizeDeviceName(deviceName),
            hashToken(token),
            issuedAt,
            issuedAt,
            ip || '',
            userAgent || ''
        );

        insertIpHistory(
            deviceId,
            userId,
            ip || '',
            userAgent || '',
            'register',
            issuedAt
        );
    });

    insert();

    return {
        token,
        account: getUserById(userId),
        deviceId
    };
}

function loginAccount({ username, password, deviceName, userAgent, ip }) {
    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        throw new Error('Invalid username or password.');
    }

    const token = createToken();
    const issuedAt = nowIso();
    const deviceId = crypto.randomUUID();

    const insert = db.transaction(() => {
        db.prepare(`
            INSERT INTO devices (
                id, user_id, name, token_hash, created_at, last_seen_at, last_ip, user_agent, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
            deviceId,
            user.id,
            sanitizeDeviceName(deviceName),
            hashToken(token),
            issuedAt,
            issuedAt,
            ip || '',
            userAgent || ''
        );

        insertIpHistory(
            deviceId,
            user.id,
            ip || '',
            userAgent || '',
            'login',
            issuedAt
        );

        db.prepare(`
            UPDATE users
            SET updated_at = ?, last_seen_at = ?
            WHERE id = ?
        `).run(issuedAt, issuedAt, user.id);
    });

    insert();

    return {
        token,
        account: getUserById(user.id),
        deviceId
    };
}

function authenticateToken(token) {
    const tokenDigest = hashToken(token);
    const device = getDeviceByTokenHash(tokenDigest);
    if (!device) return null;

    const account = getUserById(device.userId);
    if (!account) return null;

    return { account, device };
}

function touchSession(token, { ip, userAgent } = {}) {
    const session = authenticateToken(token);
    if (!session) return null;

    const touchedAt = nowIso();
    const nextIp = ip || session.device.lastIp || '';
    const nextUserAgent = userAgent || session.device.userAgent || '';
    const tx = db.transaction(() => {
        db.prepare(`
            UPDATE devices
            SET last_seen_at = ?, last_ip = ?, user_agent = ?
            WHERE id = ?
        `).run(
            touchedAt,
            nextIp,
            nextUserAgent,
            session.device.id
        );

        insertIpHistory(
            session.device.id,
            session.account.id,
            nextIp,
            nextUserAgent,
            'activity',
            touchedAt
        );

        db.prepare(`
            UPDATE users
            SET last_seen_at = ?, updated_at = ?
            WHERE id = ?
        `).run(touchedAt, touchedAt, session.account.id);
    });

    tx();
    return {
        account: getUserById(session.account.id),
        device: mapDeviceRow(db.prepare('SELECT * FROM devices WHERE id = ?').get(session.device.id))
    };
}

function logoutToken(token) {
    const session = authenticateToken(token);
    if (!session) return null;

    const revokedAt = nowIso();
    const tx = db.transaction(() => {
        db.prepare(`
            UPDATE devices
            SET revoked_at = ?
            WHERE id = ?
        `).run(revokedAt, session.device.id);

        db.prepare(`
            UPDATE users
            SET updated_at = ?
            WHERE id = ?
        `).run(revokedAt, session.account.id);
    });

    tx();

    return {
        accountId: session.account.id,
        deviceId: session.device.id
    };
}

function updateProfile(accountId, { displayName, avatarUrl }) {
    const user = getUserById(accountId);
    if (!user) {
        throw new Error('Account not found.');
    }

    const nextDisplayName = displayName !== undefined ? String(displayName || '').trim() : user.displayName;
    if (!nextDisplayName) {
        throw new Error('Display name cannot be empty.');
    }

    const nextAvatarUrl = avatarUrl !== undefined ? (avatarUrl || '') : user.avatarUrl;
    const updatedAt = nowIso();

    db.prepare(`
        UPDATE users
        SET display_name = ?, avatar_url = ?, updated_at = ?
        WHERE id = ?
    `).run(nextDisplayName, nextAvatarUrl, updatedAt, accountId);

    return getUserById(accountId);
}

function revokeDevice(accountId, deviceId) {
    const device = mapDeviceRow(db.prepare(`
        SELECT * FROM devices
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    `).get(deviceId, accountId));

    if (!device) {
        throw new Error('Device not found.');
    }

    const revokedAt = nowIso();
    db.prepare(`
        UPDATE devices
        SET revoked_at = ?
        WHERE id = ?
    `).run(revokedAt, deviceId);

    db.prepare(`
        UPDATE users
        SET updated_at = ?
        WHERE id = ?
    `).run(revokedAt, accountId);

    return { accountId, deviceId };
}

function markAccountOffline(accountId) {
    const user = getUserById(accountId);
    if (!user) return null;

    const updatedAt = nowIso();
    db.prepare(`
        UPDATE users
        SET last_seen_at = ?, updated_at = ?
        WHERE id = ?
    `).run(updatedAt, updatedAt, accountId);

    return getUserById(accountId);
}

function listPublicAccounts(activeCounts = new Map()) {
    const rows = db.prepare('SELECT * FROM users ORDER BY username').all();
    return rows.map((row) => getPublicAccount(mapUserRow(row), {
        activeCount: activeCounts.get(row.id) || 0
    }));
}

function getSessionPayload(accountId, currentDeviceId, activeDeviceIds = new Set(), activeCount = 0) {
    const user = getUserById(accountId);
    if (!user) return null;

    const devices = db.prepare(`
        SELECT * FROM devices
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, COALESCE(last_seen_at, created_at) DESC
    `).all(accountId, currentDeviceId).map(mapDeviceRow);

    return {
        account: getSessionAccount(user, activeCount),
        devices: devices.map((device) => getDeviceSummary(device, activeDeviceIds, currentDeviceId))
    };
}

// ─── Admin functions ──────────────────────────────────────────────────────────

function adminListUsers() {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
    return rows.map((row) => {
        const user = mapUserRow(row);
        const deviceRows = db.prepare(
            'SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC'
        ).all(user.id).map(mapDeviceRow);
        return {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl || '',
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastSeenAt: user.lastSeenAt || null,
            devices: deviceRows.map((d) => ({
                id: d.id,
                name: d.name,
                createdAt: d.createdAt,
                lastSeenAt: d.lastSeenAt || null,
                lastIp: d.lastIp || '',
                revoked: !!d.revokedAt
            }))
        };
    });
}

function adminGetUser(userId) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!row) return null;
    const user = mapUserRow(row);
    const deviceRows = db.prepare(
        'SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC'
    ).all(user.id).map(mapDeviceRow);
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl || '',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastSeenAt: user.lastSeenAt || null,
        devices: deviceRows.map((d) => ({
            id: d.id,
            name: d.name,
            createdAt: d.createdAt,
            lastSeenAt: d.lastSeenAt || null,
            lastIp: d.lastIp || '',
            revoked: !!d.revokedAt
        }))
    };
}

function adminUpdateUser(userId, { username, displayName, password }) {
    const user = getUserById(userId);
    if (!user) throw new Error('User not found.');

    const updatedAt = nowIso();
    const updates = [];
    const params = [];

    if (username !== undefined) {
        const normalized = normalizeUsername(username);
        if (!normalized || normalized.length < 3) throw new Error('Username must be at least 3 characters.');
        const existing = getUserByUsername(normalized);
        if (existing && existing.id !== userId) throw new Error('Username already in use.');
        updates.push('username = ?');
        params.push(normalized);
    }

    if (displayName !== undefined) {
        const clean = String(displayName || '').trim();
        if (!clean) throw new Error('Display name cannot be empty.');
        updates.push('display_name = ?');
        params.push(clean);
    }

    if (password !== undefined) {
        const clean = String(password || '');
        if (clean.length < 4) throw new Error('Password must be at least 4 characters.');
        const { salt, hash } = hashPassword(clean);
        updates.push('password_salt = ?', 'password_hash = ?');
        params.push(salt, hash);

        // Revoke all existing sessions so user must log in again with new password
        db.prepare(`UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
            .run(updatedAt, userId);
    }

    if (!updates.length) throw new Error('Nothing to update.');

    updates.push('updated_at = ?');
    params.push(updatedAt, userId);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return adminGetUser(userId);
}

function adminDeleteUser(userId) {
    const user = getUserById(userId);
    if (!user) throw new Error('User not found.');
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return { deleted: true, userId };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    checkpointDb,
    authenticateToken,
    getSessionPayload,
    listPublicAccounts,
    loginAccount,
    logoutToken,
    markAccountOffline,
    registerAccount,
    revokeDevice,
    touchSession,
    updateProfile,
    adminListUsers,
    adminGetUser,
    adminUpdateUser,
    adminDeleteUser
};
