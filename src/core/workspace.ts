import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';

export class WorkspaceManager {
    private testformDir: string;
    private envPath: string;

    constructor(dir: string) {
        this.testformDir = join(dir, '.testform');
        this.envPath = join(this.testformDir, 'environment');
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
}
