import { resolve } from "path";
import { existsSync, promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { IBackend } from './backend';
import { IState } from '../core/types';
import { FILE_STATE, VERSION_STATE } from '../core/const';
import { getSystemUser } from '../core/utils';

const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;

interface LockFilePayload {
    id?: string;
    operation?: string;
    who?: string;
    created?: string;
    expiresAt?: string;
    pid?: number;
    hostname?: string;
}

function getLockTtlMs(): number {
    const raw = Number(process.env.TESTFORM_LOCK_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOCK_TTL_MS;
}

function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err: any) {
        return err?.code === 'EPERM';
    }
}

function isLockPayloadStale(info: LockFilePayload, ttlMs: number): boolean {
    const now = Date.now();
    if (info.expiresAt) {
        const expMs = Date.parse(info.expiresAt);
        if (Number.isFinite(expMs) && now >= expMs) {
            return true;
        }
    }
    if (info.created) {
        const createdMs = Date.parse(info.created);
        if (Number.isFinite(createdMs) && now - createdMs >= ttlMs) {
            return true;
        }
    }
    if (
        typeof info.pid === 'number' &&
        info.pid !== process.pid &&
        (!info.hostname || info.hostname === hostname()) &&
        !isProcessAlive(info.pid)
    ) {
        return true;
    }
    return false;
}

export class LocalBackend implements IBackend {
    constructor(
        private dir: string,
        private customStatePath?: string,
        private customBackupPath?: string,
        private workspace: string = 'default'
    ) {}

    private getWorkspaceStatePath(): string {
        if (this.customStatePath) {
            const dirResolved = resolve(this.dir, this.customStatePath);
            if (existsSync(dirResolved)) return dirResolved;
            const cwdResolved = resolve(process.cwd(), this.customStatePath);
            if (existsSync(cwdResolved)) return cwdResolved;
            return dirResolved;
        }
        if (this.workspace !== 'default') {
            return resolve(this.dir, `${FILE_STATE}.d`, this.workspace, FILE_STATE);
        }
        return resolve(this.dir, FILE_STATE);
    }

    private resolvePath(): string | null {
        const path = this.getWorkspaceStatePath();
        if (existsSync(path)) return path;
        if (this.workspace === 'default') {
            const cwd = resolve(this.dir, FILE_STATE);
            if (existsSync(cwd)) return cwd;
        }
        return null;
    }

    private lockPath(): string {
        const path = this.resolvePath() ?? this.getWorkspaceStatePath();
        return `${path}.lock`;
    }

    async exists(): Promise<boolean> {
        return this.resolvePath() !== null;
    }

    async read(): Promise<IState> {
        const path = this.resolvePath();

        if (!path || !existsSync(path)) {
            return {
                version: VERSION_STATE,
                serial: 0,
                lineage: randomUUID(),
                lastSync: '',
                resources: [],
            };
        }

        const raw = await fs.readFile(path, "utf-8");
        return JSON.parse(raw) as IState;
    }

    async write(state: IState): Promise<void> {
        const path = this.resolvePath() ?? this.getWorkspaceStatePath();
        
        // Ensure directory exists
        const dirPath = resolve(path, '..');
        if (!existsSync(dirPath)) {
            await fs.mkdir(dirPath, { recursive: true });
        }

        const backupPath = this.customBackupPath ? 
            resolve(this.dir, this.customBackupPath) : 
            `${path}.backup`;

        if (existsSync(path)) {
            await fs.copyFile(path, backupPath);
        }

        const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
        try {
            await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
            for (let attempt = 0; ; attempt++) {
                try {
                    await fs.rename(tmpPath, path);
                    break;
                } catch (err: any) {
                    const transient = err?.code === 'EPERM' || err?.code === 'EACCES' || err?.code === 'EBUSY';
                    if (!transient || attempt >= 3) {
                        throw err;
                    }
                    await new Promise(r => setTimeout(r, 15 * (attempt + 1)));
                }
            }
        } catch (err) {
            await fs.unlink(tmpPath).catch(() => {});
            throw err;
        }
    }

    private async inspectStaleLock(lockFile: string, ttlMs: number): Promise<boolean> {
        try {
            const raw = await fs.readFile(lockFile, 'utf-8');
            const info = JSON.parse(raw) as LockFilePayload;
            return isLockPayloadStale(info, ttlMs);
        } catch {
            return false;
        }
    }

    async lock(timeoutRaw: string, lockMeta?: { operation?: string; who?: string }): Promise<boolean> {
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const lockFile = this.lockPath();
        const start = Date.now();
        const ttlMs = getLockTtlMs();

        const defaultOp = process.argv[2] ? `OperationType${process.argv[2].charAt(0).toUpperCase() + process.argv[2].slice(1)}` : 'Operation';
        const operation = lockMeta?.operation || defaultOp;
        const who = lockMeta?.who || getSystemUser();

        while (true) {
            try {
                const now = Date.now();
                // wx flag: open for writing, fails if the file exists
                await fs.writeFile(lockFile, JSON.stringify({
                    id: randomUUID(),
                    operation,
                    who,
                    pid: process.pid,
                    hostname: hostname(),
                    created: new Date(now).toISOString(),
                    expiresAt: new Date(now + ttlMs).toISOString(),
                }, null, 2), { flag: 'wx' });
                return true;
            } catch (err: any) {
                if (err.code === 'EEXIST') {
                    if (await this.inspectStaleLock(lockFile, ttlMs)) {
                        try {
                            await fs.unlink(lockFile);
                            continue;
                        } catch {
                            // Another process may have already replaced or released it
                        }
                    }
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
        const lockFile = this.lockPath();
        if (existsSync(lockFile)) {
            try {
                await fs.unlink(lockFile);
                return true;
            } catch (e) {
                return false;
            }
        }
        return true;
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        const lockFile = this.lockPath();
        if (!existsSync(lockFile)) {
            return { success: false, error: `No lock exists for the given state. (Path checked: ${lockFile})` };
        }

        try {
            const raw = await fs.readFile(lockFile, 'utf-8');
            const info = JSON.parse(raw);

            if (info.id !== lockId) {
                return { success: false, currentLockId: info.id };
            }

            await fs.unlink(lockFile);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: `The lock file could not be read or parsed.` };
        }
    }

    async isLocked(): Promise<boolean> {
        const lockFile = this.lockPath();
        if (!existsSync(lockFile)) return false;
        if (await this.inspectStaleLock(lockFile, getLockTtlMs())) {
            return false;
        }
        return true;
    }

    async getLockInfo(): Promise<{ id?: string; path?: string; who?: string; operation?: string; created?: string } | null> {
        const lockFile = this.lockPath();
        if (!existsSync(lockFile)) return null;
        try {
            const raw = await fs.readFile(lockFile, 'utf-8');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    async listWorkspaces(): Promise<string[]> {
        const workspaces = ['default'];
        const dPath = resolve(this.dir, `${FILE_STATE}.d`);
        if (existsSync(dPath)) {
            const entries = await fs.readdir(dPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    workspaces.push(entry.name);
                }
            }
        }
        return workspaces;
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        if (name === 'default') return false;
        const wPath = resolve(this.dir, `${FILE_STATE}.d`, name);
        if (existsSync(wPath)) {
            await fs.rm(wPath, { recursive: true, force: true });
            return true;
        }
        return false;
    }
}
