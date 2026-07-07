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
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_recipient_pending ON messages(recipient_id, delivered_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, recipient_id, created_at);
`);

const messageColumns = db.prepare('PRAGMA table_info(messages)').all().map((col) => col.name);
if (!messageColumns.includes('read_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN read_at TEXT');
}
if (!messageColumns.includes('file_name')) {
    db.exec('ALTER TABLE messages ADD COLUMN file_name TEXT');
}
if (!messageColumns.includes('file_size')) {
    db.exec('ALTER TABLE messages ADD COLUMN file_size TEXT');
}
if (!messageColumns.includes('file_icon')) {
    db.exec('ALTER TABLE messages ADD COLUMN file_icon TEXT');
}

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread ON messages(recipient_id, sender_id, read_at);
`);

function nowIso() {
    return new Date().toISOString();
}

function mapMessageRow(row, viewerId) {
    const delivered = !!row.delivered_at;
    const sentByMe = row.sender_id === viewerId;
    return {
        id: row.id,
        type: row.type,
        content: row.content,
        name: row.file_name || undefined,
        size: row.file_size || undefined,
        icon: row.file_icon || undefined,
        time: new Date(row.created_at).getTime(),
        sentByMe,
        delivered,
        queued: sentByMe && !delivered,
        read: delivered && sentByMe
    };
}

function saveMessage({ senderId, recipientId, type, content, clientTime, name, size, icon }) {
    const id = crypto.randomUUID();
    const createdAt = clientTime ? new Date(clientTime).toISOString() : nowIso();

    db.prepare(`
        INSERT INTO messages (id, sender_id, recipient_id, type, content, created_at, delivered_at, file_name, file_size, file_icon)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(id, senderId, recipientId, type || 'text', String(content), createdAt, name || null, size || null, icon || null);

    return {
        id,
        type: type || 'text',
        content: String(content),
        name: name || undefined,
        size: size || undefined,
        icon: icon || undefined,
        time: new Date(createdAt).getTime()
    };
}

function markDelivered(messageIds) {
    if (!messageIds.length) return;

    const deliveredAt = nowIso();
    const stmt = db.prepare('UPDATE messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL');
    const txn = db.transaction((ids) => {
        for (const id of ids) {
            stmt.run(deliveredAt, id);
        }
    });
    txn(messageIds);
}

function markRead(viewerId, otherUserId) {
    db.prepare(`
        UPDATE messages SET read_at = ?
        WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL
    `).run(nowIso(), viewerId, otherUserId);
}

function getUnreadCounts(viewerId) {
    const rows = db.prepare(`
        SELECT sender_id AS senderId, COUNT(*) AS count
        FROM messages
        WHERE recipient_id = ? AND read_at IS NULL
        GROUP BY sender_id
    `).all(viewerId);

    const counts = {};
    rows.forEach((row) => {
        counts[row.senderId] = row.count;
    });
    return counts;
}

function getPendingMessages(recipientId) {
    const rows = db.prepare(`
        SELECT m.*, u.display_name AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.recipient_id = ? AND m.delivered_at IS NULL
        ORDER BY m.created_at ASC
    `).all(recipientId);

    return rows.map((row) => ({
        sender: row.sender_id,
        senderName: row.sender_name,
        message: {
            id: row.id,
            type: row.type,
            content: row.content,
            name: row.file_name || undefined,
            size: row.file_size || undefined,
            icon: row.file_icon || undefined,
            time: new Date(row.created_at).getTime()
        }
    }));
}

function getConversationHistory(userId, otherUserId, { limit = 100, before } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    let query = `
        SELECT * FROM messages
        WHERE (sender_id = ? AND recipient_id = ?)
           OR (sender_id = ? AND recipient_id = ?)
    `;
    const params = [userId, otherUserId, otherUserId, userId];

    if (before) {
        query += ' AND created_at < ?';
        params.push(new Date(before).toISOString());
    }

    query += ' ORDER BY created_at ASC LIMIT ?';
    params.push(safeLimit);

    const rows = db.prepare(query).all(...params);
    return rows.map((row) => mapMessageRow(row, userId));
}

function userExists(userId) {
    return !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
}

function deleteConversation(userId, otherUserId) {
    db.prepare(`
        DELETE FROM messages
        WHERE (sender_id = ? AND recipient_id = ?)
           OR (sender_id = ? AND recipient_id = ?)
    `).run(userId, otherUserId, otherUserId, userId);
}

module.exports = {
    checkpointDb,
    saveMessage,
    markDelivered,
    markRead,
    getUnreadCounts,
    getPendingMessages,
    getConversationHistory,
    userExists,
    deleteConversation
};
