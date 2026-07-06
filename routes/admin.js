const express = require('express');
const {
    adminListUsers,
    adminGetUser,
    adminUpdateUser,
    adminDeleteUser
} = require('../lib/account-store');

const router = express.Router();

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';

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

module.exports = { adminRouter: router };
