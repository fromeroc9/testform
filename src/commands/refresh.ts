/**
 * @fileoverview `testform refresh` command.
 *
 * Synchronizes the local state file against the remote GitHub repository
 * by checking each tracked issue's current status and updating or removing
 * stale state entries.
 */

import { bold, green, yellow, red, dim } from 'chalk';
import { GitHubProvider, GitHubAdapter } from '../providers/github';
import { LocalProvider, LocalAdapter } from '../providers/local';
import { IProvider, IProviderAdapter } from '../providers/interface';
import { Config } from '../core/config';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { logger as notify } from '../core/logger';
import { SCOPE_RESOURCE_MAP, ERR_GITHUB_CONFIG_NOT_FOUND } from '../core/const';
import { IScope } from '../core/types';
import { matchesTarget } from '../core/selector';
import { formatResourceAddress, formatIdentityDisplay } from '../core/utils';
import { executeInBatches, detectAttributeDrift } from '../core/sync';
import { withStateLock, resolveScopes } from '../core/cli';
import { LifecycleResolver } from '../core/lifecycle';

/**
 * Core refresh logic: updates the state to reflect remote GitHub reality.
 *
 * This function is called both by `refreshCmd` (standalone) and implicitly
 * by `planCmd` / `applyCmd` during implicit refresh operations.
 *
 * @param dir    - Working directory containing `testform.yml`.
 * @param scope  - The scope to refresh (`testcase` | `testrun` | `testplan`).
 * @param state  - Pre-initialized, locked `State` instance.
 * @param logger - Logger for output.
 * @param silent - When `true`, suppresses all console output (used by plan/apply).
 */
interface RefreshStateOptions {
    dir: string;
    scope: IScope;
    state: State;
    logger: Logger;
    silent?: boolean;
    isImplicit?: boolean;
    parallelismRaw?: string | number;
    target?: string | string[];
}

export const refreshState = async (options: RefreshStateOptions) => {
    const {
        dir,
        scope,
        state,
        logger,
        silent = false,
        isImplicit = false,
        parallelismRaw,
        target
    } = options;
    if (!Object.prototype.hasOwnProperty.call(SCOPE_RESOURCE_MAP, scope)) {
        throw new Error(`Invalid scope: ${scope}`);
    }
    const resourceType = SCOPE_RESOURCE_MAP[scope];
    let resources = state.getResources(resourceType);

    if (target) {
        resources = resources.filter(r => matchesTarget(r.identity, target, scope) || (r.type && matchesTarget(r.type, target, scope)));
    }

    if (resources.length === 0) {
        if (typeof state.save === 'function') {
            await state.save();
        }
        if (!silent && !isImplicit) console.log('No resources in state to refresh.');
        return;
    }

    const config = new Config(dir);
    const adapterType = config.getAdapterType();
    let github: IProviderAdapter;

    if (adapterType === 'local') {
        github = new LocalAdapter(dir);
    } else {
        const ghConfig = config.getGitHub();
        if (!ghConfig) {
            if (!silent) {
                notify.push({
                    type: 'error',
                    title: 'GitHub configuration not found',
                    detail: [ERR_GITHUB_CONFIG_NOT_FOUND],
                    close: true,
                });
            }
            return;
        }
        github = new GitHubAdapter(ghConfig);
    }

    let refreshed = 0;
    let removed = 0;

    const parallelism = parallelismRaw ? parseInt(String(parallelismRaw), 10) || 3 : 3;
    const lifecycleResolver = new LifecycleResolver(dir);

    await executeInBatches(resources, parallelism, async (res) => {
        const remoteId = res.attributes.remoteId ?? '';
        if (!silent) console.log(`${formatResourceAddress(res.type, res.identity)}: Refreshing state... ${dim(`[id=${remoteId}]`)}`);

        try {
            const targetId = res.attributes.issueNumber || res.attributes.remoteId;
            if (!targetId) {
                if (!silent) console.log(yellow(`  ${res.identity}: No issue number — removing from state`));
                state.removeResource(res.identity);
                removed++;
                return;
            }

            const providerResources = github.resources || github.apis;
            const resHandler = providerResources
                ? (providerResources[res.type] || providerResources[res.type.replace(/^.*_/, '')] || providerResources.issue || Object.values(providerResources)[0])
                : undefined;

            let issue: any = null;
            if (resHandler?.read) {
                issue = await resHandler.read(targetId);
            } else if (resHandler?.get) {
                issue = await resHandler.get(targetId);
            } else if (typeof (github as any).getIssue === 'function') {
                issue = await (github as any).getIssue(targetId);
            }

            if (!issue) {
                if (!silent) console.log(red(`  ${res.identity}: Issue #${targetId} not found — removing from state`));
                state.removeResource(res.identity);
                removed++;
            } else if (issue.state === 'closed' || issue.status === 'deleted') {
                if (!silent) console.log(yellow(`  ${res.identity}: Issue #${targetId} is closed — removing from state`));
                state.removeResource(res.identity);
                removed++;
            } else {
                const remoteCustomFields = (issue.node_id && (github as any).getProjectItemFields)
                    ? await (github as any).getProjectItemFields(issue.node_id)
                    : undefined;

                const lifecycle = lifecycleResolver.getLifecycle(res.identity, res.attributes.labels || []);
                const { hasDrift, newAttributes } = detectAttributeDrift(
                    res.attributes,
                    issue,
                    remoteCustomFields,
                    lifecycle.ignore_changes
                );

                if (hasDrift) {
                    res.attributes = { ...res.attributes, ...newAttributes };
                    if (!silent) {
                        console.log(yellow(`  ! Drift detected on remote for ${formatIdentityDisplay(res.identity)} (Issue #${targetId})`));
                        console.log(dim(`    Run 'testform diff --remote' to inspect differences or interactively pull changes.`));
                    }
                    // Invalidate localHash to force a plan diff
                    res.attributes.localHash = 'drift_detected';
                    state.upsertResource(res);
                }

                refreshed++;
            }
        } catch (error: any) {
            if (!silent) {
                notify.push({
                    type: 'warning',
                    title: `Failed to refresh ${res.identity}: ${error.message}`,
                    detail: [],
                });
            }
        }
    });

    await state.save();

    if (!silent && !isImplicit && (refreshed + removed > 0)) {
        console.log('');
        console.log(green(bold(`Refresh complete! ${refreshed} resource(s) refreshed, ${removed} removed.`)));
    }
};

/**
 * Refresh command entry point: standalone `testform refresh` execution.
 *
 * @param dir         - Working directory containing `testform.yml`.
 * @param verbose     - Enable verbose/debug logging.
 * @param scope       - The scope to refresh.
 * @param lock        - Whether to acquire a state lock.
 * @param lockTimeout - Lock acquisition timeout string (e.g. `"30s"`).
 * @param statePath   - Custom path to the state file.
 * @param backupPath  - Custom path to the state backup file.
 * @param parallelismRaw - Parallelism limit.
 * @param compactWarnings - Compact warnings.
 */
interface RefreshCmdOptions {
    dir?: string;
    verbose?: boolean;
    lock?: boolean;
    lockTimeout?: string;
    statePath?: string;
    backupPath?: string;
    parallelismRaw?: string | number;
    compactWarnings?: boolean;
    target?: string | string[];
}

export const refreshCmd = async (options: RefreshCmdOptions) => {
    const {
        dir = '.',
        verbose = false,
        lock = true,
        lockTimeout = '0s',
        statePath,
        backupPath,
        parallelismRaw,
        compactWarnings,
        target
    } = options;
    const logger = new Logger(verbose);
    return withStateLock({ dir, statePath, backupPath, lock, lockTimeout }, async (stateObj) => {
        const effectiveTarget = target || (options as any).scope;
        const realTarget = effectiveTarget || (options as any).scope;
        const scopesToRun = resolveScopes(realTarget);

        let totalResources = 0;
        for (const s of scopesToRun) {
            const resType = SCOPE_RESOURCE_MAP[s];
            if (resType) {
                let resList = stateObj.getResources(resType);
                if (target) {
                    resList = resList.filter(r => matchesTarget(r.identity, target, s) || (r.type && matchesTarget(r.type, target, s)));
                }
                totalResources += resList.length;
            }
        }

        if (totalResources === 0) {
            if (typeof stateObj.save === 'function') {
                await stateObj.save();
            }
            console.log('No resources in state to refresh.');
            return;
        }

        for (const s of scopesToRun) {
            await refreshState({ dir, scope: s, state: stateObj, logger, silent: false, isImplicit: false, parallelismRaw, target });
        }
    });
};
