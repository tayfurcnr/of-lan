const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const {
    authenticateToken,
    getSessionPayload,
    listPublicAccounts,
    markAccountOffline,
    touchSession
} = require('./lib/account-store');
const folderRoutes = require('./routes/folder');
const { authRouter } = require('./routes/auth');
const { adminRouter } = require('./routes/admin');

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
app.use(express.json());

app.use('/api/folder', folderRoutes);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const activeSocketsByAccount = new Map();
const activeSocketsByDevice = new Map();
const socketSessions = new Map();

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

    socket.on('request_session_state', () => {
        emitSessionState(accountId);
    });

    socket.on('profile_updated', () => {
        emitSessionState(accountId);
        broadcastUsers();
    });

    socket.on('direct_message', (data = {}, ack) => {
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
        const targetSockets = activeSocketsByAccount.get(targetAccountId);

        if (!targetAccountId || !targetSockets || !targetSockets.size) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Target user is offline.' });
            return;
        }

        const payload = {
            sender: accountId,
            senderName: freshSession.account.displayName,
            message: data.message
        };

        for (const targetSocketId of targetSockets) {
            io.to(targetSocketId).emit('direct_message', payload);
        }

        if (typeof ack === 'function') ack({ ok: true });
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

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
