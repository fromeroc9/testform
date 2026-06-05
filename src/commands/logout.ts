import { bold, green, yellow } from 'chalk';
import { Credentials } from '../core/credentials';

interface LogoutCmdOptions {
    hostname?: string;
}

export const logoutCmd = async (options: LogoutCmdOptions = {}) => {
    let { hostname = 'github.com' } = options;
    // In TestForm we default to GitHub
    if (hostname === 'app.terraform.io') hostname = 'github.com';

    const creds = new Credentials();
    const removed = creds.removeToken(hostname);

    if (removed) {
        console.log(`\n${green('Success!')} Removed credentials for ${hostname}.`);
    } else {
        console.log(`\n${yellow('Warning:')} No credentials found for ${hostname}.`);
    }
};
