"use strict";
/**
 * @fileoverview `testform refresh` command.
 *
 * Synchronizes the local state file against the remote GitHub repository
 * by checking each tracked issue's current status and updating or removing
 * stale state entries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshCmd = exports.refreshState = void 0;
const chalk_1 = require("chalk");
const github_1 = require("../adapters/github");
const config_1 = require("../core/config");
const state_1 = require("../core/state");
const logger_1 = require("../logger");
const notify_1 = require("../notify");
const const_1 = require("../const");
const refreshState = async (options) => {
    const { dir, scope, state, logger, silent = false, parallelismRaw, target } = options;
    if (!Object.prototype.hasOwnProperty.call(const_1.SCOPE_RESOURCE_MAP, scope)) {
        throw new Error(`Invalid scope: ${scope}`);
    }
    const resourceType = const_1.SCOPE_RESOURCE_MAP[scope];
    let resources = state.getResources(resourceType);
    if (target) {
        resources = resources.filter(r => r.identity === target || r.identity.startsWith(`${target}::`) || r.identity.endsWith(`/${target}`) || r.identity.endsWith(target));
    }
    if (resources.length === 0) {
        await state.save();
        if (!silent)
            console.log('No resources in state to refresh.');
        return;
    }
    const config = new config_1.Config(dir);
    const ghConfig = config.getGitHub();
    if (!ghConfig) {
        if (!silent) {
            notify_1.notify.push({
                type: 'error',
                title: 'GitHub configuration not found',
                detail: [const_1.ERR_GITHUB_CONFIG_NOT_FOUND],
                close: true,
            });
        }
        return;
    }
    const github = new github_1.GitHubAdapter(ghConfig);
    let refreshed = 0;
    let removed = 0;
    const parallelism = parallelismRaw ? parseInt(String(parallelismRaw), 10) || 10 : 10;
    for (let i = 0; i < resources.length; i += parallelism) {
        const batch = resources.slice(i, i + parallelism);
        await Promise.all(batch.map(async (res) => {
            const remoteId = res.attributes.remoteId ?? '';
            const { formatResourceAddress } = require('../core/utils');
            if (!silent)
                console.log(`${formatResourceAddress(res.type, res.identity)}: Refreshing state... ${(0, chalk_1.dim)(`[id=${remoteId}]`)}`);
            try {
                if (!res.attributes.issueNumber) {
                    if (!silent)
                        console.log((0, chalk_1.yellow)(`  ${res.identity}: No issue number — removing from state`));
                    state.removeResource(res.identity);
                    removed++;
                    return;
                }
                const issue = await github.getIssue(res.attributes.issueNumber);
                if (!issue) {
                    if (!silent)
                        console.log((0, chalk_1.red)(`  ${res.identity}: Issue #${res.attributes.issueNumber} not found — removing from state`));
                    state.removeResource(res.identity);
                    removed++;
                }
                else {
                    let driftDetected = false;
                    // Sync title
                    if (res.attributes.title !== issue.title) {
                        res.attributes.title = issue.title;
                        driftDetected = true;
                    }
                    // Helper to compare string arrays case-insensitively
                    const arraysEqual = (a = [], b = []) => {
                        if (a.length !== b.length)
                            return false;
                        const sortedA = [...a].sort();
                        const sortedB = [...b].sort();
                        return sortedA.every((val, index) => val === sortedB[index]);
                    };
                    const remoteLabels = issue.labels ?? [];
                    const localLabels = Array.isArray(res.attributes.labels) ? res.attributes.labels : (res.attributes.labels ? String(res.attributes.labels).split(',') : []);
                    if (!arraysEqual(localLabels, remoteLabels)) {
                        res.attributes.labels = remoteLabels;
                        driftDetected = true;
                    }
                    const remoteAssignees = issue.assignees ?? [];
                    const localAssignees = Array.isArray(res.attributes.assignees) ? res.attributes.assignees : (res.attributes.assignees ? String(res.attributes.assignees).split(',') : []);
                    if (!arraysEqual(localAssignees, remoteAssignees)) {
                        res.attributes.assignees = remoteAssignees;
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
                        const localCustomFields = res.attributes.custom_fields || {};
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
            }
            catch (error) {
                if (!silent) {
                    notify_1.notify.push({
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
        console.log((0, chalk_1.green)((0, chalk_1.bold)(`Refresh complete! ${refreshed} resource(s) refreshed, ${removed} removed.`)));
    }
};
exports.refreshState = refreshState;
const refreshCmd = async (options) => {
    const { dir = '.', verbose = false, scope, lock = true, lockTimeout = '0s', statePath, backupPath, parallelismRaw, compactWarnings, target } = options;
    const logger = new logger_1.Logger(verbose);
    const stateObj = new state_1.State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);
    try {
        await (0, exports.refreshState)({ dir, scope, state: stateObj, logger, silent: false, parallelismRaw, target });
    }
    finally {
        await stateObj.releaseLock();
    }
};
exports.refreshCmd = refreshCmd;
