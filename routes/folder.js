const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../lib/account-store');

const uploadDir = path.join(__dirname, '..', 'uploads');
const dmUploadDir = path.join(__dirname, '..', 'uploads', 'dm');

[uploadDir, dmUploadDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
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
    const dir = req.query.dir ? path.join(uploadDir, req.query.dir) : uploadDir;
    if (!dir.startsWith(uploadDir)) return res.status(400).json({ error: 'Invalid path' });

    fs.readdir(dir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Failed to read directory' });

        const fileData = files
            .filter(f => f !== 'dm' && f !== 'avatars')
            .map(file => {
                const stats = fs.statSync(path.join(dir, file));
                return {
                    name: file,
                    size: stats.size,
                    mtime: stats.mtime,
                    isDir: stats.isDirectory()
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

// Delete file
router.delete('/file', authMiddleware, (req, res) => {
    const filename = req.query.path ? String(req.query.path) : '';
    const filePath = path.join(uploadDir, filename);
    if (!filePath.startsWith(uploadDir) || !filename) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
});

module.exports = router;
