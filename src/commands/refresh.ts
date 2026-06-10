/**
 * @fileoverview `testform refresh` command.
 *
 * Synchronizes the local state file against the remote GitHub repository
 * by checking each tracked issue's current status and updating or removing
 * stale state entries.
 */

import { bold, green, yellow, red, dim } from 'chalk';
import { GitHubAdapter } from '../adapters/github';
import { Config } from '../core/config';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { logger as notify } from '../core/logger';
import { SCOPE_RESOURCE_MAP, ERR_GITHUB_CONFIG_NOT_FOUND } from '../core/const';
import { IScope } from '../core/types';

/**
 * Core refresh logic: updates the state to reflect remote GitHub reality.
 *
 * This function is called both by `refreshCmd` (standalone) and implicitly
 * by `planCmd` / `applyCmd` during implicit refresh operations.
 *
 * @param dir    - Working directory containing `testform.json`.
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
        parallelismRaw,
        target
    } = options;
    if (!Object.prototype.hasOwnProperty.call(SCOPE_RESOURCE_MAP, scope)) {
        throw new Error(`Invalid scope: ${scope}`);
    }
    const resourceType = SCOPE_RESOURCE_MAP[scope];
    let resources = state.getResources(resourceType);

    if (target) {
        const targetArray = Array.isArray(target) ? target : [target];
        resources = resources.filter(r => targetArray.some(t => r.identity === t || r.identity.startsWith(`${t}::`) || r.identity.endsWith(`/${t}`) || r.identity.endsWith(t)));
    }

    if (resources.length === 0) {
        await state.save();
        if (!silent) console.log('No resources in state to refresh.');
        return;
    }

    const config = new Config(dir);
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

    const github = new GitHubAdapter(ghConfig);

    let refreshed = 0;
    let removed = 0;

    const parallelism = parallelismRaw ? parseInt(String(parallelismRaw), 10) || 3 : 3;

    for (let i = 0; i < resources.length; i += parallelism) {
        const batch = resources.slice(i, i + parallelism);
        await Promise.all(batch.map(async (res) => {
            const remoteId = res.attributes.remoteId ?? '';
            const { formatResourceAddress } = require('../core/utils');
            if (!silent) console.log(`${formatResourceAddress(res.type, res.identity)}: Refreshing state... ${dim(`[id=${remoteId}]`)}`);

            try {
                if (!res.attributes.issueNumber) {
                    if (!silent) console.log(yellow(`  ${res.identity}: No issue number — removing from state`));
                    state.removeResource(res.identity);
                    removed++;
                    return;
                }

                const issue = await github.getIssue(res.attributes.issueNumber);

                if (!issue) {
                    if (!silent) console.log(red(`  ${res.identity}: Issue #${res.attributes.issueNumber} not found — removing from state`));
                    state.removeResource(res.identity);
                    removed++;
                } else {
                    let driftDetected = false;

                    // Sync title
                    if (res.attributes.title !== issue.title) {

                        res.attributes.title = issue.title;
                        driftDetected = true;
                    }

                    // Helper to compare string arrays case-insensitively
                    const arraysEqual = (a: string[] = [], b: string[] = []) => {
                        if (a.length !== b.length) return false;
                        const sortedA = [...a].sort();
                        const sortedB = [...b].sort();
                        return sortedA.every((val, index) => val === sortedB[index]);
                    };

                    const remoteLabels = issue.labels ?? [];
                    const localLabels = Array.isArray(res.attributes.labels) ? res.attributes.labels : (res.attributes.labels ? String(res.attributes.labels).split(',') : []);
                    if (!arraysEqual(localLabels, remoteLabels)) {

                        res.attributes.labels = remoteLabels as any;
                        driftDetected = true;
                    }

                    const remoteAssignees = issue.assignees ?? [];
                    const localAssignees = Array.isArray(res.attributes.assignees) ? res.attributes.assignees : (res.attributes.assignees ? String(res.attributes.assignees).split(',') : []);
                    if (!arraysEqual(localAssignees, remoteAssignees)) {

                        res.attributes.assignees = remoteAssignees as any;
                        driftDetected = true;
                    }

                    const remoteMilestone = issue.milestone ?? '';
                    const localMilestone = String(res.attributes.milestone ?? '');
                    if (localMilestone !== remoteMilestone) {

                        res.attributes.milestone = remoteMilestone;
                        driftDetected = true;
                    }

                    // Fetch custom fields
                    if (issue.node_id) {
                        const remoteCustomFields = await github.getProjectItemFields(issue.node_id);
                        const localCustomFields: Record<string, string> = (res.attributes.custom_fields as Record<string, string>) || {};

                        // Check all local custom fields to see if they changed or were cleared on remote
                        for (const localKey of Object.keys(localCustomFields)) {
                            // Find the remote value (case insensitive match)
                            const remoteKeyMatch = Object.keys(remoteCustomFields).find(k => k.toLowerCase() === localKey.toLowerCase());
                            const remoteVal = remoteKeyMatch ? remoteCustomFields[remoteKeyMatch] : '';
                            
                            const localVal = String(Object.prototype.hasOwnProperty.call(localCustomFields, localKey) ? localCustomFields[localKey] : '');
                            
                            // Clean prefix '@' if present for comparison
                            const cleanLocalVal = localVal.startsWith('@') ? localVal.substring(1).toLowerCase() : localVal.toLowerCase();
                            const cleanRemoteVal = remoteVal.toLowerCase();

                            if (cleanLocalVal !== cleanRemoteVal) {

                                Object.assign(localCustomFields, { [localKey]: remoteVal });
                                driftDetected = true;
                            }
                        }
                        res.attributes.custom_fields = localCustomFields;
                    }

                    if (driftDetected) {
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
        }));
    }

    await state.save();

    if (!silent) {
        console.log('');
        console.log(green(bold(`Refresh complete! ${refreshed} resource(s) refreshed, ${removed} removed.`)));
    }
};

/**
 * Refresh command entry point: standalone `testform refresh` execution.
 *
 * @param dir         - Working directory containing `testform.json`.
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
    scope: IScope | 'all';
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
        scope,
        lock = true,
        lockTimeout = '0s',
        statePath,
        backupPath,
        parallelismRaw,
        compactWarnings,
        target
    } = options;
    const logger = new Logger(verbose);
    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);

    try {
        const scopesToRun: IScope[] = (scope as string) === 'all' ? ['testcase', 'testrun', 'testplan'] : [scope as IScope];
        for (const s of scopesToRun) {
            await refreshState({ dir, scope: s, state: stateObj, logger, silent: false, parallelismRaw, target });
        }
    } finally {
        await stateObj.releaseLock();
    }
};
