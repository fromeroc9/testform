import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';

export class WorkspaceManager {
    private testformDir: string;
    private envPath: string;
    private statePath: string;

    constructor(dir: string) {
        this.testformDir = join(dir, '.testform');
        this.envPath = join(this.testformDir, 'environment');
        this.statePath = join(this.testformDir, 'testform.state');
    }

    private ensureDir(): void {
        if (!existsSync(this.testformDir)) {
            mkdirSync(this.testformDir, { recursive: true });
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

    getActiveBackend(): any {
        if (existsSync(this.statePath) && statSync(this.statePath).isFile()) {
            try {
                const content = readFileSync(this.statePath, 'utf8');
                const parsed = JSON.parse(content);
                return parsed.backend || null;
            } catch {
                return null;
            }
        }
        return null;
    }

    setActiveBackend(backend: any): void {
        this.ensureDir();
        let stateObj: any = { version: 3 };
        if (existsSync(this.statePath) && statSync(this.statePath).isFile()) {
            try {
                stateObj = JSON.parse(readFileSync(this.statePath, 'utf8'));
            } catch {
                // Ignore parse errors, just overwrite
            }
        }
        stateObj.backend = backend;
        writeFileSync(this.statePath, JSON.stringify(stateObj, null, 2), 'utf8');
    }
}
