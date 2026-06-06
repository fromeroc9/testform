import { bold, green, cyan, yellow } from 'chalk';
import * as readline from 'readline';
import { Credentials, CredentialsData } from '../core/credentials';
import { TITLE_CLI } from '../const';

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
    if (hostname === 'app.terraform.io') hostname = 'github.com';

    console.log(`
TestForm must now request authentication credentials for ${bold(hostname)}.
These credentials will be stored locally at ~/.testform.d/credentials.json.

${cyan('Select authentication strategy:')}
1. Personal Access Token (PAT) or Installation Token (ghs_)
2. GitHub App (App ID, Private Key, Installation ID)
`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        let choice = await askQuestion(rl, 'Select an option [1-2]: ');
        while (!['1', '2'].includes(choice)) {
            console.log(yellow('Invalid option. Please enter 1 or 2.'));
            choice = await askQuestion(rl, 'Select an option [1-2]: ');
        }

        const creds = new Credentials();
        const authData: CredentialsData = {};

        if (choice === '1') {
            const token = await askQuestion(rl, `Token for ${hostname}: `);
            if (!token) throw new Error('Token cannot be empty.');
            authData.token = token;
        } else if (choice === '2') {
            const appId = await askQuestion(rl, 'App ID: ');
            if (!appId) throw new Error('App ID cannot be empty.');
            const privateKey = await askQuestion(rl, 'Private Key (paste the full text or use \\n for newlines): ');
            if (!privateKey) throw new Error('Private Key cannot be empty.');
            const installationId = await askQuestion(rl, 'Installation ID (optional): ');
            
            authData.appId = appId;
            authData.privateKey = privateKey;
            if (installationId) authData.installationId = installationId;
        }

        creds.setAuth(hostname, authData);
        console.log(`\n${green('Success!')} Configuration saved for ${hostname}.`);
    } catch (e: any) {
        console.log(`\n${yellow('Login aborted:')} ${e.message}`);
        process.exit(1);
    } finally {
        rl.close();
    }
};
