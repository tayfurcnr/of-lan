const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage });

// List files
router.get('/', (req, res) => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Failed to read directory' });

        const fileData = files.map(file => {
            const stats = fs.statSync(path.join(uploadDir, file));
            return {
                name: file,
                size: stats.size,
                mtime: stats.mtime
            };
        });
        res.json(fileData);
    });
});

// Upload
router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, file: req.file.originalname });
});

// Delete
router.delete('/:filename', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Rename
router.put('/:oldname/rename', express.json(), (req, res) => {
    const oldPath = path.join(uploadDir, req.params.oldname);
    const newPath = path.join(uploadDir, req.body.newName);

    if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

module.exports = router;
