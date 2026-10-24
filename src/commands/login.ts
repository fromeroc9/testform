import { bold, green, cyan, yellow, red } from 'chalk';
import * as readline from 'readline';
import { Credentials, CredentialsData } from '../core/credentials';
import { TITLE_CLI } from '../core/const';

interface LoginCmdOptions {
    hostname?: string;
}

const askQuestion = (rl: readline.Interface, question: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
};

export const loginCmd = async (options: LoginCmdOptions = {}) => {
    let { hostname = 'github.com' } = options;
    const norm = (hostname || '').trim().toLowerCase();

    if (norm === 'local') {
        console.error(bold(red(`\nError: The "local" provider does not require authentication.\n`)));
        process.exit(1);
    }

    if (norm === 'app.terraform.io' || norm === 'github') hostname = 'github.com';
    else if (norm === 'gitlab') hostname = 'gitlab.com';

    console.log(`
TestForm must now request authentication credentials for ${bold(hostname)}.
These credentials will be stored locally at ~/.testform.d/credentials.json.
`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const creds = new Credentials();
        const authData: CredentialsData = {};

        const token = await askQuestion(rl, `Token (PAT) for ${hostname}: `);
        if (!token) throw new Error('Token cannot be empty.');
        authData.token = token;

        creds.setAuth(hostname, authData);
        console.log(`\n${green('Success!')} Configuration saved for ${hostname}.`);
    } catch (e: any) {
        console.log(`\n${yellow('Login aborted:')} ${e.message}`);
        process.exit(1);
    } finally {
        rl.close();
    }
};
