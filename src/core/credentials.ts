import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface CredentialsFile {
    credentials: {
        [hostname: string]: {
            token: string;
        }
    }
}

export class Credentials {
    private credsPath: string;

    constructor() {
        const home = homedir();
        const configDir = join(home, '.testform.d');
        if (!existsSync(configDir)) {
            mkdirSync(configDir, { recursive: true });
        }
        this.credsPath = join(configDir, 'credentials.json');
    }

    private load(): CredentialsFile {
        if (!existsSync(this.credsPath)) {
            return { credentials: {} };
        }
        try {
            const raw = readFileSync(this.credsPath, 'utf8');
            return JSON.parse(raw);
        } catch {
            return { credentials: {} };
        }
    }

    private save(data: CredentialsFile) {
        writeFileSync(this.credsPath, JSON.stringify(data, null, 2), 'utf8');
    }

    getToken(hostname: string = 'github.com'): string | undefined {
        const data = this.load();
        return data.credentials?.[hostname]?.token;
    }

    setToken(hostname: string = 'github.com', token: string) {
        const data = this.load();
        if (!data.credentials) data.credentials = {};
        data.credentials[hostname] = { token };
        this.save(data);
    }

    removeToken(hostname: string = 'github.com'): boolean {
        const data = this.load();
        if (data.credentials?.[hostname]) {
            delete data.credentials[hostname];
            this.save(data);
            return true;
        }
        return false;
    }
}
