"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalBackend = void 0;
const path_1 = require("path");
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const const_1 = require("../../const");
class LocalBackend {
    dir;
    customStatePath;
    customBackupPath;
    workspace;
    constructor(dir, customStatePath, customBackupPath, workspace = 'default') {
        this.dir = dir;
        this.customStatePath = customStatePath;
        this.customBackupPath = customBackupPath;
        this.workspace = workspace;
    }
    getWorkspaceStatePath() {
        if (this.customStatePath) {
            return (0, path_1.resolve)(this.dir, this.customStatePath);
        }
        if (this.workspace !== 'default') {
            return (0, path_1.resolve)(this.dir, `${const_1.FILE_STATE}.d`, this.workspace, const_1.FILE_STATE);
        }
        return (0, path_1.resolve)(this.dir, const_1.FILE_STATE);
    }
    resolvePath() {
        const path = this.getWorkspaceStatePath();
        if ((0, fs_1.existsSync)(path))
            return path;
        if (this.workspace === 'default') {
            const cwd = (0, path_1.resolve)(this.dir, const_1.FILE_STATE);
            if ((0, fs_1.existsSync)(cwd))
                return cwd;
        }
        return null;
    }
    lockPath() {
        const path = this.resolvePath() ?? this.getWorkspaceStatePath();
        return `${path}.lock`;
    }
    async exists() {
        return this.resolvePath() !== null;
    }
    async read() {
        const path = this.resolvePath();
        if (!path || !(0, fs_1.existsSync)(path)) {
            return {
                version: const_1.VERSION_STATE,
                serial: 0,
                lineage: (0, crypto_1.randomUUID)(),
                lastSync: '',
                resources: [],
            };
        }
        const raw = await fs_1.promises.readFile(path, "utf-8");
        return JSON.parse(raw);
    }
    async write(state) {
        const path = this.resolvePath() ?? this.getWorkspaceStatePath();
        // Ensure directory exists
        const dirPath = (0, path_1.resolve)(path, '..');
        if (!(0, fs_1.existsSync)(dirPath)) {
            await fs_1.promises.mkdir(dirPath, { recursive: true });
        }
        const backupPath = this.customBackupPath ?
            (0, path_1.resolve)(this.dir, this.customBackupPath) :
            `${path}.backup`;
        if ((0, fs_1.existsSync)(path)) {
            await fs_1.promises.copyFile(path, backupPath);
        }
        await fs_1.promises.writeFile(path, JSON.stringify(state, null, 2), "utf-8");
    }
    async lock(timeoutRaw) {
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const lockFile = this.lockPath();
        const start = Date.now();
        while (true) {
            try {
                // wx flag: open for writing, fails if the file exists
                await fs_1.promises.writeFile(lockFile, JSON.stringify({
                    id: (0, crypto_1.randomUUID)(),
                    operation: 'Operation',
                    who: process.env.USER || 'unknown',
                    created: new Date().toISOString()
                }, null, 2), { flag: 'wx' });
                return true;
            }
            catch (err) {
                if (err.code === 'EEXIST') {
                    if (Date.now() - start >= timeoutMs) {
                        return false;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
                else {
                    throw err;
                }
            }
        }
    }
    async unlock() {
        const lockFile = this.lockPath();
        if ((0, fs_1.existsSync)(lockFile)) {
            try {
                await fs_1.promises.unlink(lockFile);
                return true;
            }
            catch (e) {
                return false;
            }
        }
        return true;
    }
    async forceUnlock(lockId) {
        const lockFile = this.lockPath();
        if (!(0, fs_1.existsSync)(lockFile)) {
            return { success: false, error: `No lock exists for the given state. (Path checked: ${lockFile})` };
        }
        try {
            const raw = await fs_1.promises.readFile(lockFile, 'utf-8');
            const info = JSON.parse(raw);
            if (info.id !== lockId) {
                return { success: false, currentLockId: info.id };
            }
            await fs_1.promises.unlink(lockFile);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: `The lock file could not be read or parsed.` };
        }
    }
    async isLocked() {
        return (0, fs_1.existsSync)(this.lockPath());
    }
    async listWorkspaces() {
        const workspaces = ['default'];
        const dPath = (0, path_1.resolve)(this.dir, `${const_1.FILE_STATE}.d`);
        if ((0, fs_1.existsSync)(dPath)) {
            const entries = await fs_1.promises.readdir(dPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    workspaces.push(entry.name);
                }
            }
        }
        return workspaces;
    }
    async deleteWorkspace(name) {
        if (name === 'default')
            return false;
        const wPath = (0, path_1.resolve)(this.dir, `${const_1.FILE_STATE}.d`, name);
        if ((0, fs_1.existsSync)(wPath)) {
            await fs_1.promises.rm(wPath, { recursive: true, force: true });
            return true;
        }
        return false;
    }
}
exports.LocalBackend = LocalBackend;
