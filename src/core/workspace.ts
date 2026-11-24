import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'fs';

export function isBackendEqual(a: any, b: any): boolean {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    const ignoreKeys = new Set(['token_env', 'tokenenv', 'token', 'credentials']);
    const aKeys = Object.keys(a.config || {}).filter(k => !ignoreKeys.has(k) && a.config[k] !== undefined && a.config[k] !== '');
    const bKeys = Object.keys(b.config || {}).filter(k => !ignoreKeys.has(k) && b.config[k] !== undefined && b.config[k] !== '');
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
        if (String(a.config[k] || '') !== String(b.config[k] || '')) return false;
    }
    return true;
}

export class WorkspaceManager {
    private testformDir: string;
    private cacheDir: string;
    private envPath: string;

    constructor(dir: string) {
        this.testformDir = join(dir, '.testform');
        this.cacheDir = join(this.testformDir, 'cache');
        this.envPath = join(this.testformDir, 'environment');
    }

    private ensureDir(): void {
        if (!existsSync(this.testformDir)) {
            mkdirSync(this.testformDir, { recursive: true });
        }
        if (!existsSync(this.cacheDir)) {
            mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    getCurrentWorkspace(): string {
        if (existsSync(this.envPath) && statSync(this.envPath).isFile()) {
            const content = readFileSync(this.envPath, 'utf8').trim();
            if (content.length > 0) {
                return content;
            }
        }
        return 'default';
    }

    setCurrentWorkspace(name: string): void {
        this.ensureDir();
        writeFileSync(this.envPath, name, 'utf8');
    }

    getActiveBackend(): { type: string; config?: Record<string, any> } | null {
        const cacheBackendPath = join(this.cacheDir, 'backend.json');
        const legacyBackendPath = join(this.testformDir, 'backend.json');
        const targetPath = existsSync(cacheBackendPath) ? cacheBackendPath : legacyBackendPath;

        if (existsSync(targetPath) && statSync(targetPath).isFile()) {
            try {
                return JSON.parse(readFileSync(targetPath, 'utf8'));
            } catch {
                return null;
            }
        }
        return null;
    }

    setActiveBackend(backend: { type: string; config?: Record<string, any> }): void {
        this.ensureDir();
        const backendPath = join(this.cacheDir, 'backend.json');
        writeFileSync(backendPath, JSON.stringify(backend, null, 2), 'utf8');

        // Clean up legacy .testform/backend.json if present
        const legacyBackendPath = join(this.testformDir, 'backend.json');
        if (existsSync(legacyBackendPath)) {
            try {
                unlinkSync(legacyBackendPath);
            } catch {}
        }
    }
}
