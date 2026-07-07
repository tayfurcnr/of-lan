const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const BACKUP_DIR = path.join(ROOT_DIR, '.oflan-backup');
const PENDING_ARCHIVE = path.join(BACKUP_DIR, 'pending-restore.tar.gz');
const PENDING_META = path.join(BACKUP_DIR, 'pending-restore.json');
const PENDING_RESET_META = path.join(BACKUP_DIR, 'pending-reset.json');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function clearRestoreTargets() {
    for (const target of [DATA_DIR, UPLOADS_DIR]) {
        if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
}

function readPendingMeta() {
    if (!fs.existsSync(PENDING_META)) return null;

    try {
        return JSON.parse(fs.readFileSync(PENDING_META, 'utf8'));
    } catch (error) {
        return null;
    }
}

function stageRestoreArchive(sourceArchivePath, originalName = 'backup.tar.gz') {
    ensureDir(BACKUP_DIR);
    try {
        fs.rmSync(PENDING_RESET_META, { force: true });
    } catch (_) {}
    fs.copyFileSync(sourceArchivePath, PENDING_ARCHIVE);
    fs.writeFileSync(PENDING_META, JSON.stringify({
        originalName,
        stagedAt: new Date().toISOString()
    }, null, 2));
}

function stageSystemReset(reason = 'admin_reset') {
    ensureDir(BACKUP_DIR);
    try {
        fs.rmSync(PENDING_ARCHIVE, { force: true });
        fs.rmSync(PENDING_META, { force: true });
    } catch (_) {}
    fs.writeFileSync(PENDING_RESET_META, JSON.stringify({
        reason,
        stagedAt: new Date().toISOString()
    }, null, 2));
}

function validateTarArchive(archivePath) {
    const result = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
    if (result.status !== 0) {
        const message = (result.stderr || result.stdout || 'Invalid archive').trim();
        throw new Error(message || 'Invalid archive');
    }
}

function applyPendingRestore() {
    if (fs.existsSync(PENDING_RESET_META)) {
        return { applied: false, reason: 'Pending reset exists.' };
    }

    if (!fs.existsSync(PENDING_ARCHIVE) || !fs.existsSync(PENDING_META)) {
        return { applied: false, reason: 'No pending restore found.' };
    }

    const meta = readPendingMeta() || {};
    const workDir = path.join(BACKUP_DIR, `work-${Date.now()}`);
    ensureDir(workDir);

    const result = spawnSync('tar', ['-xzf', PENDING_ARCHIVE, '-C', workDir], { encoding: 'utf8' });
    if (result.status !== 0) {
        fs.rmSync(workDir, { recursive: true, force: true });
        const message = (result.stderr || result.stdout || 'Failed to extract archive').trim();
        throw new Error(message || 'Failed to extract archive');
    }

    const stagedData = path.join(workDir, 'data');
    const stagedUploads = path.join(workDir, 'uploads');

    if (!fs.existsSync(stagedData) || !fs.existsSync(stagedUploads)) {
        fs.rmSync(workDir, { recursive: true, force: true });
        throw new Error('Backup archive is missing data/ or uploads/.');
    }

    clearRestoreTargets();

    fs.renameSync(stagedData, DATA_DIR);
    fs.renameSync(stagedUploads, UPLOADS_DIR);

    fs.rmSync(workDir, { recursive: true, force: true });

    try {
        fs.rmSync(PENDING_ARCHIVE, { force: true });
        fs.rmSync(PENDING_META, { force: true });
    } catch (error) {
        // Non-fatal cleanup failure.
    }

    return {
        applied: true,
        originalName: meta.originalName || 'backup.tar.gz',
        stagedAt: meta.stagedAt || null
    };
}

function applyPendingReset() {
    if (!fs.existsSync(PENDING_RESET_META)) {
        return { applied: false, reason: 'No pending reset found.' };
    }

    clearRestoreTargets();
    ensureDir(DATA_DIR);
    ensureDir(UPLOADS_DIR);

    try {
        fs.rmSync(PENDING_RESET_META, { force: true });
    } catch (error) {
        // Non-fatal cleanup failure.
    }

    return { applied: true };
}

module.exports = {
    BACKUP_DIR,
    PENDING_ARCHIVE,
    PENDING_META,
    PENDING_RESET_META,
    applyPendingRestore,
    applyPendingReset,
    ensureDir,
    stageRestoreArchive,
    stageSystemReset,
    validateTarArchive
};
