const socket = window.socket || null;

const appUI = {
    users: [],
    activeChat: null,
    messages: {},
    myId: null
};

window.appUI = appUI;

const refs = {
    contactsList: document.getElementById('contacts-list'),
    lanUsersList: document.getElementById('lan-users-list'),
    onlineCount: document.getElementById('online-count'),
    searchUsers: document.getElementById('search-users'),
    noChatSelected: document.getElementById('no-chat-selected'),
    chatContainer: document.getElementById('chat-container'),
    chatUserName: document.getElementById('chat-user-name'),
    chatAvatar: document.getElementById('chat-avatar'),
    chatStatus: document.getElementById('chat-status'),
    chatMessages: document.getElementById('chat-messages'),
    messageInput: document.getElementById('message-input'),
    btnSend: document.getElementById('btn-send'),
    btnAttach: document.getElementById('btn-attach'),
    fileInput: document.getElementById('file-input'),
    modalSettings: document.getElementById('modal-settings'),
    btnSettings: document.getElementById('btn-settings'),
    closeSettings: document.getElementById('close-settings'),
    inputDisplayName: document.getElementById('input-display-name'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    myAvatar: document.getElementById('my-avatar'),
    myName: document.getElementById('my-name'),
    folderSidebar: document.getElementById('modal-folder'),
    btnSharedFolder: document.getElementById('btn-shared-folder'),
    btnFolderRefresh: document.getElementById('btn-folder-refresh'),
    btnFolderUpload: document.getElementById('btn-folder-upload'),
    folderUploadInput: document.getElementById('folder-upload-input'),
    folderFilesList: document.getElementById('folder-files-list'),
    folderBreadcrumb: document.getElementById('folder-breadcrumb')
};

let currentFolderDir = '';
let activeDisplayName = localStorage.getItem('officelan_display_name') || 'Kullanıcı';

function getInitials(name) {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function formatTime(value) {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(value) {
    return new Date(value).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hexToRgba(hex, alpha) {
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized;
    const int = parseInt(value, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shadeHex(hex, amount) {
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized;
    const int = parseInt(value, 16);
    const r = Math.max(0, Math.min(255, ((int >> 16) & 255) + amount));
    const g = Math.max(0, Math.min(255, ((int >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (int & 255) + amount));
    return `rgb(${r}, ${g}, ${b})`;
}

function getFileBadge(name, isDir) {
    if (isDir) {
        return `
            <div class="file-badge" style="background: rgba(244, 194, 81, 0.18); color: #f6c34f;">
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M3.5 9v7.5A2.5 2.5 0 0 0 6 19h12a2.5 2.5 0 0 0 2.5-2.5v-8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                </svg>
            </div>
        `;
    }

    const lower = name.toLowerCase();
    let color = '#7f8eea';
    let icon = `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
    `;

    if (lower.endsWith('.pdf')) {
        color = '#ff6b6b';
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        color = '#58c58b';
    } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) {
        color = '#72a7ff';
    } else if (lower.endsWith('.zip') || lower.endsWith('.rar')) {
        color = '#f1b55a';
    } else if (lower.endsWith('.mp4') || lower.endsWith('.mov')) {
        color = '#7fb3ff';
    } else if (lower.endsWith('.md') || lower.endsWith('.txt')) {
        color = '#91a2ff';
    }

    return `<div class="file-badge" style="background:${hexToRgba(color, 0.18)}; color:${color};">${icon}</div>`;
}

function renderProfile() {
    refs.myName.textContent = activeDisplayName;
    refs.myAvatar.textContent = getInitials(activeDisplayName);
    refs.inputDisplayName.value = activeDisplayName;
}

function makeUserList(users) {
    return users
        .map((user) => {
            const active = appUI.activeChat === user.id ? 'active' : '';
            const dotClass = user.status === 'idle' ? 'idle' : user.status === 'offline' ? 'offline' : 'online';
            const initials = user.initials || getInitials(user.name);
            const accent = user.accent || '#7f5af0';
            return `
                <li class="person-row ${active}" data-user-id="${escapeHTML(user.id)}">
                    <div class="avatar avatar-sm" style="background: linear-gradient(180deg, ${accent}, ${shadeHex(accent, -34)});">${escapeHTML(initials)}</div>
                    <div class="person-copy">
                        <div class="person-name">${escapeHTML(user.name)}</div>
                        <div class="person-meta">${escapeHTML(user.ip || 'Online')}</div>
                    </div>
                    <span class="status-dot ${dotClass}"></span>
                </li>
            `;
        })
        .join('');
}

function renderUsers() {
    const term = refs.searchUsers.value.trim().toLowerCase();
    const filtered = appUI.users.filter((user) => user.name.toLowerCase().includes(term));
    const contacts = filtered.filter((user) => user.isCustomName);
    const others = filtered.filter((user) => !user.isCustomName);

    refs.contactsList.innerHTML = makeUserList(contacts);
    refs.lanUsersList.innerHTML = makeUserList(others);
    refs.onlineCount.textContent = String(filtered.length);

    document.querySelectorAll('.person-row').forEach((row) => {
        row.addEventListener('click', () => {
            const userId = row.getAttribute('data-user-id');
            selectUser(userId);
        });
    });
}

function getMessageSeed(userId) {
    if (!appUI.messages[userId]) appUI.messages[userId] = [];
    return appUI.messages[userId];
}

function renderMessage(message) {
    const time = formatTime(message.time || Date.now());
    const side = message.sentByMe ? 'sent' : 'received';
    const meta = message.sentByMe ? `${time} <span class="meta-check">✓✓</span>` : time;

    if (message.type === 'file') {
        return `
            <div class="message-row ${side}">
                <div class="file-card ${message.sentByMe ? 'sent' : ''}">
                    <div class="file-card-top">
                        <div class="file-icon" style="color: ${message.icon === 'pptx' ? '#ff9f43' : '#7fb3ff'};">
                            ${getInlineFileIcon(message.icon || 'file')}
                        </div>
                        <div class="file-copy">
                            <div class="file-name">${escapeHTML(message.name)}</div>
                            <div class="file-size">${escapeHTML(message.size || '')}</div>
                        </div>
                        <button class="file-download" aria-label="İndir">
                            <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                    </div>
                    <div class="message-meta" style="margin-top: 10px;">${meta}</div>
                </div>
            </div>
        `;
    }

    if (message.type === 'upload') {
        return `
            <div class="message-row ${side}">
                <div class="file-card sent">
                    <div class="file-card-top">
                        <div class="file-icon" style="color: #ff9f43;">
                            ${getInlineFileIcon(message.icon || 'pptx')}
                        </div>
                        <div class="file-copy">
                            <div class="file-name">${escapeHTML(message.name)}</div>
                            <div class="file-size">${escapeHTML(message.size || '')}</div>
                        </div>
                        <button class="file-download" aria-label="Ayrıntı">
                            <svg viewBox="0 0 24 24" fill="none"><path d="M9 6.5 15 12l-6 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                    </div>
                    <div class="file-progress"><span style="--progress:${message.progress || 0}%"></span></div>
                    <div class="file-progress-meta">
                        <span>${escapeHTML(message.current || '')}</span>
                        <button class="cancel-button">Cancel</button>
                    </div>
                    <div class="message-meta">${meta}</div>
                </div>
            </div>
        `;
    }

    return `
        <div class="message-row ${side}">
            <div class="avatar avatar-sm" style="background:${message.sentByMe ? 'linear-gradient(180deg, #8650f3, #5e2fc4)' : 'linear-gradient(180deg, #8b5cf6, #6d45db)'}">${escapeHTML(message.sentByMe ? getInitials(activeDisplayName) : getInitials((appUI.users.find((u) => u.id === appUI.activeChat) || {}).name || 'AS'))}</div>
            <div class="message-stack">
                <div class="message-bubble">${escapeHTML(message.content)}</div>
                <div class="message-meta">${meta}</div>
            </div>
        </div>
    `;
}

function getInlineFileIcon(kind) {
    const lower = String(kind || '').toLowerCase();
    if (lower === 'pdf') {
        return `
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
        `;
    }

    if (lower === 'pptx') {
        return `
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M9.2 13.5h5.6M9.2 16h3.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
            </svg>
        `;
    }

    return `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
    `;
}

function renderChat(userId) {
    if (!userId) {
        refs.noChatSelected.classList.remove('hidden');
        refs.chatContainer.classList.add('hidden');
        refs.chatMessages.innerHTML = '';
        return;
    }

    const user = appUI.users.find((item) => item.id === userId);
    const name = user ? user.name : 'Bilinmeyen';
    const statusText = user && user.status === 'idle' ? 'Idle' : 'Online';

    refs.noChatSelected.classList.add('hidden');
    refs.chatContainer.classList.remove('hidden');
    refs.chatUserName.textContent = name;
    refs.chatAvatar.textContent = getInitials(name || '?');
    refs.chatStatus.textContent = statusText;
    refs.chatStatus.className = user && user.status === 'idle' ? 'presence-line' : 'presence-line online';

    const messages = getMessageSeed(userId);
    const html = [`<div class="day-pill">Today</div>`];

    if (!messages.length) {
        html.push(`
            <div class="day-pill" style="align-self:flex-start; background: rgba(255,255,255,0.03);">Henüz mesaj yok</div>
        `);
    } else {
        messages.forEach((message) => {
            html.push(renderMessage(message));
        });
    }

    refs.chatMessages.innerHTML = html.join('');
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

function selectUser(userId) {
    appUI.activeChat = userId;
    renderUsers();
    renderChat(userId);
}

async function sendChatMessage() {
    const text = refs.messageInput.value.trim();
    if (!text || !appUI.activeChat) return;

    const message = { type: 'text', content: text, time: Date.now(), sentByMe: true };
    const sent = await window.sendMessageToPeer(appUI.activeChat, message);
    if (sent) {
        if (!appUI.messages[appUI.activeChat]) appUI.messages[appUI.activeChat] = [];
        appUI.messages[appUI.activeChat].push(message);
        refs.messageInput.value = '';
        renderChat(appUI.activeChat);
    } else {
        alert('Mesaj gönderilemedi. Karşı taraf çevrimdışı veya bağlantı yok.');
    }
}

appUI.handleIncomingMessage = (senderId, msgObj) => {
    if (!appUI.messages[senderId]) appUI.messages[senderId] = [];
    appUI.messages[senderId].push({ ...msgObj, sentByMe: false });
    if (appUI.activeChat === senderId) {
        renderChat(senderId);
    }
};

appUI.updateP2PStatus = (state) => {
    if (!refs.chatStatus) return;

    if (state === 'connected') {
        refs.chatStatus.textContent = 'Connected';
        refs.chatStatus.className = 'presence-line online';
    } else if (state === 'connecting' || state === 'new') {
        refs.chatStatus.textContent = 'Bağlanıyor...';
        refs.chatStatus.className = 'presence-line';
    } else if (state) {
        refs.chatStatus.textContent = String(state);
        refs.chatStatus.className = 'presence-line';
    }
};

function syncUserSource(rawUsers) {
    const remoteUsers = rawUsers.filter((user) => user.id !== appUI.myId && user.online);
    appUI.users = remoteUsers;

    if (appUI.activeChat && !appUI.users.some((user) => user.id === appUI.activeChat)) {
        appUI.activeChat = null;
    }

    if (!appUI.activeChat && appUI.users.length) {
        appUI.activeChat = appUI.users[0].id;
    }

    renderUsers();
    renderChat(appUI.activeChat);
}

function renderFiles(files) {
    const rows = Array.isArray(files) ? files : [];

    if (!rows.length) {
        refs.folderFilesList.innerHTML = `
            <div class="empty-state" style="min-height: 260px;">
                <div class="empty-badge">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                    </svg>
                </div>
                <h3 style="font-size:18px; margin-top:14px;">Klasör boş</h3>
                <p style="max-width:280px;">Bu klasörde şu anda dosya yok.</p>
            </div>
        `;
        return;
    }

    refs.folderFilesList.innerHTML = rows.map((file) => {
        const isDir = !!file.isDir;
        const size = isDir ? '—' : formatSize(file.size);
        const modified = file.mtime ? new Date(file.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Today';
        const name = escapeHTML(file.name);
        const action = isDir
            ? `<button class="file-download" title="Open" onclick="navigateFolder('${currentFolderDir ? `${currentFolderDir}/` : ''}${file.name}')">›</button>`
            : `<button class="file-download" title="Download" onclick="window.open('/uploads/${currentFolderDir ? `${currentFolderDir}/` : ''}${encodeURIComponent(file.name)}')">↓</button>`;
        return `
            <div class="file-row">
                <div class="file-name-cell">
                    ${getFileBadge(file.name, isDir)}
                    <div class="file-row-name">${name}</div>
                </div>
                <div class="file-row-size">${size}</div>
                <div class="file-row-mod">${modified}</div>
                <div class="file-row-actions">
                    ${action}
                    <button class="file-download" title="More">⋮</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderBreadcrumb() {
    const parts = currentFolderDir.split('/').filter(Boolean);
    let html = `<span style="color:#aab3d4;">Shared</span> <span style="color:#667093;">/</span> <span style="color:#f2f5ff;">Files</span>`;
    if (parts.length) {
        let pathAccumulator = '';
        html = `
            <span class="breadcrumb-link" onclick="navigateFolder('')">Shared</span>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-link" onclick="navigateFolder('')">Files</span>
        `;
        parts.forEach((part) => {
            pathAccumulator += (pathAccumulator ? '/' : '') + part;
            html += `
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-link" onclick="navigateFolder('${pathAccumulator}')">${escapeHTML(part)}</span>
            `;
        });
    }
    refs.folderBreadcrumb.innerHTML = html;
}

async function fetchFiles() {
    const query = currentFolderDir ? `?dir=${encodeURIComponent(currentFolderDir)}` : '';
    try {
        const response = await fetch(`/api/folder${query}`);
        const files = await response.json();
        renderFiles(Array.isArray(files) ? files : []);
    } catch (error) {
        renderFiles([]);
    }
    renderBreadcrumb();
}

window.navigateFolder = (dir) => {
    currentFolderDir = dir;
    fetchFiles();
};

window.deleteFile = async (name) => {
    if (!confirm(`"${name}" silinecek. Emin misiniz?`)) return;
    const query = currentFolderDir ? `?dir=${encodeURIComponent(currentFolderDir)}` : '';
    await fetch(`/api/folder/${encodeURIComponent(name)}${query}`, { method: 'DELETE' });
    fetchFiles();
};

function setupEvents() {
    refs.searchUsers.addEventListener('input', renderUsers);

    refs.messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
        }
    });

    refs.messageInput.addEventListener('input', () => {
        refs.messageInput.style.height = 'auto';
        refs.messageInput.style.height = `${Math.min(refs.messageInput.scrollHeight, 120)}px`;
    });

    refs.btnSend.addEventListener('click', sendChatMessage);
    refs.btnAttach.addEventListener('click', () => refs.fileInput.click());
    refs.fileInput.addEventListener('change', () => {
        alert('WebRTC doğrudan dosya gönderimi yerine ortak klasör kullanın.');
        refs.fileInput.value = '';
    });

    refs.btnSettings.addEventListener('click', () => refs.modalSettings.classList.remove('hidden'));
    refs.closeSettings.addEventListener('click', () => refs.modalSettings.classList.add('hidden'));
    refs.btnSaveSettings.addEventListener('click', () => {
        const name = refs.inputDisplayName.value.trim();
        if (!name) return;
        activeDisplayName = name;
        localStorage.setItem('officelan_display_name', name);
        renderProfile();
        refs.modalSettings.classList.add('hidden');
        if (socket) {
            socket.emit('set_name', name);
        }
    });

    refs.btnSharedFolder.addEventListener('click', () => {
        fetchFiles();
        refs.folderSidebar.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });

    refs.btnFolderRefresh.addEventListener('click', fetchFiles);
    refs.btnFolderUpload.addEventListener('click', () => refs.folderUploadInput.click());
    refs.folderUploadInput.addEventListener('change', async () => {
        const file = refs.folderUploadInput.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const query = currentFolderDir ? `?dir=${encodeURIComponent(currentFolderDir)}` : '';
            await fetch(`/api/folder/upload${query}`, {
                method: 'POST',
                body: formData
            });
            fetchFiles();
        } catch (error) {
            console.error('Upload fail', error);
        } finally {
            refs.folderUploadInput.value = '';
        }
    });

    document.querySelectorAll('.toggle-button').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.toggle-button').forEach((btn) => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });
}

function bootSocket() {
    if (typeof socket === 'undefined' || !socket) {
        return;
    }

    socket.on('connect', () => {
        appUI.myId = socket.id;
        renderProfile();
        socket.emit('set_name', activeDisplayName);
    });

    socket.on('update_users', syncUserSource);

    socket.on('direct_message', (payload) => {
        if (!payload || !payload.sender || !payload.message) return;
        appUI.handleIncomingMessage(payload.sender, payload.message);
    });
}

function init() {
    renderProfile();
    setupEvents();
    bootSocket();
    fetchFiles();
}

init();
