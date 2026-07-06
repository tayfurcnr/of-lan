const socket = io();
window.socket = socket;

window.connectToPeer = function connectToPeer() {
    return Promise.resolve();
};

window.sendMessageToPeer = function sendMessageToPeer(socketId, messageObj) {
    return new Promise((resolve) => {
        if (!socket || !socket.connected) {
            resolve(false);
            return;
        }

        socket.emit('direct_message', {
            target: socketId,
            message: messageObj
        }, (ack) => {
            resolve(Boolean(ack && ack.ok));
        });
    });
};
