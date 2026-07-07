const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const {
    authenticateToken,
    getSessionPayload,
    loginAccount,
    logoutToken,
    registerAccount,
    revokeDevice,
    touchSession,
    updateProfile
} = require('../lib/account-store');

const router = express.Router();
const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');

if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
        cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    }
});

const MAX_AVATAR_SIZE = 15 * 1024 * 1024;
const upload = multer({ storage, limits: { fileSize: MAX_AVATAR_SIZE } });

function getTokenFromRequest(req) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
        return header.slice(7).trim();
    }
    return '';
}

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
}

function authRequired(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
    }

    const session = authenticateToken(token);
    if (!session) {
        res.status(401).json({ error: 'Invalid session.' });
        return;
    }

    touchSession(token, {
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] || ''
    });

    req.authToken = token;
    req.account = session.account;
    req.device = session.device;
    next();
}

router.post('/register', (req, res) => {
    try {
        const session = registerAccount({
            username: req.body.username,
            password: req.body.password,
            displayName: req.body.displayName,
            deviceName: req.body.deviceName,
            userAgent: req.headers['user-agent'] || '',
            ip: getClientIp(req)
        });

        res.json({
            token: session.token,
            account: {
                id: session.account.id,
                username: session.account.username,
                displayName: session.account.displayName,
                avatarUrl: session.account.avatarUrl || '',
                lastSeen: session.account.lastSeenAt || null
            }
        });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Registration failed.' });
    }
});

router.post('/login', (req, res) => {
    try {
        const session = loginAccount({
            username: req.body.username,
            password: req.body.password,
            deviceName: req.body.deviceName,
            userAgent: req.headers['user-agent'] || '',
            ip: getClientIp(req)
        });

        res.json({
            token: session.token,
            account: {
                id: session.account.id,
                username: session.account.username,
                displayName: session.account.displayName,
                avatarUrl: session.account.avatarUrl || '',
                lastSeen: session.account.lastSeenAt || null
            }
        });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Sign-in failed.' });
    }
});

router.get('/me', authRequired, (req, res) => {
    const payload = getSessionPayload(req.account.id, req.device.id);
    res.json(payload);
});

router.post('/logout', authRequired, (req, res) => {
    logoutToken(req.authToken);
    res.json({ success: true });
});

router.patch('/profile', authRequired, (req, res, next) => {
    upload.single('avatar')(req, res, (error) => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: 'Avatar image cannot exceed 15 MB.' });
            return;
        }
        if (error) {
            res.status(400).json({ error: error.message || 'Upload failed.' });
            return;
        }
        next();
    });
}, (req, res) => {
    try {
        const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : undefined;
        const account = updateProfile(req.account.id, {
            displayName: req.body.displayName,
            avatarUrl
        });

        res.json({
            success: true,
            account: {
                id: account.id,
                username: account.username,
                displayName: account.displayName,
                avatarUrl: account.avatarUrl || '',
                lastSeen: account.lastSeenAt || null
            }
        });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Profile update failed.' });
    }
});

router.delete('/devices/:deviceId', authRequired, (req, res) => {
    try {
        revokeDevice(req.account.id, req.params.deviceId);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to remove device.' });
    }
});

module.exports = {
    authRequired,
    authRouter: router,
    getTokenFromRequest
};
