const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const {
    checkpointDb: checkpointAccountDb,
    adminListUsers,
    adminGetUser,
    adminUpdateUser,
    adminDeleteUser
} = require('../lib/account-store');
const { checkpointDb: checkpointMessageDb } = require('../lib/message-store');
const { checkpointDb: checkpointGroupDb } = require('../lib/group-store');
const { checkpointDb: checkpointFolderDb } = require('../lib/folder-store');
const pkg = require('../package.json');
const {
    BACKUP_DIR,
    ensureDir,
    stageRestoreArchive,
    stageSystemReset,
    validateTarArchive
} = require('../lib/restore-manager');

const router = express.Router();
const ROOT_DIR = path.join(__dirname, '..');
const incomingDir = path.join(BACKUP_DIR, 'incoming');

ensureDir(BACKUP_DIR);
ensureDir(incomingDir);

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const restoreUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, incomingDir),
        filename: (_req, file, cb) => {
            const safeName = String(file.originalname || 'backup.tar.gz')
                .replace(/[^a-z0-9._-]+/gi, '_')
                .replace(/^_+/, '');
            cb(null, `${Date.now()}-${safeName || 'backup.tar.gz'}`);
        }
    }),
    limits: { fileSize: 1024 * 1024 * 1024 }
});

function adminAuth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) {
        res.status(401).json({ error: 'Admin authentication required.' });
        return;
    }
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const [user, ...rest] = decoded.split(':');
    const pass = rest.join(':');
    if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
        res.status(401).json({ error: 'Invalid admin credentials.' });
        return;
    }
    next();
}

// GET /api/admin/users
router.get('/users', adminAuth, (req, res) => {
    try {
        res.json(adminListUsers());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/users/:id
router.get('/users/:id', adminAuth, (req, res) => {
    try {
        const user = adminGetUser(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', adminAuth, (req, res) => {
    try {
        const { username, displayName, password } = req.body;
        const updated = adminUpdateUser(req.params.id, { username, displayName, password });
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', adminAuth, (req, res) => {
    try {
        res.json(adminDeleteUser(req.params.id));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/backup', adminAuth, (req, res) => {
    ensureDir(path.join(ROOT_DIR, 'data'));
    ensureDir(path.join(ROOT_DIR, 'uploads'));

    [checkpointAccountDb, checkpointMessageDb, checkpointGroupDb, checkpointFolderDb].forEach((fn) => {
        try {
            fn();
        } catch (error) {
            console.warn('[backup] checkpoint failed:', error.message);
        }
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `oflan-backup-${stamp}.tar.gz`;

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Backup-Format', 'tar.gz');
    res.setHeader('X-Backup-Generated-At', new Date().toISOString());
    res.setHeader('X-Backup-App-Version', pkg.version || 'unknown');
    res.setHeader('X-Backup-Includes', 'data,uploads');

    const archive = spawn('tar', [
        '-czf',
        '-',
        '--exclude=.oflan-backup',
        'data',
        'uploads'
    ], {
        cwd: ROOT_DIR
    });

    archive.stdout.pipe(res);

    archive.on('error', (error) => {
        if (!res.headersSent) {
            res.status(500).json({ error: `Failed to create backup: ${error.message}` });
        } else {
            res.destroy(error);
        }
    });

    archive.stderr.on('data', (chunk) => {
        console.warn('[backup] tar stderr:', String(chunk).trim());
    });

    archive.on('close', (code) => {
        if (code !== 0 && !res.headersSent) {
            res.status(500).json({ error: 'Failed to create backup archive.' });
        }
    });
});

router.post('/backup/restore', adminAuth, restoreUpload.single('backup'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No backup archive uploaded.' });
    }

    try {
        validateTarArchive(req.file.path);
        stageRestoreArchive(req.file.path, req.file.originalname);
        fs.rmSync(req.file.path, { force: true });
        res.json({
            ok: true,
            restartRequired: true,
            message: 'Backup staged. Restart the server to apply the restore.'
        });
    } catch (error) {
        try {
            fs.rmSync(req.file.path, { force: true });
        } catch (_) {}
        res.status(400).json({ error: error.message });
    }
});

router.post('/reset', adminAuth, (req, res) => {
    const confirm = String(req.body && req.body.confirm || '').trim().toUpperCase();
    if (confirm !== 'RESET') {
        return res.status(400).json({ error: 'Type RESET to confirm the reset.' });
    }

    try {
        stageSystemReset('admin_reset');
        res.json({
            ok: true,
            restartRequired: true,
            message: 'System reset staged. Restart the server to apply the reset.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = { adminRouter: router };
