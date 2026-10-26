import { IBackend } from './backend';
import { IState } from '../core/types';
import { randomUUID } from 'crypto';

export interface HTTPBackendConfig {
    address: string;
    lock_address?: string;
    unlock_address?: string;
    lock_method?: string;
    unlock_method?: string;
    update_method?: 'POST' | 'PUT';
    headers?: Record<string, string>;
    username?: string;
    password?: string;
}

export class HTTPBackend implements IBackend {
    private address: string;
    private lockAddress?: string;
    private unlockAddress?: string;
    private lockMethod: string;
    private unlockMethod: string;
    private updateMethod: 'POST' | 'PUT';
    private headers: Record<string, string>;
    private currentLockId?: string;

    constructor(
        private config: HTTPBackendConfig,
        private workspace: string = 'default'
    ) {
        if (!config.address) {
            throw new Error('HTTP backend configuration must specify an "address" URL.');
        }

        this.headers = { ...config.headers };
        if (config.username && config.password) {
            const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
            this.headers['Authorization'] = `Basic ${auth}`;
        }

        this.updateMethod = (config.update_method || 'POST').toUpperCase() as 'POST' | 'PUT';
        this.lockMethod = (config.lock_method || 'POST').toUpperCase();
        this.unlockMethod = (config.unlock_method || 'DELETE').toUpperCase();

        // Resolve workspace in address
        this.address = this.resolveWorkspaceUrl(config.address, workspace);
        if (config.lock_address) {
            this.lockAddress = this.resolveWorkspaceUrl(config.lock_address, workspace);
        }
        if (config.unlock_address) {
            this.unlockAddress = this.resolveWorkspaceUrl(config.unlock_address, workspace);
        }
    }

    private resolveWorkspaceUrl(rawUrl: string, ws: string): string {
        if (rawUrl.includes('${workspace}')) {
            return rawUrl.replace(/\$\{workspace\}/g, ws);
        }
        if (rawUrl.includes('{workspace}')) {
            return rawUrl.replace(/\{workspace\}/g, ws);
        }
        if (ws !== 'default') {
            const separator = rawUrl.includes('?') ? '&' : '?';
            return `${rawUrl}${separator}env=${encodeURIComponent(ws)}`;
        }
        return rawUrl;
    }

    async read(): Promise<IState> {
        const res = await fetch(this.address, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                ...this.headers
            }
        });

        if (res.status === 404) {
            return null as unknown as IState;
        }

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP backend read failed (${res.status} ${res.statusText}): ${text}`);
        }

        const text = await res.text();
        if (!text || text.trim() === '') {
            return null as unknown as IState;
        }

        return JSON.parse(text) as IState;
    }

    async exists(): Promise<boolean> {
        try {
            const res = await fetch(this.address, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    ...this.headers
                }
            });
            if (res.status === 404) return false;
            if (res.ok) {
                const text = await res.text();
                return Boolean(text && text.trim().length > 0);
            }
            return false;
        } catch {
            return false;
        }
    }

    async write(state: IState): Promise<void> {
        const payload = JSON.stringify(state, null, 2);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.headers
        };
        if (this.currentLockId) {
            headers['X-Terraform-Lock-ID'] = this.currentLockId;
        }

        const res = await fetch(this.address, {
            method: this.updateMethod,
            headers,
            body: payload
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP backend write failed (${res.status} ${res.statusText}): ${text}`);
        }
    }

    async lock(timeout: string): Promise<boolean> {
        if (!this.lockAddress) {
            return true;
        }

        const lockId = randomUUID();
        const lockInfo = {
            ID: lockId,
            Operation: 'OperationTypeApply',
            Info: '',
            Who: process.env.USER || process.env.USERNAME || 'testform',
            Version: '1.0.0',
            Created: new Date().toISOString(),
            Path: this.address
        };

        const res = await fetch(this.lockAddress, {
            method: this.lockMethod,
            headers: {
                'Content-Type': 'application/json',
                ...this.headers
            },
            body: JSON.stringify(lockInfo)
        });

        if (res.status === 423 || res.status === 409) {
            return false;
        }

        if (res.ok) {
            this.currentLockId = lockId;
            return true;
        }

        return false;
    }

    async unlock(): Promise<boolean> {
        if (!this.unlockAddress) {
            return true;
        }

        const lockInfo = {
            ID: this.currentLockId || ''
        };

        const res = await fetch(this.unlockAddress, {
            method: this.unlockMethod,
            headers: {
                'Content-Type': 'application/json',
                ...this.headers
            },
            body: JSON.stringify(lockInfo)
        });

        if (res.ok) {
            this.currentLockId = undefined;
            return true;
        }

        return false;
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        if (!this.unlockAddress) {
            return { success: true };
        }

        const res = await fetch(this.unlockAddress, {
            method: this.unlockMethod,
            headers: {
                'Content-Type': 'application/json',
                ...this.headers
            },
            body: JSON.stringify({ ID: lockId })
        });

        if (res.ok) {
            return { success: true };
        }
        const text = await res.text();
        return { success: false, error: text };
    }

    async isLocked(): Promise<boolean> {
        if (!this.lockAddress) return false;
        return Boolean(this.currentLockId);
    }

    async listWorkspaces(): Promise<string[]> {
        return ['default'];
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        if (name === 'default') return false;
        return true;
    }
}

