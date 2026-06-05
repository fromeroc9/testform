/**
 * @fileoverview `testform destroy` command.
 *
 * Destroys all resources currently tracked in the state by closing their
 * corresponding GitHub issues. Requires explicit user confirmation unless
 * `-auto-approve` is passed.
 */

import { bold, green, red } from 'chalk';
import { State } from '../core/state';
import { Logger } from '../logger';
import { notify } from '../notify';
import { TITLE_APP, SCOPE_RESOURCE_MAP } from '../const';
import { createCommandContext } from '../core/command-context';
import { askDestroyApproval } from '../core/prompt';
import { elapsedSeconds, formatResourceAddress } from '../core/utils';
import { IScope } from '../types';

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
    scope: IScope;
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
        if (!Object.prototype.hasOwnProperty.call(SCOPE_RESOURCE_MAP, scope)) {
            throw new Error(`Invalid scope: ${scope}`);
        }
        const resources = stateObj.getResources(SCOPE_RESOURCE_MAP[scope]);

        if (resources.length === 0) {
            console.log('No resources to destroy. State is empty.');
            return;
        }

        console.log(bold(`\n${TITLE_APP} will destroy the following resources:\n`));

        for (const res of resources) {
            const remoteId = res.attributes.remoteId ?? '';
            console.log(`  ${red('-')} ${formatResourceAddress(res.type, res.identity)} [id=${remoteId}]`);
        }

        console.log(`\n${bold('Plan:')} 0 to add, 0 to change, ${resources.length} to destroy.\n`);

        // Require interactive approval unless disabled
        if (!input) {
            const error = new Error('This command requires manual approval, but input is disabled. Use the\n-auto-approve flag to bypass approval.');
            error.name = 'No input allowed';
            throw error;
        }

        const approved = await askDestroyApproval(resources.length);
        if (!approved) {
            notify.push({ type: 'error', title: 'error asking for approval: interrupted', detail: [] });
            return;
        }

        // Create GitHub context AFTER approval to avoid locking for nothing if user declines
        const ctx = await createCommandContext({ dir, verbose, statePath, backupPath, lock: false, silent: false });
        if (!ctx) return;

        let destroyed = 0;

        for (const res of resources) {
            try {
                const remoteId = res.attributes.remoteId ?? '';
                const address = formatResourceAddress(res.type, res.identity);
                console.log(`${address}: Destroying... [id=${remoteId}]`);
                const startTime = Date.now();

                if (res.attributes.issueNumber) {
                    await ctx.github.closeIssue(res.attributes.issueNumber);
                }

                console.log(green(`${address}: Destruction complete after ${elapsedSeconds(startTime)}s [id=${remoteId}]`));
                stateObj.removeResource(res.identity);
                destroyed++;
            } catch (error: any) {
                notify.push({
                    type: 'error',
                    title: error.message,
                    detail: [`  with ${formatResourceAddress(res.type, res.identity)}`],
                });
            }
        }

        await stateObj.save();
        console.log('');
        console.log(green(bold(`Destroy complete! Resources: ${destroyed} destroyed.`)));
    } finally {
        await stateObj.releaseLock();
    }
};
