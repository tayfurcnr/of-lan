const express = require('express');
const router = express.Router();
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../lib/account-store');
const { setFolderColor, getFolderColors, renameFolderMeta, deleteFolderMetaTree } = require('../lib/folder-store');

const uploadDir = path.join(__dirname, '..', 'uploads');
const dmUploadDir = path.join(__dirname, '..', 'uploads', 'dm');

[uploadDir, dmUploadDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function resolveSafePath(relPath) {
    const target = relPath ? path.join(uploadDir, relPath) : uploadDir;
    if (target !== uploadDir && !target.startsWith(uploadDir + path.sep)) return null;
    return target;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const target = resolveSafePath(req.query.dir ? String(req.query.dir) : '');
        if (!target) {
            cb(new Error('Invalid path'));
            return;
        }
        if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
        cb(null, target);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});

const dmStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dmUploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const base = path.basename(file.originalname, ext);
        cb(null, `${base}-${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });
const dmUpload = multer({ storage: dmStorage });

function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? authenticateToken(token) : null;
    if (!session) return res.status(401).json({ error: 'Authentication required.' });
    req.account = session.account;
    next();
}

// DM file upload
router.post('/dm-upload', authMiddleware, dmUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
        ok: true,
        name: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        url: `/uploads/dm/${encodeURIComponent(req.file.filename)}`
    });
});

// List files
router.get('/', (req, res) => {
    const relDir = req.query.dir ? String(req.query.dir) : '';
    const dir = resolveSafePath(relDir);
    if (!dir) return res.status(400).json({ error: 'Invalid path' });

    fs.readdir(dir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Failed to read directory' });

        const colors = getFolderColors();
        const fileData = files
            .filter(f => f !== 'dm' && f !== 'avatars')
            .map(file => {
                const stats = fs.statSync(path.join(dir, file));
                const isDir = stats.isDirectory();
                const relPath = (relDir ? `${relDir}/` : '') + file;
                return {
                    name: file,
                    size: stats.size,
                    mtime: stats.mtime,
                    isDir,
                    color: isDir ? (colors[relPath] || null) : null
                };
            });
        res.json(fileData);
    });
});

// Upload
router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ ok: true, file: req.file.originalname });
});

// Create folder
router.post('/mkdir', authMiddleware, (req, res) => {
    const dir = req.body.dir ? String(req.body.dir) : '';
    const name = String(req.body.name || '').trim();

    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
        return res.status(400).json({ error: 'Invalid folder name' });
    }

    const parentPath = resolveSafePath(dir);
    if (!parentPath) return res.status(400).json({ error: 'Invalid path' });

    const targetPath = path.join(parentPath, name);
    if (!targetPath.startsWith(uploadDir)) return res.status(400).json({ error: 'Invalid path' });
    if (fs.existsSync(targetPath)) return res.status(409).json({ error: 'A file or folder with that name already exists.' });

    fs.mkdirSync(targetPath, { recursive: true });
    res.json({ ok: true, name });
});

// Rename a file or folder
router.post('/rename', authMiddleware, (req, res) => {
    const dir = req.body.dir ? String(req.body.dir) : '';
    const oldName = String(req.body.oldName || '').trim();
    const newName = String(req.body.newName || '').trim();

    if (!oldName || !newName || newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
        return res.status(400).json({ error: 'Invalid name' });
    }

    const parentPath = resolveSafePath(dir);
    if (!parentPath) return res.status(400).json({ error: 'Invalid path' });

    const oldPath = path.join(parentPath, oldName);
    const newPath = path.join(parentPath, newName);
    if (!oldPath.startsWith(uploadDir) || !newPath.startsWith(uploadDir)) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Not found' });
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'A file or folder with that name already exists.' });

    const wasDir = fs.statSync(oldPath).isDirectory();
    fs.renameSync(oldPath, newPath);

    if (wasDir) {
        const oldRel = (dir ? `${dir}/` : '') + oldName;
        const newRel = (dir ? `${dir}/` : '') + newName;
        renameFolderMeta(oldRel, newRel);
    }

    res.json({ ok: true });
});

// Set/clear a folder's color
router.post('/color', authMiddleware, (req, res) => {
    const relPath = String(req.body.path || '').trim();
    const color = String(req.body.color || '').trim();
    if (!relPath) return res.status(400).json({ error: 'Invalid path' });

    const targetPath = resolveSafePath(relPath);
    if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
        return res.status(404).json({ error: 'Folder not found' });
    }

    setFolderColor(relPath, color);
    res.json({ ok: true });
});

// Delete file
router.delete('/file', authMiddleware, (req, res) => {
    const filename = req.query.path ? String(req.query.path) : '';
    const filePath = resolveSafePath(filename);
    if (!filePath || !filename) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
});

// Download folder as a zip archive
router.get('/download', (req, res) => {
    const relPath = req.query.path ? String(req.query.path) : '';
    const targetPath = resolveSafePath(relPath);
    if (!targetPath || !relPath) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Folder not found' });
    if (!fs.statSync(targetPath).isDirectory()) return res.status(400).json({ error: 'Not a folder' });

    const folderName = path.basename(targetPath);
    const asciiName = folderName.replace(/[^\x20-\x7E]/g, '_');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiName}.zip"; filename*=UTF-8''${encodeURIComponent(folderName)}.zip`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            res.end();
        }
    });

    archive.pipe(res);
    archive.directory(targetPath, false);
    archive.finalize();
});

// Delete folder (recursive)
router.delete('/folder', authMiddleware, (req, res) => {
    const relPath = req.query.path ? String(req.query.path) : '';
    const targetPath = resolveSafePath(relPath);
    if (!targetPath || !relPath) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Folder not found' });
    if (!fs.statSync(targetPath).isDirectory()) return res.status(400).json({ error: 'Not a folder' });

    fs.rmSync(targetPath, { recursive: true, force: true });
    deleteFolderMetaTree(relPath);
    res.json({ ok: true });
});

module.exports = router;
