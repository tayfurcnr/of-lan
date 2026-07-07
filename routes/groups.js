const express = require('express');
const { authenticateToken, touchSession } = require('../lib/account-store');
const {
    createGroup,
    getUserGroups,
    getGroup,
    isGroupMember,
    leaveGroup,
    getGroupMessages
} = require('../lib/group-store');

const router = express.Router();

let notifyGroupUpdated = () => {};
function setGroupNotifier(fn) {
    notifyGroupUpdated = fn;
}

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

    req.account = session.account;
    next();
}

router.get('/', authRequired, (req, res) => {
    res.json({ groups: getUserGroups(req.account.id) });
});

router.post('/', authRequired, (req, res) => {
    try {
        const group = createGroup({
            name: req.body.name,
            creatorId: req.account.id,
            memberIds: Array.isArray(req.body.memberIds) ? req.body.memberIds : []
        });
        notifyGroupUpdated(group.members.map((member) => member.id));
        res.json({ group });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/:id/messages', authRequired, (req, res) => {
    const groupId = req.params.id;
    if (!isGroupMember(groupId, req.account.id)) {
        res.status(404).json({ error: 'Group not found.' });
        return;
    }

    const messages = getGroupMessages(groupId, req.account.id, {
        limit: req.query.limit ? Number(req.query.limit) : 100
    });
    res.json({ messages });
});

router.post('/:id/leave', authRequired, (req, res) => {
    const groupId = req.params.id;
    if (!getGroup(groupId)) {
        res.status(404).json({ error: 'Group not found.' });
        return;
    }

    leaveGroup(groupId, req.account.id);
    res.json({ ok: true });
});

module.exports = { groupsRouter: router, setGroupNotifier };
