import { existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { bold, red, green } from 'chalk';
import { State } from '../core/state';
import { TITLE_APP } from '../const';

export interface ForceUnlockCmdOptions {
    dir?: string;
    lockId: string;
    force?: boolean;
    statePath?: string;
}

export const forceUnlockCmd = async (options: ForceUnlockCmdOptions) => {
    const { dir = '.', lockId, force = false, statePath } = options;
    const stateObj = new State(dir, statePath);
    await stateObj.init();

    const executeUnlock = async () => {
        const result = await stateObj.forceUnlock(lockId);
        if (result.success) {
            console.log(green(`\n${TITLE_APP} state has been successfully unlocked!\n`));
            if (!force) {
                console.log(`The state has been unlocked, and ${TITLE_APP} commands should now be able to`);
                console.log(`obtain a new lock on the remote state.`);
            }
        } else {
            if (result.currentLockId) {
                console.error(red(`Error: Lock ID does not match.\n\nExpected: ${lockId}\nActual:   ${result.currentLockId}\n`));
            } else if (result.error) {
                console.error(red(`${result.error}\n`));
            }
            process.exit(1);
        }
    };

    if (force) {
        await executeUnlock();
        return;
    }

    console.log(`Do you really want to force-unlock?`);
    console.log(`  ${TITLE_APP} will remove the lock on the remote state.`);
    console.log(`  This will allow local ${TITLE_APP} commands to modify this state, even though it`);
    console.log(`  may be still be in use. Only 'yes' will be accepted to confirm.`);
    console.log('');
    
    const { createInterface } = require('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    return new Promise<void>((resolveReject) => {
        rl.question('  Enter a value: ', async (answer: string) => {
            rl.close();
            if (answer.trim().toLowerCase() === 'yes') {
                await executeUnlock();
            } else {
                console.error(red(`\nUnlock cancelled.\n`));
                process.exitCode = 1;
            }
            resolveReject();
        });
    });
};
