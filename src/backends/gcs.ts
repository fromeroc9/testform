import { Storage, Bucket } from '@google-cloud/storage';
import { randomUUID } from 'crypto';
import { IBackend } from './backend';
import { IState } from '../core/types';
import { VERSION_STATE, FILE_STATE } from '../core/const';

export interface GCSBackendConfig {
    bucket: string;
    prefix?: string;
    credentials?: string;
}

export class GCSBackend implements IBackend {
    private storage: Storage;
    private bucketClient: Bucket;
    private stateKey: string;
    private lockKey: string;
    private lockId?: string;

    constructor(private config: GCSBackendConfig, private workspace: string = 'default') {
        const storageOptions: any = {};
        if (config.credentials) {
            storageOptions.keyFilename = config.credentials;
        }

        this.storage = new Storage(storageOptions);
        this.bucketClient = this.storage.bucket(config.bucket);

        let prefix = this.config.prefix || '';
        if (prefix && !prefix.endsWith('/')) {
            prefix += '/';
        }

        const originalKey = FILE_STATE;
        if (this.workspace !== 'default') {
            this.stateKey = `${prefix}env:/${this.workspace}/${originalKey}`;
        } else {
            this.stateKey = `${prefix}${originalKey}`;
        }

        this.lockKey = `${this.stateKey}.tflock`;
    }

    private emptyState(): IState {
        return {
            version: VERSION_STATE,
            serial: 0,
            lineage: randomUUID(),
            lastSync: '',
            resources: []
        };
    }

    async exists(): Promise<boolean> {
        try {
            const [exists] = await this.bucketClient.file(this.config.prefix!).exists();
            return exists;
        } catch (e: any) {
            return false;
        }
    }

    async read(): Promise<IState> {
        try {
            const file = this.bucketClient.file(this.stateKey);
            const [exists] = await file.exists();
            if (!exists) {
                return this.emptyState();
            }

            const [content] = await file.download();
            return JSON.parse(content.toString('utf8'));
        } catch (err: any) {
            return this.emptyState();
        }
    }

    async write(state: IState): Promise<void> {
        const file = this.bucketClient.file(this.stateKey);
        const content = JSON.stringify(state, null, 2);

        await file.save(content, {
            contentType: 'application/json'
        });
    }

    async lock(timeoutRaw: string): Promise<boolean> {
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const start = Date.now();

        const file = this.bucketClient.file(this.lockKey);
        const lockPayload = JSON.stringify({
            id: randomUUID(),
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
            } catch (err: any) {
                // 412 Precondition Failed means the file already exists (lock is acquired by someone else)
                if (err.code === 412 || err.code === '412') {
                    if (Date.now() - start >= timeoutMs) {
                        return false;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    throw err;
                }
            }
        }
    }

    async unlock(): Promise<boolean> {
        if (!this.lockId) return true;

        const file = this.bucketClient.file(this.lockKey);
        try {
            const [exists] = await file.exists();
            if (exists) {
                await file.delete();
            }
            this.lockId = undefined;
            return true;
        } catch (err) {
            return false;
        }
    }

    async forceUnlock(id: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
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
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    async isLocked(): Promise<boolean> {
        const file = this.bucketClient.file(this.lockKey);
        try {
            const [exists] = await file.exists();
            return exists;
        } catch (e) {
            return false;
        }
    }

    async listWorkspaces(): Promise<string[]> {
        const workspaces = new Set<string>(['default']);
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
        } catch (e) {
            // fallback
        }
        return Array.from(workspaces);
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        if (name === 'default') return false;
        try {
            let prefix = this.config.prefix || '';
            if (prefix && !prefix.endsWith('/')) {
                prefix += '/';
            }
            const targetKey = `${prefix}env:/${name}/${FILE_STATE}`;
            const targetClient = this.bucketClient.file(targetKey);
            const [exists] = await targetClient.exists();
            if (exists) {
                await targetClient.delete();
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }
}
