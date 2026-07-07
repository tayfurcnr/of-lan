const express = require('express');
const { authenticateToken, touchSession } = require('../lib/account-store');
const {
    getConversationHistory,
    userExists,
    deleteConversation,
    markRead,
    getUnreadCounts
} = require('../lib/message-store');

const router = express.Router();

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

router.get('/unread/counts', authRequired, (req, res) => {
    res.json({ counts: getUnreadCounts(req.account.id) });
});

router.post('/:userId/read', authRequired, (req, res) => {
    const otherUserId = String(req.params.userId || '').trim();
    if (!otherUserId || !userExists(otherUserId)) {
        res.status(404).json({ error: 'User not found.' });
        return;
    }

    markRead(req.account.id, otherUserId);
    res.json({ ok: true });
});

router.get('/:userId', authRequired, (req, res) => {
    const otherUserId = String(req.params.userId || '').trim();
    if (!otherUserId || !userExists(otherUserId)) {
        res.status(404).json({ error: 'User not found.' });
        return;
    }

    const before = req.query.before ? Number(req.query.before) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const messages = getConversationHistory(req.account.id, otherUserId, { limit, before });

    res.json({ messages });
});

router.delete('/:userId', authRequired, (req, res) => {
    const otherUserId = String(req.params.userId || '').trim();
    if (!otherUserId || !userExists(otherUserId)) {
        res.status(404).json({ error: 'User not found.' });
        return;
    }

    deleteConversation(req.account.id, otherUserId);
    res.json({ ok: true });
});

module.exports = { messagesRouter: router };
