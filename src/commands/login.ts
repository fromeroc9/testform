import { bold, green } from 'chalk';
import * as readline from 'readline';
import { Credentials } from '../core/credentials';
import { TITLE_CLI } from '../const';

interface LoginCmdOptions {
    hostname?: string;
}

export const loginCmd = async (options: LoginCmdOptions = {}) => {
    let { hostname = 'github.com' } = options;
    // In TestForm we default to GitHub
    if (hostname === 'app.terraform.io') hostname = 'github.com';

    console.log(`
TestForm must now request an API token for ${bold(hostname)}.
This token will be stored in plain text at ~/.testform.d/credentials.json.

If you are logging into GitHub, you can generate a Personal Access Token (classic)
with the 'repo' scope at: https://github.com/settings/tokens
`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise<void>((resolve) => {
        rl.question(`Token for ${hostname}: `, (token) => {
            rl.close();
            const trimmed = token.trim();
            if (!trimmed) {
                console.log('\nToken cannot be empty. Login aborted.');
                process.exit(1);
            }

            const creds = new Credentials();
            creds.setToken(hostname, trimmed);

            console.log(`\n${green('Success!')} Logged in to ${hostname}.`);
            resolve();
        });
    });
};
