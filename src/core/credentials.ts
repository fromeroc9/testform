import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CredentialsData {
    token?: string;
}

interface CredentialsFile {
    credentials: {
        [hostname: string]: CredentialsData
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

    getAuth(hostname: string = 'github.com'): CredentialsData | undefined {
        const data = this.load();
        return data.credentials?.[hostname];
    }

    setToken(hostname: string = 'github.com', token: string) {
        this.setAuth(hostname, { token });
    }

    setAuth(hostname: string = 'github.com', authData: CredentialsData) {
        const data = this.load();
        if (!data.credentials) data.credentials = {};
        data.credentials[hostname] = authData;
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
