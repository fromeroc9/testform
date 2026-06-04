import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';

export class WorkspaceManager {
    private envPath: string;
    private statePath: string;

    constructor(dir: string) {
        const testformDir = join(dir, '.testform');
        if (!existsSync(testformDir)) {
            mkdirSync(testformDir, { recursive: true });
        }
        this.envPath = join(testformDir, 'environment');
        this.statePath = join(testformDir, 'testform.state');
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
