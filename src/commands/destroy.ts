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
import { createCommandContext } from '../core/context';
import { askDestroyApproval } from '../core/prompt';
import { elapsedSeconds, formatResourceAddress } from '../core/utils';
import { IScope } from '../core/types';
import { matchesTarget } from '../core/selector';
import { withStateLock, resolveScopes, assertApprovalAllowed } from '../core/cli';
import { LifecycleResolver } from '../core/lifecycle';

/**
 * Destroy command: closes all GitHub issues tracked by TestForm in the current scope.
 *
 * @param dir         - Working directory containing `testform.yml`.
 * @param verbose     - Enable verbose/debug logging.
 * @param scope       - The scope to destroy (`testcase` | `testrun` | `testplan`).
 * @param lock        - Whether to acquire a state lock during execution.
 * @param lockTimeout - How long to wait before giving up on the lock.
 * @param input       - If `false`, disables the interactive approval prompt.
 * @param statePath   - Custom path to the state file.
 * @param backupPath  - Custom path to the state backup file.
 */
export interface DestroyCmdOptions {
    dir?: string;
    autoApprove?: boolean;
    verbose?: boolean;
    scope?: IScope | 'all';
    lock?: boolean;
    lockTimeout?: string;
    input?: boolean;
    statePath?: string;
    backupPath?: string;
    target?: string | string[];
}

export const destroyCmd = async (options: DestroyCmdOptions) => {
    const {
        dir = '.',
        autoApprove = false,
        verbose = false,
        scope,
        target,
        lock = true,
        lockTimeout = '0s',
        input = true,
        statePath,
        backupPath
    } = options;
    const logger = new Logger(verbose);

    return withStateLock({ dir, statePath, backupPath, lock, lockTimeout }, async (stateObj) => {
        const scopesToRun = resolveScopes(scope, target);

        const allResources = scopesToRun.flatMap(s => {
            const resType = (SCOPE_RESOURCE_MAP as any)[s];
            if (!resType) return [];
            const list = stateObj.getResources(resType);
            return target ? list.filter(r => matchesTarget(r.identity, target, s) || (r.type && matchesTarget(r.type, target, s))) : list;
        });
        if (allResources.length === 0) {
            console.log('No resources to destroy. State is empty.');
            return;
        }

        assertApprovalAllowed(autoApprove, input);

        const lifecycleResolver = new LifecycleResolver(dir);
        const protectedResources = allResources.filter(res => {
            const lc = lifecycleResolver.getLifecycle(res.identity, res.attributes.labels || []);
            return lc.prevent_destroy;
        });

        if (protectedResources.length > 0) {
            const details = protectedResources.map(r => 
                `Resource ${formatResourceAddress(r.type, r.identity)} has lifecycle.prevent_destroy set, but the plan calls for this resource to be destroyed. To avoid this error and continue with the plan, either disable lifecycle.prevent_destroy or target other resources.`
            );
            notify.push({
                type: 'error',
                title: 'Instance cannot be destroyed',
                detail: details,
                close: true
            });
            throw new Error(`Instance cannot be destroyed: ${protectedResources.map(r => r.identity).join(', ')} has lifecycle.prevent_destroy set.`);
        }

        let destroyed = 0;

        for (const s of scopesToRun) {
            if (!Object.prototype.hasOwnProperty.call(SCOPE_RESOURCE_MAP, s)) {
                throw new Error(`Invalid scope: ${s}`);
            }

            let resources = stateObj.getResources(SCOPE_RESOURCE_MAP[s]);
            if (target) {
                resources = resources.filter(r => matchesTarget(r.identity, target, s) || (r.type && matchesTarget(r.type, target, s)));
            }

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
            if (!autoApprove && input) {
                const approved = await askDestroyApproval(resources.length);
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
            const github = (ctx.adapter || (ctx as any).github);
            
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

        if (typeof stateObj.save === "function") await stateObj.save();
        if (destroyed > 0) {
            console.log('');
            console.log(green(bold(`Destroy complete! ${destroyed} resource(s) destroyed.`)));
        }
    });
};
