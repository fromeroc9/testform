/**
 * @fileoverview `testform destroy` command.
 *
 * Destroys all resources currently tracked in the state by closing their
 * corresponding GitHub issues. Requires explicit user confirmation unless
 * `-auto-approve` is passed.
 */

import { bold, green, red } from 'chalk';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { logger as notify } from '../core/logger';
import { TITLE_APP, SCOPE_RESOURCE_MAP } from '../core/const';
import { createCommandContext } from '../core/command-context';
import { askDestroyApproval } from '../core/prompt';
import { elapsedSeconds, formatResourceAddress } from '../core/utils';
import { IScope } from '../core/types';

/**
 * Destroy command: closes all GitHub issues tracked by TestForm in the current scope.
 *
 * @param dir         - Working directory containing `testform.json`.
 * @param verbose     - Enable verbose/debug logging.
 * @param scope       - The scope to destroy (`testcase` | `testrun` | `testplan`).
 * @param lock        - Whether to acquire a state lock during execution.
 * @param lockTimeout - How long to wait before giving up on the lock.
 * @param input       - If `false`, disables the interactive approval prompt.
 * @param statePath   - Custom path to the state file.
 * @param backupPath  - Custom path to the state backup file.
 */
interface DestroyCmdOptions {
    dir?: string;
    verbose?: boolean;
    scope: IScope | 'all';
    lock?: boolean;
    lockTimeout?: string;
    input?: boolean;
    statePath?: string;
    backupPath?: string;
}

export const destroyCmd = async (options: DestroyCmdOptions) => {
    const {
        dir = '.',
        verbose = false,
        scope,
        lock = true,
        lockTimeout = '0s',
        input = true,
        statePath,
        backupPath
    } = options;
    const logger = new Logger(verbose);
    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);

    try {
        const scopesToRun: IScope[] = (scope as string) === 'all' ? ['testcase', 'testrun', 'testplan'] : [scope as IScope];

        let destroyed = 0;

        for (const s of scopesToRun) {
            if (!Object.prototype.hasOwnProperty.call(SCOPE_RESOURCE_MAP, s)) {
                throw new Error(`Invalid scope: ${s}`);
            }

            const resources = stateObj.getResources(SCOPE_RESOURCE_MAP[s]);

            if (resources.length === 0) {
                console.log(`No resources found in state for scope '${s}'.`);
                continue;
            }

            console.log(bold(`\n${TITLE_APP} will destroy the following resources in scope '${s}':\n`));
            for (const res of resources) {
                const remoteId = res.attributes.remoteId ?? '';
                console.log(`  ${red('-')} ${formatResourceAddress(res.type, res.identity)} [id=${remoteId}]`);
            }
            console.log(`\n${bold('Plan:')} 0 to add, 0 to change, ${resources.length} to destroy.\n`);

            // Prompt for approval
            if (input) {
                const approved = await askDestroyApproval(resources.length, s);
                if (!approved) {
                    notify.push({
                        type: 'error',
                        title: `Destruction of scope '${s}' cancelled.`,
                        detail: [],
                    });
                    continue;
                }
            }

            console.log('');
            const ctx = await createCommandContext({ dir, verbose, statePath, backupPath, lock: false, silent: false });
            if (!ctx) return;
            const { github } = ctx;
            
            for (const res of resources) {
                const address = formatResourceAddress(res.type, res.identity);
                const remoteId = res.attributes.remoteId ?? '';
                console.log(`${address}: Destroying... [id=${remoteId}]`);

                const startTime = Date.now();
                try {
                    if (res.attributes.issueNumber) {
                        await github.closeIssue(res.attributes.issueNumber);
                    }
                    stateObj.removeResource(res.identity);
                    const elapsed = elapsedSeconds(startTime);
                    console.log(green(`${address}: Destruction complete after ${elapsed}s [id=${remoteId}]`));
                    destroyed++;
                } catch (error: any) {
                    notify.push({
                        type: 'error',
                        title: `Failed to destroy ${address}: ${error.message}`,
                        detail: [],
                    });
                }
            }
        }

        await stateObj.save();
        if (destroyed > 0) {
            console.log('');
            console.log(green(bold(`Destroy complete! ${destroyed} resource(s) destroyed.`)));
        }
    } finally {
        await stateObj.releaseLock();
    }
};
