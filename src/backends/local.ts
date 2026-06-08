import { join, resolve } from "path";
import { existsSync, promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { IBackend } from './backend';
import { IState } from '../core/types';
import { FILE_STATE, VERSION_STATE } from '../core/const';

export class LocalBackend implements IBackend {
    constructor(
        private dir: string,
        private customStatePath?: string,
        private customBackupPath?: string,
        private workspace: string = 'default'
    ) {}

    private getWorkspaceStatePath(): string {
        if (this.customStatePath) {
            return resolve(this.dir, this.customStatePath);
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

        await fs.writeFile(path, JSON.stringify(state, null, 2), "utf-8");
    }

    async lock(timeoutRaw: string): Promise<boolean> {
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const lockFile = this.lockPath();
        const start = Date.now();

        while (true) {
            try {
                // wx flag: open for writing, fails if the file exists
                await fs.writeFile(lockFile, JSON.stringify({
                    id: randomUUID(),
                    operation: 'Operation',
                    who: process.env.USER || 'unknown',
                    created: new Date().toISOString()
                }, null, 2), { flag: 'wx' });
                return true;
            } catch (err: any) {
                if (err.code === 'EEXIST') {
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
        return existsSync(this.lockPath());
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
