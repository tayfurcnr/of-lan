const AUTH_TOKEN_KEY = 'officelan_auth_token';

const appUI = {
    users: [],
    activeChat: null,
    messages: {},
    unreadCounts: {},
    myId: null,
    account: null,
    devices: []
};

window.appUI = appUI;

const activeUploads = new Map();

const refs = {
    app: document.getElementById('app'),
    modalAuth: document.getElementById('modal-auth'),
    authError: document.getElementById('auth-error'),
    authSubtitle: document.getElementById('auth-subtitle'),
    btnShowLogin: document.getElementById('btn-show-login'),
    btnShowRegister: document.getElementById('btn-show-register'),
    formLogin: document.getElementById('form-login'),
    formRegister: document.getElementById('form-register'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    loginRememberMe: document.getElementById('login-remember-me'),
    registerDisplayName: document.getElementById('register-display-name'),
    registerUsername: document.getElementById('register-username'),
    registerPassword: document.getElementById('register-password'),
    modalSettings: document.getElementById('modal-settings'),
    closeSettings: document.getElementById('close-settings'),
    btnSettings: document.getElementById('btn-settings'),
    inputDisplayName: document.getElementById('input-display-name'),
    inputAvatar: document.getElementById('input-avatar'),
    avatarFileName: document.getElementById('avatar-file-name'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnLogout: document.getElementById('btn-logout'),
    myAvatar: document.getElementById('my-avatar'),
    myName: document.getElementById('my-name'),
    myPresence: document.getElementById('my-presence'),
    settingsAvatarPreview: document.getElementById('settings-avatar-preview'),
    contactsList: document.getElementById('contacts-list'),
    lanUsersList: document.getElementById('lan-users-list'),
    onlineCount: document.getElementById('online-count'),
    searchUsers: document.getElementById('search-users'),
    btnUsersRefresh: document.getElementById('btn-users-refresh'),
    noChatSelected: document.getElementById('no-chat-selected'),
    chatContainer: document.getElementById('chat-container'),
    chatUserName: document.getElementById('chat-user-name'),
    chatAvatar: document.getElementById('chat-avatar'),
    chatStatus: document.getElementById('chat-status'),
    chatMessages: document.getElementById('chat-messages'),
    btnCloseChat: document.getElementById('btn-close-chat'),
    messageInput: document.getElementById('message-input'),
    btnSend: document.getElementById('btn-send'),
    btnAttach: document.getElementById('btn-attach'),
    fileInput: document.getElementById('file-input'),
    folderSidebar: document.getElementById('modal-folder'),
    btnSharedFolder: document.getElementById('btn-shared-folder'),
    btnCloseFolder: document.getElementById('btn-close-folder'),
    btnFolderUpload: document.getElementById('btn-folder-upload'),
    folderUploadInput: document.getElementById('folder-upload-input'),
    folderFilesList: document.getElementById('folder-files-list'),
    folderBreadcrumb: document.getElementById('folder-breadcrumb'),
    folderEmptyState: document.getElementById('folder-empty-state'),
    chatContextMenu: document.getElementById('chat-context-menu'),
    btnDeleteChat: document.getElementById('btn-delete-chat'),
    serverPresence: document.getElementById('server-presence')
};

let currentFolderDir = '';
let audioContext = null;
let notificationPermissionRequested = false;
let authMode = 'login';

function getSocketInstance() {
    return window.getSocket ? window.getSocket() : null;
}

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function setAuthToken(token, rememberMe = true) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);

    if (token) {
        if (rememberMe) {
            localStorage.setItem(AUTH_TOKEN_KEY, token);
        } else {
            sessionStorage.setItem(AUTH_TOKEN_KEY, token);
        }
    }
}

function getDefaultDeviceName() {
    const platform = navigator.platform || 'Unknown platform';
    return `${platform} - ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Browser'}`;
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function getInitials(name) {
    return String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');
}

function formatTime(value) {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getUploadToastHost() {
    let host = document.getElementById('upload-toasts');
    if (!host) {
        host = document.createElement('div');
        host.id = 'upload-toasts';
        host.className = 'upload-toasts';
        document.body.appendChild(host);
    }
    return host;
}

function createUploadToast(file, { onCancel } = {}) {
    const host = getUploadToastHost();
    const kind = file.name.split('.').pop().toLowerCase();

    const toast = document.createElement('div');
    toast.className = 'upload-toast';
    toast.innerHTML = `
        <div class="upload-toast-icon">${getInlineFileIcon(kind)}</div>
        <div class="upload-toast-body">
            <div class="upload-toast-row">
                <span class="upload-toast-name">${escapeHTML(file.name)}</span>
                <span class="upload-toast-percent">0%</span>
            </div>
            <div class="upload-toast-bar"><div class="upload-toast-fill" style="width:0%"></div></div>
            <div class="upload-toast-status">${formatSize(file.size)}</div>
        </div>
        ${onCancel ? `
        <button type="button" class="upload-toast-cancel" title="Cancel upload" aria-label="Cancel upload">
            <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>` : ''}
    `;
    host.appendChild(toast);

    const fill = toast.querySelector('.upload-toast-fill');
    const percentLabel = toast.querySelector('.upload-toast-percent');
    const statusLabel = toast.querySelector('.upload-toast-status');
    const cancelButton = toast.querySelector('.upload-toast-cancel');

    if (cancelButton) {
        cancelButton.addEventListener('click', () => onCancel());
    }

    return {
        update(percent) {
            const clamped = Math.max(0, Math.min(100, Math.round(percent)));
            fill.style.width = `${clamped}%`;
            percentLabel.textContent = `${clamped}%`;
        },
        success() {
            fill.style.width = '100%';
            percentLabel.textContent = '100%';
            statusLabel.textContent = 'Uploaded';
            toast.classList.add('upload-toast-success');
            if (cancelButton) cancelButton.remove();
            setTimeout(() => toast.remove(), 1400);
        },
        error(message) {
            toast.classList.add('upload-toast-error');
            statusLabel.textContent = message || 'Upload failed';
            if (cancelButton) cancelButton.remove();
            setTimeout(() => toast.remove(), 2600);
        }
    };
}

function uploadFileWithProgress(url, formData, onProgress) {
    const xhr = new XMLHttpRequest();

    const promise = new Promise((resolve, reject) => {
        xhr.open('POST', url);

        const token = getAuthToken();
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress((event.loaded / event.total) * 100);
            }
        });

        xhr.addEventListener('load', () => {
            let payload = null;
            try {
                payload = JSON.parse(xhr.responseText);
            } catch (error) {
                payload = null;
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(payload);
            } else {
                reject(new Error((payload && payload.error) || 'Upload failed.'));
            }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed.')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

        xhr.send(formData);
    });

    return { promise, cancel: () => xhr.abort() };
}

function formatRelativeTime(value) {
    if (!value) return 'Unknown';

    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;

    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} hr ago`;

    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay} day ago`;

    return date.toLocaleDateString();
}

function setPresence(element, text, isOnline) {
    if (!element) return;
    element.textContent = text;
    element.className = isOnline ? 'presence-line online' : 'presence-line';
}

function renderAvatarElement(element, name, avatarUrl) {
    if (!element) return;

    if (avatarUrl) {
        element.innerHTML = `<img src="${escapeHTML(avatarUrl)}" alt="${escapeHTML(name)}">`;
        element.classList.add('has-image');
    } else {
        element.textContent = getInitials(name);
        element.classList.remove('has-image');
    }
}

function getAvatarMarkup(name, avatarUrl, sizeClass, style = '') {
    const extraStyle = style ? ` style="${style}"` : '';
    if (avatarUrl) {
        return `<div class="avatar ${sizeClass} avatar-photo has-image"${extraStyle}><img src="${escapeHTML(avatarUrl)}" alt="${escapeHTML(name)}"></div>`;
    }
    return `<div class="avatar ${sizeClass} avatar-photo"${extraStyle}>${escapeHTML(getInitials(name))}</div>`;
}

function ensureAudioContext() {
    if (!window.AudioContext && !window.webkitAudioContext) return null;

    if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }

    return audioContext;
}

function playIncomingMessageSound() {
    const context = ensureAudioContext();
    if (!context || context.state !== 'running') return;

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const now = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
}

function requestNotificationPermission() {
    if (!('Notification' in window) || notificationPermissionRequested) return;
    if (Notification.permission !== 'default') return;

    notificationPermissionRequested = true;
    Notification.requestPermission().catch(() => {});
}

function showDesktopNotification(senderId, message) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const sender = appUI.users.find((user) => user.id === senderId);
    const senderName = sender ? sender.displayName || sender.name : 'New message';
    const body = message.type === 'text'
        ? String(message.content || 'New message')
        : 'A new file was shared.';

    const notification = new Notification(senderName, {
        body,
        icon: sender && sender.avatarUrl ? sender.avatarUrl : '/logo-white.png',
        badge: '/logo-white.png',
        tag: `message-${senderId}`,
        renotify: true
    });

    notification.onclick = () => {
        window.focus();
        selectUser(senderId);
        notification.close();
    };
}

async function apiFetch(url, options = {}) {
    const token = getAuthToken();
    const headers = new Headers(options.headers || {});

    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(url, { ...options, headers });
    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        throw new Error((payload && payload.error) || 'Request failed.');
    }

    return payload;
}

function showAuthMode(mode) {
    authMode = mode;
    refs.formLogin.classList.toggle('hidden', mode !== 'login');
    refs.formRegister.classList.toggle('hidden', mode !== 'register');
    refs.btnShowLogin.classList.toggle('active', mode === 'login');
    refs.btnShowRegister.classList.toggle('active', mode === 'register');
    refs.authError.classList.add('hidden');

    if (mode === 'login') {
        refs.authSubtitle.innerHTML = 'Sign in to continue to <span>OF-LAN</span>';
    } else {
        refs.authSubtitle.innerHTML = 'Join the shared workspace on <span>OF-LAN</span>';
    }
}

function handleAuthSwitch(targetMode) {
    if (authMode === targetMode) {
        if (targetMode === 'login') {
            refs.formLogin.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        } else {
            refs.formRegister.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
        return;
    }

    showAuthMode(targetMode);
}

function togglePasswordVisibility(inputId, trigger) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (trigger) {
        trigger.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    }
}

function showAuthError(message) {
    refs.authError.textContent = message;
    refs.authError.classList.remove('hidden');
}

function clearAuthState() {
    setAuthToken('');
    appUI.account = null;
    appUI.devices = [];
    appUI.users = [];
    appUI.myId = null;
    appUI.activeChat = null;
    if (window.disconnectSocket) {
        window.disconnectSocket();
    }
    refs.modalAuth.classList.remove('hidden');
    refs.modalSettings.classList.add('hidden');
    refs.app.classList.add('hidden');
}

function getMessageSeed(userId) {
    if (!appUI.messages[userId]) appUI.messages[userId] = [];
    return appUI.messages[userId];
}

function renderProfile() {
    const account = appUI.account;
    if (!account) return;

    refs.myName.textContent = account.displayName;
    refs.inputDisplayName.value = account.displayName;
    renderAvatarElement(refs.myAvatar, account.displayName, account.avatarUrl);
    renderAvatarElement(refs.settingsAvatarPreview, account.displayName, account.avatarUrl);
    setPresence(refs.myPresence, account.online ? 'Online' : `Last seen ${formatRelativeTime(account.lastSeen)}`, !!account.online);
}

function getUserMeta(user) {
    if (user.online) return 'Online now';
    if (user.lastSeen) return `Last seen ${formatRelativeTime(user.lastSeen)}`;
    return 'Offline';
}

function makeUserList(users) {
    return users.map((user) => {
        const active = appUI.activeChat === user.id ? 'active' : '';
        const dotClass = user.online ? 'online' : 'offline';
        const unread = appUI.unreadCounts[user.id] || 0;
        const hasUnread = unread > 0 ? 'has-unread' : '';
        const badge = unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : '';
        return `
            <li class="person-row ${active} ${hasUnread}" data-user-id="${escapeHTML(user.id)}">
                ${getAvatarMarkup(user.displayName || user.name, user.avatarUrl, 'avatar-sm')}
                <div class="person-copy">
                    <div class="person-name">${escapeHTML(user.displayName || user.name)}</div>
                    <div class="person-meta">${escapeHTML(getUserMeta(user))}</div>
                </div>
                <div class="person-side">
                    <span class="status-dot ${dotClass}"></span>
                    ${badge}
                </div>
            </li>
        `;
    }).join('');
}

function renderUsers() {
    const term = refs.searchUsers.value.trim().toLowerCase();
    const filtered = appUI.users.filter((user) => (user.displayName || user.name || '').toLowerCase().includes(term));
    const onlineUsers = filtered.filter((user) => user.online);
    const offlineUsers = filtered.filter((user) => !user.online);

    refs.contactsList.innerHTML = makeUserList(onlineUsers);
    refs.lanUsersList.innerHTML = makeUserList(offlineUsers);
    refs.onlineCount.textContent = String(appUI.users.filter((user) => user.online).length);

    document.querySelectorAll('.person-row').forEach((row) => {
        row.addEventListener('click', () => {
            const userId = row.getAttribute('data-user-id');
            selectUser(userId);
        });
    });
}

function getIconClass(ext) {
    if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) return 'icon-image';
    if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'icon-video';
    if (['mp3','wav','ogg','flac','aac'].includes(ext)) return 'icon-audio';
    if (['zip','rar','7z','tar','gz'].includes(ext)) return 'icon-archive';
    if (ext === 'pdf') return 'icon-pdf';
    if (['doc','docx'].includes(ext)) return 'icon-doc';
    if (['xls','xlsx','csv'].includes(ext)) return 'icon-sheet';
    return '';
}



function getInlineFileIcon(kind) {

    const lower = String(kind || '').toLowerCase();

    if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(lower)) {
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (['mp4','mov','avi','mkv','webm'].includes(lower)) {
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="2"/><path d="M10 9l5 3-5 3V9Z" fill="currentColor"/></svg>`;
    }
    if (['mp3','wav','ogg','flac','aac'].includes(lower)) {
        return `<svg viewBox="0 0 24 24" fill="none"><path d="M9 18V6l12-2v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="2"/></svg>`;
    }
    if (['zip','rar','7z','tar','gz'].includes(lower)) {
        return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 10v2m0 2v2m0 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    }
    if (['pdf'].includes(lower)) {
        return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 13h2a1 1 0 0 1 0 2H9v-2Zm0 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    }
    if (['doc','docx'].includes(lower)) {
        return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    }
    if (['xls','xlsx','csv'].includes(lower)) {
        return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l6 6m0-6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    }

    return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function renderMessage(message, peerUser) {
    const time = formatTime(message.time || Date.now());
    const side = message.sentByMe ? 'sent' : 'received';
    const tickIcon = message.sentByMe
        ? (message.queued && !message.delivered
            ? `<span class="meta-check queued"><svg viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M6 3.5v2.8l1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>`
            : (message.delivered || message.read
                ? `<span class="meta-check read"><svg viewBox="0 0 16 9" fill="none"><path d="M1 4.5L4 7.5L10 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 7.5L12 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
                : `<span class="meta-check"><svg viewBox="0 0 10 9" fill="none"><path d="M1 4.5L4 7.5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`))
        : '';
    const meta = message.sentByMe ? `${time} ${tickIcon}` : time;

    if (message.type === 'file') {
        const avatarName = message.sentByMe
            ? (appUI.account ? appUI.account.displayName : 'Me')
            : (peerUser ? peerUser.displayName || peerUser.name : 'User');
        const avatarUrl = message.sentByMe
            ? (appUI.account ? appUI.account.avatarUrl : '')
            : (peerUser ? peerUser.avatarUrl : '');
        const avatarStyle = message.sentByMe
            ? 'background: linear-gradient(180deg, #8650f3, #5e2fc4);'
            : 'background: linear-gradient(180deg, #8b5cf6, #6d45db);';

        if (message.uploading) {
            const percent = Math.max(0, Math.min(100, Math.round(message.percent || 0)));
            return `
                <div class="message-row ${side}" data-temp-id="${escapeHTML(message.tempId)}">
                    ${getAvatarMarkup(avatarName, avatarUrl, 'avatar-sm', avatarStyle)}
                    <div class="file-card sent file-card-uploading">
                        <div class="file-card-top">
                            <div class="file-icon ${getIconClass(message.icon || '')}">${getInlineFileIcon(message.icon || 'file')}</div>
                            <div class="file-copy">
                                <div class="file-name">${escapeHTML(message.name || '')}</div>
                                <div class="file-progress"><span class="file-upload-fill" style="width:${percent}%"></span></div>
                            </div>
                        </div>
                        <div class="file-progress-meta">
                            <span>Uploading…</span>
                            <div class="file-upload-actions">
                                <span class="file-upload-percent">${percent}%</span>
                                <button type="button" class="file-upload-cancel" title="Cancel upload" aria-label="Cancel upload">
                                    <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="message-row ${side}">
                ${getAvatarMarkup(avatarName, avatarUrl, 'avatar-sm', avatarStyle)}
                <div class="file-card ${message.sentByMe ? 'sent' : ''}">
                    <div class="file-card-top">
                        <div class="file-icon ${getIconClass(message.icon || '')}">${getInlineFileIcon(message.icon || 'file')}</div>
                        <div class="file-copy">
                            <div class="file-name">${escapeHTML(message.name || message.content)}</div>
                            <div class="file-size">${escapeHTML(message.size || '')}</div>
                        </div>
                        <a href="${escapeHTML(message.content)}" download class="file-download" title="İndir">
                            <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0-4-4m4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                        </a>
                    </div>
                    <div class="message-meta" style="margin-top: 10px;">${meta}</div>
                </div>
            </div>
        `;
    }

    const avatarName = message.sentByMe
        ? (appUI.account ? appUI.account.displayName : 'Me')
        : (peerUser ? peerUser.displayName || peerUser.name : 'User');

    const avatarUrl = message.sentByMe
        ? (appUI.account ? appUI.account.avatarUrl : '')
        : (peerUser ? peerUser.avatarUrl : '');

    return `
        <div class="message-row ${side}">
            ${getAvatarMarkup(avatarName, avatarUrl, 'avatar-sm', message.sentByMe ? 'background: linear-gradient(180deg, #8650f3, #5e2fc4);' : 'background: linear-gradient(180deg, #8b5cf6, #6d45db);')}
            <div class="message-stack">
                <div class="message-bubble">${escapeHTML(message.content)}</div>
                <div class="message-meta">${meta}</div>
            </div>
        </div>
    `;
}

function renderChat(userId) {
    const isMobile = window.innerWidth <= 768;
    refs.app.classList.toggle('mobile-chat-active', isMobile && !!userId);

    if (!userId) {
        refs.noChatSelected.classList.remove('hidden');
        refs.chatContainer.classList.add('hidden');
        refs.chatMessages.innerHTML = '';

        if (isMobile) {
            refs.noChatSelected.classList.add('hidden');
        }
        return;
    }

    const user = appUI.users.find((item) => item.id === userId);
    if (!user) {
        refs.noChatSelected.classList.remove('hidden');
        refs.chatContainer.classList.add('hidden');
        return;
    }

    refs.noChatSelected.classList.add('hidden');
    refs.chatContainer.classList.remove('hidden');
    refs.chatUserName.textContent = user.displayName || user.name;
    renderAvatarElement(refs.chatAvatar, user.displayName || user.name, user.avatarUrl);
    setPresence(refs.chatStatus, user.online ? 'Online' : `Last seen ${formatRelativeTime(user.lastSeen)}`, !!user.online);

    const messages = getMessageSeed(userId);
    const html = ['<div class="day-pill">Today</div>'];

    messages.forEach((message, i) => {
        if (i > 0) html.push('<hr class="msg-sep">');
        html.push(renderMessage(message, user));
    });

    refs.chatMessages.innerHTML = html.join('');
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

async function loadChatHistory(userId) {
    const pendingUploads = (appUI.messages[userId] || []).filter((message) => message.uploading);

    try {
        const payload = await apiFetch(`/api/messages/${userId}`);
        appUI.messages[userId] = [...(payload.messages || []), ...pendingUploads];
    } catch (error) {
        if (!appUI.messages[userId]) {
            appUI.messages[userId] = pendingUploads;
        }
    }
}

function selectUser(userId) {
    appUI.activeChat = userId;
    appUI.unreadCounts[userId] = 0;
    renderUsers();
    loadChatHistory(userId).then(() => renderChat(userId));
}

function closeActiveChat() {
    if (appUI.activeChat) {
        appUI.activeChat = null;
        renderUsers();
        renderChat(null);
    }
}

async function sendChatMessage() {
    const text = refs.messageInput.value.trim();
    if (!text || !appUI.activeChat) return;

    const message = { type: 'text', content: text, time: Date.now(), sentByMe: true };
    const result = await window.sendMessageToPeer(appUI.activeChat, message);

    if (!result || (!result.ok && !result.queued)) return;

    getMessageSeed(appUI.activeChat).push({
        ...message,
        id: result.messageId,
        delivered: !!result.delivered,
        queued: !!result.queued,
        read: !!result.delivered
    });
    refs.messageInput.value = '';
    renderChat(appUI.activeChat);
}

appUI.handleIncomingMessage = (senderId, msgObj) => {
    const seed = getMessageSeed(senderId);
    if (msgObj.id && seed.some((item) => item.id === msgObj.id)) return;

    seed.push({ ...msgObj, sentByMe: false, delivered: true });
    playIncomingMessageSound();

    const shouldNotify = appUI.activeChat !== senderId || document.hidden || !document.hasFocus();
    if (shouldNotify) {
        showDesktopNotification(senderId, msgObj);
    }

    if (appUI.activeChat === senderId) {
        renderChat(senderId);
    } else {
        appUI.unreadCounts[senderId] = (appUI.unreadCounts[senderId] || 0) + 1;
        renderUsers();
    }
};

function syncUserSource(rawUsers) {
    appUI.users = (rawUsers || []).filter((user) => user.id !== appUI.myId);

    if (appUI.activeChat && !appUI.users.some((user) => user.id === appUI.activeChat)) {
        appUI.activeChat = null;
    }

    renderUsers();
    renderChat(appUI.activeChat);
}

function handleSessionState(payload) {
    if (!payload || !payload.account) return;
    appUI.account = payload.account;
    appUI.myId = payload.account.id;
    appUI.devices = payload.devices || [];
    renderProfile();
    renderUsers();
    renderChat(appUI.activeChat);
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

    return `
        <div class="file-badge" style="background: rgba(127, 142, 234, 0.18); color: #7f8eea;">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 3.5h6l4 4V20.5A1.5 1.5 0 0 1 15.5 22h-8A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7.5 4H7v-.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M13 3.5V8h4.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
        </div>
    `;
}

function renderFiles(files) {
    const rows = Array.isArray(files) ? [...files].sort((a, b) => {
        if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
    }) : [];

    if (!rows.length) {
        refs.folderFilesList.innerHTML = `
            <div class="empty-state" style="min-height: 260px;">
                <div class="empty-badge">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                    </svg>
                </div>
                <p style="max-width:280px; margin-top:14px;">No files here yet — upload something to get started.</p>
            </div>
        `;
        return;
    }

    refs.folderFilesList.innerHTML = rows.map((file) => {
        const isDir = !!file.isDir;
        const size = isDir ? '-' : formatSize(file.size);
        const modified = file.mtime
            ? new Date(file.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Today';
        const filePath = (currentFolderDir ? `${currentFolderDir}/` : '') + file.name;
        const actions = isDir
            ? `<button class="file-download" title="Open" onclick="navigateFolder('${filePath}')"><svg viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
            : `<a class="file-download" href="/uploads/${encodeURIComponent(filePath)}" download title="Download"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0-4-4m4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>
               <button class="file-download" title="Delete" onclick="deleteSharedFile('${filePath}')"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;

        return `
            <div class="file-row">
                <div class="file-name-cell">
                    ${getFileBadge(file.name, isDir)}
                    <div class="file-row-name">${escapeHTML(file.name)}</div>
                </div>
                <div class="file-row-size">${escapeHTML(size)}</div>
                <div class="file-row-mod">${escapeHTML(modified)}</div>
                <div class="file-row-actions">${actions}</div>
            </div>
        `;
    }).join('');
}

function renderBreadcrumb() {
    const parts = currentFolderDir.split('/').filter(Boolean);
    if (!parts.length) {
        refs.folderBreadcrumb.innerHTML = '<span style="color:#aab3d4;">Shared</span> <span style="color:#667093;">/</span> <span style="color:#f2f5ff;">Files</span>';
        return;
    }

    let pathAccumulator = '';
    let html = `
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

window.deleteSharedFile = async (filePath) => {
    if (!confirm(`Delete "${filePath.split('/').pop()}"?`)) return;
    try {
        await apiFetch(`/api/folder/file?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
        fetchFiles();
    } catch (e) {
        alert('Could not delete: ' + e.message);
    }
};

async function openAuthenticatedApp(account) {
    appUI.account = account;
    appUI.myId = account.id;
    refs.modalAuth.classList.add('hidden');
    refs.app.classList.remove('hidden');
    renderProfile();
    fetchFiles();

    const socket = window.connectSocket ? window.connectSocket(getAuthToken()) : null;
    if (!socket) return;

    socket.on('connect', () => {
        setPresence(refs.serverPresence, 'Connected', true);
        socket.emit('request_session_state');
    });

    socket.on('disconnect', () => {
        setPresence(refs.serverPresence, 'Disconnected', false);
    });

    socket.on('connect_error', (err) => {
        const msg = err && (err.message || String(err));
        const isAuthError = msg === 'Authentication required' || msg === 'Invalid session';
        if (isAuthError) {
            setPresence(refs.serverPresence, 'Session expired', false);
            clearAuthState();
        } else {
            setPresence(refs.serverPresence, 'Connecting...', false);
        }
    });

    socket.on('update_users', syncUserSource);
    socket.on('session_state', handleSessionState);
    socket.on('direct_message', (payload) => {
        if (!payload || !payload.sender || !payload.message) return;
        appUI.handleIncomingMessage(payload.sender, payload.message);
    });

    socket.on('message_delivered', (payload) => {
        const messageIds = payload && payload.messageIds;
        if (!Array.isArray(messageIds) || !messageIds.length) return;

        let activeChatChanged = false;
        for (const [userId, messages] of Object.entries(appUI.messages)) {
            for (const message of messages) {
                if (message.id && messageIds.includes(message.id)) {
                    message.delivered = true;
                    message.queued = false;
                    message.read = true;
                    if (appUI.activeChat === userId) {
                        activeChatChanged = true;
                    }
                }
            }
        }

        if (activeChatChanged) {
            renderChat(appUI.activeChat);
        }
    });
}

async function hydrateSession() {
    const token = getAuthToken();
    if (!token) {
        refs.modalAuth.classList.remove('hidden');
        refs.app.classList.add('hidden');
        return;
    }

    try {
        const payload = await apiFetch('/api/auth/me');
        appUI.account = payload.account;
        appUI.devices = payload.devices || [];
        await openAuthenticatedApp(payload.account);
    } catch (error) {
        clearAuthState();
    }
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    console.log('[login] submit fired, username:', refs.loginUsername.value.trim());
    try {
        const payload = await apiFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: refs.loginUsername.value.trim(),
                password: refs.loginPassword.value,
                deviceName: getDefaultDeviceName()
            })
        });

        setAuthToken(payload.token, refs.loginRememberMe.checked);
        refs.loginPassword.value = '';
        await hydrateSession();
    } catch (error) {
        showAuthError(error.message);
    }
}

async function handleRegisterSubmit(event) {
    event.preventDefault();
    try {
        const payload = await apiFetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                displayName: refs.registerDisplayName.value.trim(),
                username: refs.registerUsername.value.trim(),
                password: refs.registerPassword.value,
                deviceName: getDefaultDeviceName()
            })
        });

        setAuthToken(payload.token, true);
        refs.registerPassword.value = '';
        await hydrateSession();
    } catch (error) {
        showAuthError(error.message);
    }
}

async function saveSettings() {
    const formData = new FormData();
    formData.append('displayName', refs.inputDisplayName.value.trim());
    if (refs.inputAvatar.files[0]) {
        formData.append('avatar', refs.inputAvatar.files[0]);
    }

    const payload = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: formData
    });

    appUI.account = { ...appUI.account, ...payload.account, online: true };
    renderProfile();
    refs.modalSettings.classList.add('hidden');
    refs.inputAvatar.value = '';

    const socket = getSocketInstance();
    if (socket) {
        socket.emit('profile_updated');
        socket.emit('request_session_state');
    }
}

async function logout() {
    try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        // ignore logout errors while clearing local state
    }

    clearAuthState();
}

function setupEvents() {
    const enableLocalAlerts = () => {
        ensureAudioContext();
        requestNotificationPermission();
    };

    document.addEventListener('click', enableLocalAlerts, { once: true });
    document.addEventListener('keydown', enableLocalAlerts, { once: true });

    refs.btnShowLogin.addEventListener('click', () => handleAuthSwitch('login'));
    refs.btnShowRegister.addEventListener('click', () => handleAuthSwitch('register'));
    document.querySelectorAll('.password-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            togglePasswordVisibility(button.getAttribute('data-target'), button);
        });
    });

    const showContextMenu = (e) => {
        const row = e.target.closest('.person-row');
        if (row) {
            e.preventDefault();
            const userId = row.dataset.userId;
            refs.chatContextMenu.dataset.userId = userId;
            refs.chatContextMenu.classList.remove('hidden');
            refs.chatContextMenu.style.left = `${e.clientX}px`;
            refs.chatContextMenu.style.top = `${e.clientY}px`;
        }
    };

    refs.lanUsersList.addEventListener('contextmenu', showContextMenu);
    refs.contactsList.addEventListener('contextmenu', showContextMenu);

    document.addEventListener('click', (e) => {
        if (!refs.chatContextMenu.classList.contains('hidden') && !refs.chatContextMenu.contains(e.target)) {
            refs.chatContextMenu.classList.add('hidden');
        }
    });

    refs.btnDeleteChat.addEventListener('click', async () => {
        const userId = refs.chatContextMenu.dataset.userId;
        if (!userId) return;
        refs.chatContextMenu.classList.add('hidden');
        try {
            await apiFetch(`/api/messages/${userId}`, { method: 'DELETE' });
        } catch (_) {}
        appUI.messages[userId] = [];
        if (appUI.activeChat === userId) renderChat(userId);
    });

    refs.formLogin.addEventListener('submit', handleLoginSubmit);
    refs.formRegister.addEventListener('submit', handleRegisterSubmit);

    refs.btnSettings.addEventListener('click', () => refs.modalSettings.classList.remove('hidden'));
    refs.closeSettings.addEventListener('click', () => refs.modalSettings.classList.add('hidden'));
    refs.inputAvatar.addEventListener('change', () => {
        const file = refs.inputAvatar.files && refs.inputAvatar.files[0];
        refs.avatarFileName.textContent = file ? file.name : 'No file selected';
    });
    refs.btnSaveSettings.addEventListener('click', async () => {
        try {
            await saveSettings();
        } catch (error) {
            alert(error.message);
        }
    });
    refs.btnLogout.addEventListener('click', logout);

    refs.searchUsers.addEventListener('input', renderUsers);
    refs.btnUsersRefresh.addEventListener('click', () => {
        const socket = getSocketInstance();
        if (socket) socket.emit('request_session_state');
        renderUsers();
    });

    if (refs.btnCloseChat) {
        refs.btnCloseChat.addEventListener('click', closeActiveChat);
    }

    window.addEventListener('resize', () => {
        refs.app.classList.toggle('mobile-chat-active', window.innerWidth <= 768 && !!appUI.activeChat);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!refs.folderSidebar.classList.contains('hidden')) {
                refs.folderSidebar.classList.add('hidden');
            } else if (!refs.modalSettings.classList.contains('hidden')) {
                refs.modalSettings.classList.add('hidden');
            } else {
                closeActiveChat();
            }
        }
    });

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
    refs.chatMessages.addEventListener('click', (event) => {
        const cancelButton = event.target.closest('.file-upload-cancel');
        if (!cancelButton) return;

        const row = cancelButton.closest('[data-temp-id]');
        const tempId = row && row.getAttribute('data-temp-id');
        const cancel = tempId && activeUploads.get(tempId);
        if (cancel) cancel();
    });
    refs.fileInput.addEventListener('change', async () => {
        const file = refs.fileInput.files[0];
        const chatId = appUI.activeChat;
        if (!file || !chatId) { refs.fileInput.value = ''; return; }

        const tempId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const placeholder = {
            type: 'file',
            tempId,
            uploading: true,
            percent: 0,
            name: file.name,
            icon: file.name.split('.').pop().toLowerCase(),
            time: Date.now(),
            sentByMe: true
        };
        getMessageSeed(chatId).push(placeholder);
        if (appUI.activeChat === chatId) renderChat(chatId);

        const formData = new FormData();
        formData.append('file', file);

        const updateProgress = (percent) => {
            const clamped = Math.max(0, Math.min(100, Math.round(percent)));
            placeholder.percent = clamped;
            const bubble = refs.chatMessages.querySelector(`[data-temp-id="${tempId}"]`);
            if (bubble) {
                const fill = bubble.querySelector('.file-upload-fill');
                const percentLabel = bubble.querySelector('.file-upload-percent');
                if (fill) fill.style.width = `${clamped}%`;
                if (percentLabel) percentLabel.textContent = `${clamped}%`;
            }
        };

        const upload = uploadFileWithProgress('/api/folder/dm-upload', formData, updateProgress);
        activeUploads.set(tempId, () => upload.cancel());

        let uploaded;
        try {
            uploaded = await upload.promise;
        } catch (e) {
            activeUploads.delete(tempId);
            const seed = getMessageSeed(chatId);
            const index = seed.indexOf(placeholder);
            if (index !== -1) seed.splice(index, 1);
            if (appUI.activeChat === chatId) renderChat(chatId);
            refs.fileInput.value = '';
            return;
        }

        activeUploads.delete(tempId);
        refs.fileInput.value = '';

        const message = {
            type: 'file',
            content: uploaded.url,
            name: uploaded.name,
            size: formatSize(uploaded.size),
            icon: uploaded.name.split('.').pop().toLowerCase(),
            time: Date.now(),
            sentByMe: true
        };

        const result = await window.sendMessageToPeer(chatId, message);
        const seed = getMessageSeed(chatId);
        const index = seed.indexOf(placeholder);

        if (!result || (!result.ok && !result.queued)) {
            if (index !== -1) seed.splice(index, 1);
            if (appUI.activeChat === chatId) renderChat(chatId);
            return;
        }

        const finalMessage = {
            ...message,
            id: result.messageId,
            delivered: !!result.delivered,
            queued: !!result.queued,
            read: !!result.delivered
        };

        if (index !== -1) {
            seed[index] = finalMessage;
        } else {
            seed.push(finalMessage);
        }
        if (appUI.activeChat === chatId) renderChat(chatId);
    });

    refs.btnSharedFolder.addEventListener('click', () => {
        fetchFiles();
        refs.folderSidebar.classList.remove('hidden');
    });

    if (refs.btnCloseFolder) {
        refs.btnCloseFolder.addEventListener('click', () => {
            refs.folderSidebar.classList.add('hidden');
        });
    }

    refs.btnFolderUpload.addEventListener('click', () => refs.folderUploadInput.click());
    refs.folderUploadInput.addEventListener('change', async () => {
        const file = refs.folderUploadInput.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        const query = currentFolderDir ? `?dir=${encodeURIComponent(currentFolderDir)}` : '';
        const upload = uploadFileWithProgress(`/api/folder/upload${query}`, formData, (percent) => toast.update(percent));
        const toast = createUploadToast(file, { onCancel: () => upload.cancel() });

        try {
            await upload.promise;
            toast.success();
            fetchFiles();
        } catch (error) {
            toast.error(error.message);
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

function init() {
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        refs.noChatSelected.classList.add('hidden');
        refs.chatContainer.classList.add('hidden');
    }

    setupEvents();
    showAuthMode('login');
    hydrateSession();
}

init();
