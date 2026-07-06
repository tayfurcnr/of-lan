const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
    }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

// Routes
const folderRoutes = require('./routes/folder');
app.use('/api/folder', folderRoutes);

// State
let users = {}; // socket.id -> { id, name, isCustomName, ip, online }

io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;

    // Auto-discovery: assign default name
    const defaultName = `Kullanıcı_${Math.floor(Math.random() * 1000)}`;

    users[socket.id] = {
        id: socket.id,
        name: defaultName,
        isCustomName: false,
        ip: clientIp,
        online: true
    };

    // Broadcast updated user list to everyone
    io.emit('update_users', Object.values(users));

    socket.on('set_name', (name) => {
        if (users[socket.id]) {
            users[socket.id].name = name;
            users[socket.id].isCustomName = true;
            io.emit('update_users', Object.values(users));
        }
    });

    // Direct messaging relay
    socket.on('direct_message', (data = {}, ack) => {
        if (!data.target || !users[data.target]) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Target user is offline.' });
            return;
        }

        io.to(data.target).emit('direct_message', {
            sender: socket.id,
            message: data.message
        });

        if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            users[socket.id].online = false;
            delete users[socket.id];
            io.emit('update_users', Object.values(users));
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
