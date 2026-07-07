const path = require('path');
const Database = require('better-sqlite3');

const dbFile = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS folder_meta (
        path TEXT PRIMARY KEY,
        color TEXT
    );
`);

function normalizePath(relPath) {
    return String(relPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function setFolderColor(relPath, color) {
    const key = normalizePath(relPath);
    if (!key) return;

    if (!color) {
        db.prepare('DELETE FROM folder_meta WHERE path = ?').run(key);
        return;
    }

    db.prepare(`
        INSERT INTO folder_meta (path, color) VALUES (?, ?)
        ON CONFLICT(path) DO UPDATE SET color = excluded.color
    `).run(key, color);
}

function getFolderColors() {
    const rows = db.prepare('SELECT path, color FROM folder_meta').all();
    const map = {};
    rows.forEach((row) => {
        map[row.path] = row.color;
    });
    return map;
}

function renameFolderMeta(oldRelPath, newRelPath) {
    const oldKey = normalizePath(oldRelPath);
    const newKey = normalizePath(newRelPath);
    const rows = db.prepare('SELECT path, color FROM folder_meta WHERE path = ? OR path LIKE ?')
        .all(oldKey, `${oldKey}/%`);

    const txn = db.transaction(() => {
        rows.forEach((row) => {
            const updatedPath = row.path === oldKey ? newKey : newKey + row.path.slice(oldKey.length);
            db.prepare('DELETE FROM folder_meta WHERE path = ?').run(row.path);
            if (row.color) {
                db.prepare(`
                    INSERT INTO folder_meta (path, color) VALUES (?, ?)
                    ON CONFLICT(path) DO UPDATE SET color = excluded.color
                `).run(updatedPath, row.color);
            }
        });
    });
    txn();
}

function deleteFolderMetaTree(relPath) {
    const key = normalizePath(relPath);
    db.prepare('DELETE FROM folder_meta WHERE path = ? OR path LIKE ?').run(key, `${key}/%`);
}

module.exports = {
    setFolderColor,
    getFolderColors,
    renameFolderMeta,
    deleteFolderMetaTree
};
