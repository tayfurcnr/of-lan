let socket = null;

window.getSocket = function getSocket() {
    return socket;
};

window.connectSocket = function connectSocket(token) {
    if (!token) return null;

    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
    }

    socket = io({
        autoConnect: false,
        auth: {
            token
        }
    });

    window.socket = socket;
    socket.connect();
    return socket;
};

window.disconnectSocket = function disconnectSocket() {
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    window.socket = null;
};

window.connectToPeer = function connectToPeer() {
    return Promise.resolve();
};

window.sendMessageToPeer = function sendMessageToPeer(targetAccountId, messageObj) {
    return new Promise((resolve) => {
        if (!socket || !socket.connected) {
            resolve(false);
            return;
        }

        socket.emit('direct_message', {
            target: targetAccountId,
            message: messageObj
        }, (ack) => {
            resolve(Boolean(ack && ack.ok));
        });
    });
};
