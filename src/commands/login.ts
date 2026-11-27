import { bold, green, yellow, red, cyan } from 'chalk';
import * as readline from 'readline';
import { existsSync } from 'fs';
import { join } from 'path';
import { Credentials, CredentialsData } from '../core/credentials';
import { Config } from '../core/config';

interface LoginCmdOptions {
    hostname?: string;
    dir?: string;
}

const askQuestion = (rl: readline.Interface, question: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
};

export const loginCmd = async (options: LoginCmdOptions = {}) => {
    let { hostname, dir = process.cwd() } = options;

    let detectedProvider: string | undefined;
    let detectedHost: string | undefined;

    // Auto-detect provider and host from main.yml if hostname is not explicitly supplied
    if (!hostname) {
        try {
            const hasMainYml = existsSync(join(dir, 'main.yml')) || existsSync(join(dir, 'testform.yml'));
            if (hasMainYml) {
                const config = new Config(dir);
                detectedProvider = config.getProviderType();
                const pConfig = (typeof config.getProviderConfig === 'function') ? config.getProviderConfig(detectedProvider) : {};
                detectedHost = pConfig.host;
            }
        } catch {
            // fallback if config parsing is unavailable
        }

        if (detectedProvider === 'local') {
            console.log(`\n${cyan('Info:')} The "${bold('local')}" provider (Git-Native) operates locally and does not require authentication credentials.\n`);
            return;
        }

        if (detectedProvider === 'gitlab') {
            hostname = detectedHost ? detectedHost.replace(/^https?:\/\//, '').split('/')[0] : 'gitlab.com';
        } else if (detectedProvider === 'github') {
            hostname = 'github.com';
        } else if (detectedProvider) {
            hostname = detectedHost ? detectedHost.replace(/^https?:\/\//, '').split('/')[0] : detectedProvider;
        } else {
            hostname = 'github.com';
        }
    }

    const norm = (hostname || '').trim().toLowerCase();

    if (norm === 'local') {
        console.error(bold(red(`\nError: The "local" provider does not require authentication.\n`)));
        process.exit(1);
    }

    let targetKey = hostname;
    if (norm === 'github') {
        targetKey = 'github.com';
    } else if (norm === 'gitlab') {
        targetKey = 'gitlab.com';
    }

    console.log(`
TestForm must now request authentication credentials for ${bold(targetKey)}.
These credentials will be stored locally at ~/.testform.d/credentials.json.
`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const creds = new Credentials();
        const authData: CredentialsData = {};

        const token = await askQuestion(rl, `Token (PAT) for ${targetKey}: `);
        if (!token) throw new Error('Token cannot be empty.');
        authData.token = token;

        creds.setAuth(targetKey, authData);
        if (norm !== targetKey) {
            creds.setAuth(norm, authData);
        }

        console.log(`\n${green('Success!')} Configuration saved for ${targetKey}.`);
    } catch (e: any) {
        console.log(`\n${yellow('Login aborted:')} ${e.message}`);
        process.exit(1);
    } finally {
        rl.close();
    }
};
