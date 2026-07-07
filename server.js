const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { applyPendingReset, applyPendingRestore } = require('./lib/restore-manager');

try {
    const resetResult = applyPendingReset();
    if (resetResult.applied) {
        console.log('Applied pending system reset');
    }
    const restoreResult = applyPendingRestore();
    if (restoreResult.applied) {
        console.log(`Applied pending restore from ${restoreResult.originalName}`);
    }
} catch (error) {
    console.error('Pending restore could not be applied:', error.message);
}

const {
    authenticateToken,
    getSessionPayload,
    listPublicAccounts,
    markAccountOffline,
    touchSession
} = require('./lib/account-store');
const {
    saveMessage,
    markDelivered,
    getPendingMessages,
    userExists
} = require('./lib/message-store');
const {
    isGroupMember,
    getGroupMemberIds,
    saveGroupMessage
} = require('./lib/group-store');
const folderRoutes = require('./routes/folder');
const { authRouter } = require('./routes/auth');
const { adminRouter } = require('./routes/admin');
const { messagesRouter } = require('./routes/messages');
const { groupsRouter, setGroupNotifier } = require('./routes/groups');

const ENABLE_MDNS = process.env.OFLAN_ENABLE_MDNS === '1';
let bonjour;
let bonjourService = null;
if (ENABLE_MDNS) {
    try {
        ({ Bonjour } = require('bonjour-service'));
        bonjour = new Bonjour();
    } catch (error) {
        bonjour = null;
    }
} else {
    bonjour = null;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/dm', express.static(path.join(__dirname, 'uploads', 'dm')));
app.use(express.json());

app.use('/api/folder', folderRoutes);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/groups', groupsRouter);

function advertiseService(port) {
    if (!bonjour) return null;

    const preferredHost = process.env.OFLAN_HOSTNAME || 'oflan.local';
    const serviceName = process.env.OFLAN_SERVICE_NAME || 'OF-LAN';
    const hostname = preferredHost.endsWith('.local') ? preferredHost : `${preferredHost}.local`;

    try {
        bonjourService = bonjour.publish({
            name: serviceName,
            type: 'http',
            port,
            host: hostname,
            txt: {
                app: 'of-lan'
            }
        });
        return bonjourService;
    } catch (error) {
        console.warn('mDNS advertisement failed:', error.message);
        return null;
    }
}

function shutdown() {
    if (bonjourService && typeof bonjourService.stop === 'function') {
        try {
            bonjourService.stop();
        } catch (error) {
            console.warn('Failed to stop mDNS service:', error.message);
        }
    }

    if (bonjour && typeof bonjour.destroy === 'function') {
        try {
            bonjour.destroy();
        } catch (error) {
            console.warn('Failed to destroy mDNS browser:', error.message);
        }
    }
}

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const activeSocketsByAccount = new Map();
const activeSocketsByDevice = new Map();
const socketSessions = new Map();

setGroupNotifier((memberIds) => {
    for (const memberId of memberIds) {
        const sockets = activeSocketsByAccount.get(memberId);
        if (!sockets) continue;
        for (const socketId of sockets) {
            io.to(socketId).emit('groups_updated');
        }
    }
});

// Token bucket: lets a few nudges through instantly, then throttles.
const nudgeBuckets = new Map();
const NUDGE_BURST_CAPACITY = 3;
const NUDGE_REFILL_MS = 4000;

function tryConsumeNudge(key) {
    const now = Date.now();
    let bucket = nudgeBuckets.get(key);
    if (!bucket) {
        bucket = { tokens: NUDGE_BURST_CAPACITY, lastRefill: now };
        nudgeBuckets.set(key, bucket);
    } else {
        const regen = Math.floor((now - bucket.lastRefill) / NUDGE_REFILL_MS);
        if (regen > 0) {
            bucket.tokens = Math.min(NUDGE_BURST_CAPACITY, bucket.tokens + regen);
            bucket.lastRefill += regen * NUDGE_REFILL_MS;
        }
    }

    if (bucket.tokens < 1) {
        return { allowed: false, retryAfterMs: NUDGE_REFILL_MS - (now - bucket.lastRefill) };
    }

    bucket.tokens -= 1;
    return { allowed: true };
}

function getClientIpFromSocket(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    return forwarded || socket.handshake.address || '';
}

function getActiveCounts() {
    const counts = new Map();
    for (const [accountId, sockets] of activeSocketsByAccount.entries()) {
        counts.set(accountId, sockets.size);
    }
    return counts;
}

function getActiveDeviceIds(accountId) {
    const deviceIds = new Set();
    const sockets = activeSocketsByAccount.get(accountId) || new Set();
    for (const socketId of sockets) {
        const session = socketSessions.get(socketId);
        if (session && session.deviceId) {
            deviceIds.add(session.deviceId);
        }
    }
    return deviceIds;
}

function broadcastUsers() {
    io.emit('update_users', listPublicAccounts(getActiveCounts()));
}

function emitSessionState(accountId) {
    const sockets = activeSocketsByAccount.get(accountId) || new Set();
    const activeDeviceIds = getActiveDeviceIds(accountId);
    const activeCount = sockets.size;

    for (const socketId of sockets) {
        const session = socketSessions.get(socketId);
        if (!session) continue;

        const payload = getSessionPayload(accountId, session.deviceId, activeDeviceIds, activeCount);
        if (payload) {
            io.to(socketId).emit('session_state', payload);
        }
    }
}

function addSocketToMap(map, key, socketId) {
    if (!map.has(key)) {
        map.set(key, new Set());
    }
    map.get(key).add(socketId);
}

function removeSocketFromMap(map, key, socketId) {
    if (!map.has(key)) return;
    const sockets = map.get(key);
    sockets.delete(socketId);
    if (!sockets.size) {
        map.delete(key);
    }
}

function deliverPendingMessages(recipientId) {
    const targetSockets = activeSocketsByAccount.get(recipientId);
    if (!targetSockets || !targetSockets.size) return;

    const pending = getPendingMessages(recipientId);
    if (!pending.length) return;

    const deliveredIds = [];
    const sendersToNotify = new Map();

    for (const item of pending) {
        for (const targetSocketId of targetSockets) {
            io.to(targetSocketId).emit('direct_message', item);
        }
        deliveredIds.push(item.message.id);

        if (!sendersToNotify.has(item.sender)) {
            sendersToNotify.set(item.sender, []);
        }
        sendersToNotify.get(item.sender).push(item.message.id);
    }

    markDelivered(deliveredIds);

    for (const [senderId, messageIds] of sendersToNotify.entries()) {
        const senderSockets = activeSocketsByAccount.get(senderId);
        if (!senderSockets || !senderSockets.size) continue;

        for (const senderSocketId of senderSockets) {
            io.to(senderSocketId).emit('message_delivered', { messageIds });
        }
    }
}

io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token
        ? String(socket.handshake.auth.token)
        : '';

    if (!token) {
        next(new Error('Authentication required'));
        return;
    }

    const session = authenticateToken(token);
    if (!session) {
        next(new Error('Invalid session'));
        return;
    }

    touchSession(token, {
        ip: getClientIpFromSocket(socket),
        userAgent: socket.handshake.headers['user-agent'] || ''
    });

    socket.data.token = token;
    socket.data.accountId = session.account.id;
    socket.data.deviceId = session.device.id;
    next();
});

io.on('connection', (socket) => {
    const { accountId, deviceId } = socket.data;

    socketSessions.set(socket.id, { accountId, deviceId });
    addSocketToMap(activeSocketsByAccount, accountId, socket.id);
    addSocketToMap(activeSocketsByDevice, deviceId, socket.id);

    emitSessionState(accountId);
    broadcastUsers();
    deliverPendingMessages(accountId);

    socket.on('request_session_state', () => {
        emitSessionState(accountId);
    });

    socket.on('profile_updated', () => {
        emitSessionState(accountId);
        broadcastUsers();
    });

    socket.on('direct_message', (data = {}, ack) => {
        console.log('[direct_message] received:', JSON.stringify(data));
        const freshSession = authenticateToken(socket.data.token);
        if (!freshSession) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Session expired.' });
            socket.disconnect(true);
            return;
        }

        touchSession(socket.data.token, {
            ip: getClientIpFromSocket(socket),
            userAgent: socket.handshake.headers['user-agent'] || ''
        });

        const targetAccountId = String(data.target || '').trim();
        const incomingMessage = data.message || {};
        const messageType = String(incomingMessage.type || 'text').trim();
        const messageContent = String(incomingMessage.content || '').trim();
        const messageName = incomingMessage.name ? String(incomingMessage.name) : '';
        const messageSize = incomingMessage.size ? String(incomingMessage.size) : '';
        const messageIcon = incomingMessage.icon ? String(incomingMessage.icon) : '';

        if (!targetAccountId || targetAccountId === accountId) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Invalid recipient.' });
            return;
        }

        if (!userExists(targetAccountId)) {
            if (typeof ack === 'function') ack({ ok: false, error: 'User not found.' });
            return;
        }

        if (messageType !== 'text' && messageType !== 'file' || !messageContent) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Invalid message.' });
            return;
        }

        const saved = saveMessage({
            senderId: accountId,
            recipientId: targetAccountId,
            type: messageType,
            content: messageContent,
            clientTime: incomingMessage.time,
            name: messageName,
            size: messageSize,
            icon: messageIcon
        });

        const payload = {
            sender: accountId,
            senderName: freshSession.account.displayName,
            message: {
                id: saved.id,
                type: saved.type,
                content: saved.content,
                name: saved.name,
                size: saved.size,
                icon: saved.icon,
                time: saved.time
            }
        };

        const targetSockets = activeSocketsByAccount.get(targetAccountId);
        const isOnline = !!(targetSockets && targetSockets.size);

        if (isOnline) {
            for (const targetSocketId of targetSockets) {
                io.to(targetSocketId).emit('direct_message', payload);
            }
            markDelivered([saved.id]);

            const senderSockets = activeSocketsByAccount.get(accountId);
            if (senderSockets && senderSockets.size) {
                for (const senderSocketId of senderSockets) {
                    io.to(senderSocketId).emit('message_delivered', { messageIds: [saved.id] });
                }
            }
        }

        if (typeof ack === 'function') {
            ack({
                ok: true,
                messageId: saved.id,
                delivered: isOnline,
                queued: !isOnline
            });
        }
    });

    socket.on('group_message', (data = {}, ack) => {
        const freshSession = authenticateToken(socket.data.token);
        if (!freshSession) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Session expired.' });
            socket.disconnect(true);
            return;
        }

        const groupId = String(data.group || '').trim();
        const incomingMessage = data.message || {};
        const messageType = String(incomingMessage.type || 'text').trim();
        const messageContent = String(incomingMessage.content || '').trim();

        if (!groupId || !isGroupMember(groupId, accountId)) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Group not found.' });
            return;
        }

        if (messageType !== 'text' && messageType !== 'file' || !messageContent) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Invalid message.' });
            return;
        }

        const saved = saveGroupMessage({
            groupId,
            senderId: accountId,
            type: messageType,
            content: messageContent,
            name: incomingMessage.name,
            size: incomingMessage.size,
            icon: incomingMessage.icon,
            clientTime: incomingMessage.time
        });

        const payload = {
            groupId,
            senderId: accountId,
            senderName: freshSession.account.displayName,
            senderAvatarUrl: freshSession.account.avatarUrl || '',
            message: {
                id: saved.id,
                type: saved.type,
                content: saved.content,
                name: saved.name,
                size: saved.size,
                icon: saved.icon,
                time: saved.time
            }
        };

        for (const memberId of getGroupMemberIds(groupId)) {
            if (memberId === accountId) continue;
            const memberSockets = activeSocketsByAccount.get(memberId);
            if (!memberSockets) continue;
            for (const memberSocketId of memberSockets) {
                io.to(memberSocketId).emit('group_message', payload);
            }
        }

        if (typeof ack === 'function') {
            ack({ ok: true, messageId: saved.id });
        }
    });

    socket.on('nudge', (data = {}, ack) => {
        const freshSession = authenticateToken(socket.data.token);
        if (!freshSession) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Session expired.' });
            socket.disconnect(true);
            return;
        }

        const targetAccountId = String(data.target || '').trim();
        if (!targetAccountId || targetAccountId === accountId || !userExists(targetAccountId)) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Invalid recipient.' });
            return;
        }

        const bucketKey = `${accountId}:${targetAccountId}`;
        const throttle = tryConsumeNudge(bucketKey);
        if (!throttle.allowed) {
            if (typeof ack === 'function') {
                ack({ ok: false, error: 'Please wait before nudging again.', retryAfterMs: throttle.retryAfterMs });
            }
            return;
        }

        const targetSockets = activeSocketsByAccount.get(targetAccountId);
        const isOnline = !!(targetSockets && targetSockets.size);

        if (isOnline) {
            for (const targetSocketId of targetSockets) {
                io.to(targetSocketId).emit('nudge', {
                    from: accountId,
                    fromName: freshSession.account.displayName
                });
            }
        }

        if (typeof ack === 'function') {
            ack({ ok: true, delivered: isOnline });
        }
    });

    socket.on('group_nudge', (data = {}, ack) => {
        const freshSession = authenticateToken(socket.data.token);
        if (!freshSession) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Session expired.' });
            socket.disconnect(true);
            return;
        }

        const groupId = String(data.group || '').trim();
        if (!groupId || !isGroupMember(groupId, accountId)) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Group not found.' });
            return;
        }

        const bucketKey = `group:${groupId}:${accountId}`;
        const throttle = tryConsumeNudge(bucketKey);
        if (!throttle.allowed) {
            if (typeof ack === 'function') {
                ack({ ok: false, error: 'Please wait before nudging again.', retryAfterMs: throttle.retryAfterMs });
            }
            return;
        }

        for (const memberId of getGroupMemberIds(groupId)) {
            if (memberId === accountId) continue;
            const memberSockets = activeSocketsByAccount.get(memberId);
            if (!memberSockets) continue;
            for (const memberSocketId of memberSockets) {
                io.to(memberSocketId).emit('group_nudge', {
                    groupId,
                    from: accountId,
                    fromName: freshSession.account.displayName
                });
            }
        }

        if (typeof ack === 'function') {
            ack({ ok: true });
        }
    });

    socket.on('disconnect', () => {
        removeSocketFromMap(activeSocketsByAccount, accountId, socket.id);
        removeSocketFromMap(activeSocketsByDevice, deviceId, socket.id);
        socketSessions.delete(socket.id);

        if (!activeSocketsByAccount.has(accountId)) {
            markAccountOffline(accountId);
        } else {
            emitSessionState(accountId);
        }

        broadcastUsers();
    });
});

const HOST = process.env.OFLAN_BIND_HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 80);

server.once('error', (error) => {
    console.error(`Failed to start server on port ${PORT}:`, error.message);
    if (error.code === 'EACCES') {
        console.error('Port 80 requires elevated privileges. Run the server as root or grant bind permission.');
    }
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    console.log('Server listening on http://oflan.local');
    const advertised = ENABLE_MDNS ? advertiseService(PORT) : null;
    if (advertised) {
        console.log('mDNS advertised as http://oflan.local');
    } else {
        console.log('mDNS disabled; configure your LAN DNS or hosts file for oflan.local');
    }
});

process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
});
