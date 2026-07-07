const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbFile = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function checkpointDb() {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
}

db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        content TEXT NOT NULL,
        file_name TEXT,
        file_size TEXT,
        file_icon TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id, created_at);
`);

function nowIso() {
    return new Date().toISOString();
}

function getGroupMemberIds(groupId) {
    return db.prepare('SELECT user_id FROM group_members WHERE group_id = ?')
        .all(groupId)
        .map((row) => row.user_id);
}

function getGroupMembers(groupId) {
    return db.prepare(`
        SELECT u.id, u.display_name AS displayName, u.avatar_url AS avatarUrl
        FROM group_members gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ?
        ORDER BY u.display_name
    `).all(groupId);
}

function mapGroupRow(row) {
    return {
        id: row.id,
        name: row.name,
        createdBy: row.created_by,
        createdAt: row.created_at,
        members: getGroupMembers(row.id)
    };
}

function isGroupMember(groupId, userId) {
    return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}

function createGroup({ name, creatorId, memberIds = [] }) {
    const cleanedName = String(name || '').trim();
    if (!cleanedName) {
        throw new Error('Group name is required.');
    }

    const uniqueMemberIds = Array.from(new Set([creatorId, ...memberIds.map(String)]));
    if (uniqueMemberIds.length < 2) {
        throw new Error('Pick at least one other member.');
    }

    const id = crypto.randomUUID();
    const createdAt = nowIso();

    const tx = db.transaction(() => {
        db.prepare('INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, ?, ?)')
            .run(id, cleanedName, creatorId, createdAt);

        const insertMember = db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)');
        for (const memberId of uniqueMemberIds) {
            insertMember.run(id, memberId, createdAt);
        }
    });
    tx();

    return mapGroupRow(db.prepare('SELECT * FROM groups WHERE id = ?').get(id));
}

function getUserGroups(userId) {
    const rows = db.prepare(`
        SELECT g.*
        FROM groups g
        JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.user_id = ?
        ORDER BY g.created_at DESC
    `).all(userId);

    return rows.map(mapGroupRow);
}

function getGroup(groupId) {
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    return row ? mapGroupRow(row) : null;
}

function addGroupMember(groupId, userId) {
    if (isGroupMember(groupId, userId)) return;
    db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
        .run(groupId, userId, nowIso());
}

function leaveGroup(groupId, userId) {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);

    const remaining = db.prepare('SELECT COUNT(*) AS count FROM group_members WHERE group_id = ?').get(groupId).count;
    if (remaining === 0) {
        db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
    }
}

function saveGroupMessage({ groupId, senderId, type, content, name, size, icon, clientTime }) {
    const id = crypto.randomUUID();
    const createdAt = clientTime ? new Date(clientTime).toISOString() : nowIso();

    db.prepare(`
        INSERT INTO group_messages (id, group_id, sender_id, type, content, file_name, file_size, file_icon, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, groupId, senderId, type || 'text', String(content), name || null, size || null, icon || null, createdAt);

    return {
        id,
        groupId,
        senderId,
        type: type || 'text',
        content: String(content),
        name: name || undefined,
        size: size || undefined,
        icon: icon || undefined,
        time: new Date(createdAt).getTime()
    };
}

function getGroupMessages(groupId, viewerId, { limit = 100 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const rows = db.prepare(`
        SELECT gm.*, u.display_name AS sender_name, u.avatar_url AS sender_avatar
        FROM group_messages gm
        JOIN users u ON u.id = gm.sender_id
        WHERE gm.group_id = ?
        ORDER BY gm.created_at ASC
        LIMIT ?
    `).all(groupId, safeLimit);

    return rows.map((row) => ({
        id: row.id,
        senderId: row.sender_id,
        senderName: row.sender_name,
        senderAvatarUrl: row.sender_avatar || '',
        sentByMe: row.sender_id === viewerId,
        type: row.type,
        content: row.content,
        name: row.file_name || undefined,
        size: row.file_size || undefined,
        icon: row.file_icon || undefined,
        time: new Date(row.created_at).getTime()
    }));
}

module.exports = {
    checkpointDb,
    createGroup,
    getUserGroups,
    getGroup,
    getGroupMemberIds,
    getGroupMembers,
    isGroupMember,
    addGroupMember,
    leaveGroup,
    saveGroupMessage,
    getGroupMessages
};
