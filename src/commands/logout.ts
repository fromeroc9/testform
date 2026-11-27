import { green, yellow } from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { Credentials } from '../core/credentials';
import { Config } from '../core/config';

interface LogoutCmdOptions {
    hostname?: string;
    dir?: string;
}

export const logoutCmd = async (options: LogoutCmdOptions = {}) => {
    let { hostname, dir = process.cwd() } = options;

    if (!hostname) {
        try {
            const hasMainYml = existsSync(join(dir, 'main.yml')) || existsSync(join(dir, 'testform.yml'));
            if (hasMainYml) {
                const config = new Config(dir);
                const pType = config.getProviderType();
                const pConfig = (typeof config.getProviderConfig === 'function') ? config.getProviderConfig(pType) : {};
                if (pType === 'gitlab') {
                    hostname = pConfig.host ? pConfig.host.replace(/^https?:\/\//, '').split('/')[0] : 'gitlab.com';
                } else if (pType === 'github') {
                    hostname = 'github.com';
                } else if (pType && pType !== 'local') {
                    hostname = pConfig.host ? pConfig.host.replace(/^https?:\/\//, '').split('/')[0] : pType;
                }
            }
        } catch {
            // fallback
        }
        if (!hostname) hostname = 'github.com';
    }

    let targetKey = hostname;
    const norm = (hostname || '').trim().toLowerCase();
    if (norm === 'github') {
        targetKey = 'github.com';
    } else if (norm === 'gitlab') {
        targetKey = 'gitlab.com';
    }

    const creds = new Credentials();
    let removed = creds.removeToken(targetKey);
    if (norm !== targetKey) {
        const removedAlias = creds.removeToken(norm);
        removed = removed || removedAlias;
    }

    if (removed) {
        console.log(`\n${green('Success!')} Removed credentials for ${targetKey}.`);
    } else {
        console.log(`\n${yellow('Warning:')} No credentials found for ${targetKey}.`);
    }
};
