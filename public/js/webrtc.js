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
            resolve({ ok: false, queued: false });
            return;
        }

        socket.emit('direct_message', {
            target: targetAccountId,
            message: messageObj
        }, (ack) => {
            if (!ack || !ack.ok) {
                resolve({ ok: false, error: ack && ack.error });
                return;
            }

            resolve({
                ok: true,
                messageId: ack.messageId,
                delivered: !!ack.delivered,
                queued: !!ack.queued
            });
        });
    });
};
