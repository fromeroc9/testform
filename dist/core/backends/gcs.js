"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GCSBackend = void 0;
const storage_1 = require("@google-cloud/storage");
const crypto_1 = require("crypto");
const const_1 = require("../../const");
class GCSBackend {
    config;
    workspace;
    storage;
    bucketClient;
    stateKey;
    lockKey;
    lockId;
    constructor(config, workspace = 'default') {
        this.config = config;
        this.workspace = workspace;
        const storageOptions = {};
        if (config.credentials) {
            storageOptions.keyFilename = config.credentials;
        }
        this.storage = new storage_1.Storage(storageOptions);
        this.bucketClient = this.storage.bucket(config.bucket);
        let prefix = this.config.prefix || '';
        if (prefix && !prefix.endsWith('/')) {
            prefix += '/';
        }
        const originalKey = const_1.FILE_STATE;
        if (this.workspace !== 'default') {
            this.stateKey = `${prefix}env:/${this.workspace}/${originalKey}`;
        }
        else {
            this.stateKey = `${prefix}${originalKey}`;
        }
        this.lockKey = `${this.stateKey}.tflock`;
    }
    emptyState() {
        return {
            version: const_1.VERSION_STATE,
            serial: 0,
            lineage: (0, crypto_1.randomUUID)(),
            lastSync: '',
            resources: []
        };
    }
    async exists() {
        try {
            const [exists] = await this.bucketClient.file(this.config.prefix).exists();
            return exists;
        }
        catch (e) {
            return false;
        }
    }
    async read() {
        try {
            const file = this.bucketClient.file(this.stateKey);
            const [exists] = await file.exists();
            if (!exists) {
                return this.emptyState();
            }
            const [content] = await file.download();
            return JSON.parse(content.toString('utf8'));
        }
        catch (err) {
            return this.emptyState();
        }
    }
    async write(state) {
        const file = this.bucketClient.file(this.stateKey);
        const content = JSON.stringify(state, null, 2);
        await file.save(content, {
            contentType: 'application/json'
        });
    }
    async lock(timeoutRaw) {
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const start = Date.now();
        const file = this.bucketClient.file(this.lockKey);
        const lockPayload = JSON.stringify({
            id: (0, crypto_1.randomUUID)(),
            operation: 'Operation',
            who: process.env.USER || 'unknown',
            created: new Date().toISOString()
        });
        while (true) {
            try {
                // ifGenerationMatch: 0 ensures the file is created ONLY if it does not already exist.
                await file.save(lockPayload, {
                    preconditionOpts: { ifGenerationMatch: 0 }
                });
                this.lockId = lockPayload;
                return true;
            }
            catch (err) {
                // 412 Precondition Failed means the file already exists (lock is acquired by someone else)
                if (err.code === 412 || err.code === '412') {
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
        if (!this.lockId)
            return true;
        const file = this.bucketClient.file(this.lockKey);
        try {
            const [exists] = await file.exists();
            if (exists) {
                await file.delete();
            }
            this.lockId = undefined;
            return true;
        }
        catch (err) {
            return false;
        }
    }
    async forceUnlock(id) {
        const file = this.bucketClient.file(this.lockKey);
        try {
            const [exists] = await file.exists();
            if (!exists) {
                return { success: false, error: 'No lock exists for the given state.' };
            }
            const [content] = await file.download();
            const info = JSON.parse(content.toString('utf8'));
            if (info.id !== id) {
                return { success: false, currentLockId: info.id };
            }
            await file.delete();
            this.lockId = undefined;
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    }
    async isLocked() {
        const file = this.bucketClient.file(this.lockKey);
        try {
            const [exists] = await file.exists();
            return exists;
        }
        catch (e) {
            return false;
        }
    }
    async listWorkspaces() {
        const workspaces = new Set(['default']);
        try {
            let prefix = this.config.prefix || '';
            if (prefix && !prefix.endsWith('/')) {
                prefix += '/';
            }
            const searchPrefix = `${prefix}env:/`;
            const [files] = await this.bucketClient.getFiles({ prefix: searchPrefix });
            for (const file of files) {
                const relName = file.name.substring(searchPrefix.length);
                const match = relName.match(/^([^\/]+)\//);
                if (match) {
                    workspaces.add(match[1]);
                }
            }
        }
        catch (e) {
            // fallback
        }
        return Array.from(workspaces);
    }
    async deleteWorkspace(name) {
        if (name === 'default')
            return false;
        try {
            let prefix = this.config.prefix || '';
            if (prefix && !prefix.endsWith('/')) {
                prefix += '/';
            }
            const targetKey = `${prefix}env:/${name}/${const_1.FILE_STATE}`;
            const targetClient = this.bucketClient.file(targetKey);
            const [exists] = await targetClient.exists();
            if (exists) {
                await targetClient.delete();
                return true;
            }
            return false;
        }
        catch (e) {
            return false;
        }
    }
}
exports.GCSBackend = GCSBackend;
