import { red, green } from 'chalk';
import { State } from '../core/state';
import { TITLE_CLI } from '../const';

export interface TaintCmdOptions {
    dir?: string;
    action: 'taint' | 'untaint';
    identityRaw: string;
    statePath?: string;
    backupPath?: string;
    allowMissing?: boolean;
    lock?: boolean;
    lockTimeout?: string;
}

export const taintCmd = async (options: TaintCmdOptions) => {
    const {
        dir = '.',
        action,
        identityRaw,
        statePath,
        backupPath,
        allowMissing = false,
        lock = true,
        lockTimeout = '0s'
    } = options;
    const state = new State(dir, statePath, backupPath);
    await state.init();
    await state.acquireLock(lock, lockTimeout);

    try {
        const identity = identityRaw.replace(/^github_testcase\./, '');
        const res = state.getResources('github_testcase').find(r => r.identity === identity);

        if (!res) {
            if (allowMissing) {
                console.log(green(`Resource not found in state, but allow-missing is set. Exiting successfully.`));
                process.exit(0);
            }
            console.error(red(`Error: Resource not found in state.`));
            process.exit(1);
        }

        if (action === 'taint') {
            if (res.tainted) {
                console.log(`Resource instance ${identityRaw} is already tainted`);
            } else {
                res.tainted = true;
                state.upsertResource(res);
                await state.save();
                console.log(green(`Resource instance ${identityRaw} has been marked as tainted.`));
            }
        } else {
            if (!res.tainted) {
                console.log(`Resource instance ${identityRaw} is not tainted`);
            } else {
                delete res.tainted;
                state.upsertResource(res);
                await state.save();
                console.log(green(`Resource instance ${identityRaw} has been successfully untainted.`));
            }
        }
    } finally {
        await state.releaseLock();
    }
};
