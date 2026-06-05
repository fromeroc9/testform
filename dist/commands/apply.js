"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCmd = void 0;
const const_1 = require("../const");
const fs_1 = require("fs");
const chalk_1 = require("chalk");
const resources_1 = require("../adapters/resources");
const state_1 = require("../core/state");
const logger_1 = require("../logger");
const notify_1 = require("../notify");
const plan_1 = require("./plan");
const refresh_1 = require("./refresh");
const prompt_1 = require("../core/prompt");
const utils_1 = require("../core/utils");
const command_context_1 = require("../core/command-context");
const applyCmd = async (options) => {
    const { dir = '.', autoApprove = false, verbose = false, scope, planFile, lock = true, lockTimeout = '0s', input = true, variables, statePath, backupPath, target, refresh = true, refreshOnly = false, setStatus, replaceTargets, parallelism, compactWarnings, testDirectory } = options;
    const logger = new logger_1.Logger(verbose);
    const stateObj = new state_1.State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);
    try {
        let plan;
        if (planFile) {
            const path = require('path');
            const resolvedPlanFile = path.resolve(dir, planFile);
            if (!(0, fs_1.existsSync)(resolvedPlanFile)) {
                logger.error(`Failed to load "${planFile}" as a plan file\n\nstat ${resolvedPlanFile}: no such file or directory`);
            }
            try {
                const planContent = (0, fs_1.readFileSync)(resolvedPlanFile, 'utf-8');
                const planData = JSON.parse(planContent);
                plan = {
                    changes: planData.changes || [],
                    hasChanges: planData.changes && planData.changes.length > 0,
                    state: new state_1.State(dir)
                };
                await plan.state.init();
            }
            catch (e) {
                logger.error(`Failed to load "${planFile}" as a plan file\n\nError parsing JSON: ${e.message}`);
                return;
            }
        }
        else {
            if (setStatus && scope === 'testrun') {
                const ctx = await (0, command_context_1.createCommandContext)({ dir, verbose, lock: false });
                if (!ctx)
                    return;
                let targetId = setStatus;
                let newStatus = '';
                if (setStatus.includes('=')) {
                    [targetId, newStatus] = setStatus.split('=').map(s => s.trim());
                }
                else {
                    newStatus = await (0, prompt_1.askStatus)();
                }
                targetId = targetId.replace(/^github_testcase\./, '').replace(/^github_testrun\./, '');
                const rawResources = stateObj.getResources('github_testrun');
                let foundRun = null;
                for (const r of rawResources) {
                    const commentIds = r.attributes?.testcaseCommentIds || {};
                    const matchingKey = Object.keys(commentIds).find(k => k === targetId || k.endsWith(`::${targetId}`));
                    if (matchingKey) {
                        foundRun = r;
                        targetId = matchingKey;
                        break;
                    }
                }
                if (!foundRun) {
                    notify_1.notify.push({ type: 'error', title: `Could not find testcase '${targetId}' in any testrun state.`, detail: [] });
                    return;
                }
                const commentId = foundRun.attributes.testcaseCommentIds[targetId];
                if (commentId) {
                    const tcResource = stateObj.getResources('github_testcase').find(r => r.identity === targetId);
                    const tcTitle = tcResource?.attributes?.title || targetId;
                    const keys = Object.keys(foundRun.attributes.testcaseCommentIds);
                    const i = keys.indexOf(targetId) + 1;
                    const commentBody = `| # | Test Case | Status |\n|---|-----------|--------|\n| ${i} | ${tcTitle} | ${newStatus} |`;
                    await ctx.github.updateIssueComment(commentId, commentBody);
                    console.log(`  -> Updated status comment for ${targetId} to '${newStatus}'`);
                    if (!foundRun.attributes.testcaseStatuses)
                        foundRun.attributes.testcaseStatuses = {};
                    foundRun.attributes.testcaseStatuses[targetId] = newStatus;
                    await stateObj.save();
                    console.log((0, chalk_1.green)((0, chalk_1.bold)(`Status successfully updated!`)));
                }
                return;
            }
            if (refresh && !refreshOnly) {
                console.log(const_1.MSG_ACQUIRING_LOCK);
                await (0, refresh_1.refreshState)({ dir, scope, state: stateObj, logger, silent: false, parallelismRaw: parallelism, target });
            }
            // Calculate plan (read-only)
            plan = await (0, plan_1.calculatePlan)({
                dir, scope, variables, statePath, backupPath, target, destroyPlan: false, refreshOnly, preLoadedState: stateObj, lock, lockTimeout, replaceTargets, compactWarnings, testDirectory
            });
            // Show plan summary
            resources_1.resource.summary(plan.changes, false, { state: plan.state });
            if (!plan.hasChanges) {
                return;
            }
            // Ask for approval
            if (!autoApprove) {
                if (!input) {
                    const error = new Error(const_1.ERR_NO_INPUT_ALLOWED + '\nUse the -auto-approve flag to bypass approval.');
                    error.name = 'No input allowed';
                    throw error;
                }
                const approved = await (0, prompt_1.askApproval)();
                if (!approved) {
                    notify_1.notify.push({
                        type: 'error',
                        title: 'error asking for approval: interrupted',
                        detail: [],
                    });
                    return;
                }
            }
        }
        if (planFile && !plan.hasChanges) {
            console.log('No changes found in the provided plan file.');
            return;
        }
        // Initialize context AFTER approval to connect to GitHub.
        // We pass lock: false because stateObj already holds the lock.
        const ctx = await (0, command_context_1.createCommandContext)({ dir, verbose, lock: false });
        if (!ctx)
            return;
        const { github } = ctx;
        let added = 0;
        let changed = 0;
        let destroyed = 0;
        // Helper to resolve milestone titles to IDs
        const resolvePayloadMilestone = async (payload) => {
            if (typeof payload.milestone === 'string' && payload.milestone) {
                payload.milestone = await github.getMilestoneByTitle(payload.milestone);
            }
            else if (!payload.milestone) {
                delete payload.milestone;
            }
        };
        // Helper to link testruns as sub-issues to testplans
        const linkSubIssues = async (change, parentIssueNumber) => {
            if (change.resourceType === 'github_testplan' && change.scenario.custom?.testruns) {
                for (const tr of change.scenario.custom.testruns) {
                    const runResources = stateObj.getResources('github_testrun').filter(r => r.identity.endsWith(tr) || r.identity.includes(tr));
                    if (runResources.length > 1) {
                        const uris = Array.from(new Set(runResources.map(r => r.identity)));
                        logger.warn(`Rule '${tr}' in Testplan matches multiple Testruns. Linking all of them:\n` + uris.map(u => `  - ${u}`).join('\n') + `\nIf this was unintentional, specify the full file path.`);
                    }
                    for (const runResource of runResources) {
                        if (runResource?.attributes?.issueNumber) {
                            try {
                                const issueDetails = await github.getIssue(runResource.attributes.issueNumber);
                                if (issueDetails && issueDetails.id) {
                                    await github.addSubIssue(parentIssueNumber, issueDetails.id);
                                    console.log(`  -> Linked testrun ${runResource.identity} as sub-issue to testplan`);
                                }
                            }
                            catch (e) {
                                console.log(`  -> Failed to link testrun ${runResource.identity} as sub-issue: ${e.message}`);
                            }
                        }
                    }
                }
            }
        };
        // Helper to sync status comments for testruns
        const syncTestrunComments = async (change, issueNumber, existingAttributes) => {
            if (change.resourceType !== 'github_testrun' || !change.scenario.custom?.testcases)
                return {};
            const testcaseCommentIds = existingAttributes?.testcaseCommentIds || {};
            const testcaseStatuses = existingAttributes?.testcaseStatuses || {};
            let i = 1;
            for (const tc of change.scenario.custom.testcases) {
                const parts = tc.split('::');
                const scenarioName = parts.pop();
                const ruleName = parts.pop() || '';
                const baseRule = ruleName.replace('.case.feature', '').replace('.feature', '');
                const tcResources = stateObj.getResources('github_testcase').filter((r) => r.identity.includes(baseRule) && (scenarioName === '*' || r.identity.endsWith(`::${scenarioName}`)));
                for (const tcResource of tcResources) {
                    const tcIdentity = tcResource.identity;
                    const groupScenario = change.scenario.custom.groupScenarios.find((s) => {
                        if (!s.rule || !s.name)
                            return false;
                        const sBaseRule = s.rule.name.replace('.case.feature', '').replace('.feature', '');
                        return tcIdentity.includes(sBaseRule) && (s.name === '*' || tcIdentity.endsWith(`::${s.name}`));
                    });
                    const localStatus = groupScenario?.custom?.fields?.status || groupScenario?.custom?.fields?.Status || existingAttributes?.testcaseStatuses?.[tcIdentity] || 'pending';
                    const tcTitle = tcResource.attributes?.title || tcIdentity;
                    if (!testcaseCommentIds[tcIdentity] || testcaseStatuses[tcIdentity] !== localStatus) {
                        const commentBody = `| # | Test Case | Status |\n|---|-----------|--------|\n| ${i} | ${tcTitle} | ${localStatus} |`;
                        if (testcaseCommentIds[tcIdentity]) {
                            await github.updateIssueComment(testcaseCommentIds[tcIdentity], commentBody);
                            console.log(`  -> Updated status comment for ${tcIdentity} to '${localStatus}'`);
                        }
                        else {
                            const result = await github.createIssueComment(issueNumber, commentBody);
                            testcaseCommentIds[tcIdentity] = result.id;
                            console.log(`  -> Created status comment for ${tcIdentity} as '${localStatus}'`);
                        }
                        testcaseStatuses[tcIdentity] = localStatus;
                    }
                    i++;
                }
            }
            return { testcaseCommentIds, testcaseStatuses };
        };
        // Execute changes in parallel batches
        const parallelismNum = parallelism ? parseInt(String(parallelism), 10) || 10 : 10;
        for (let i = 0; i < plan.changes.length; i += parallelismNum) {
            const batch = plan.changes.slice(i, i + parallelismNum);
            await Promise.all(batch.map(async (change) => {
                try {
                    if (change.action === 'add') {
                        const address = (0, utils_1.formatResourceAddress)(change.resourceType, change.identity);
                        console.log(`${address}: Creating...`);
                        const startTime = Date.now();
                        const payload = resources_1.resource.evaluate(change.resourceType, change.scenario, { state: stateObj });
                        await resolvePayloadMilestone(payload);
                        const result = await github.createIssue(payload);
                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && payload.custom_fields) {
                                await github.updateProjectItemFields(itemId, payload.custom_fields);
                            }
                        }
                        const elapsed = (0, utils_1.elapsedSeconds)(startTime);
                        const remoteId = github.formatRemoteId(result.number);
                        console.log((0, chalk_1.green)(`${address}: Creation complete after ${elapsed}s [id=${remoteId}]`));
                        // Link sub-issues
                        await linkSubIssues(change, result.number);
                        // Sync status comments
                        const { testcaseCommentIds, testcaseStatuses } = await syncTestrunComments(change, result.number);
                        // Update state
                        stateObj.upsertResource({
                            type: change.resourceType,
                            identity: change.identity,
                            attributes: {
                                localHash: change.localHash,
                                remoteId,
                                issueNumber: result.number,
                                title: payload.title,
                                body: payload.body,
                                labels: payload.labels,
                                assignees: payload.assignees,
                                milestone: payload.milestone ?? '',
                                custom_fields: payload.custom_fields,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...(testcaseCommentIds ? { testcaseCommentIds, testcaseStatuses } : {}),
                            },
                            lastApplied: new Date().toISOString(),
                        });
                        // Link sub-issues
                        await linkSubIssues(change, result.number);
                        added++;
                    }
                    else if (change.action === 'replace') {
                        const address = (0, utils_1.formatResourceAddress)(change.resourceType, change.identity);
                        const remoteId = change.remoteId ?? '';
                        console.log(`${address}: Replacing... [id=${remoteId}]`);
                        const startTime = Date.now();
                        // 1. Destroy (close issue)
                        if (change.issueNumber) {
                            await github.updateIssue(change.issueNumber, { state: 'closed' });
                        }
                        // 2. Add (create new issue)
                        const payload = resources_1.resource.evaluate(change.resourceType, change.scenario, { state: stateObj });
                        await resolvePayloadMilestone(payload);
                        const result = await github.createIssue(payload);
                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && payload.custom_fields) {
                                await github.updateProjectItemFields(itemId, payload.custom_fields);
                            }
                        }
                        const elapsed = (0, utils_1.elapsedSeconds)(startTime);
                        const newRemoteId = github.formatRemoteId(result.number);
                        console.log((0, chalk_1.green)(`${address}: Replacement complete after ${elapsed}s [id=${newRemoteId}]`));
                        // Link sub-issues
                        await linkSubIssues(change, result.number);
                        // Sync status comments (existingAttributes is empty because it's a replacement)
                        const { testcaseCommentIds, testcaseStatuses } = await syncTestrunComments(change, result.number);
                        // 3. Update state
                        stateObj.upsertResource({
                            type: change.resourceType,
                            identity: change.identity,
                            attributes: {
                                localHash: change.localHash,
                                remoteId: newRemoteId,
                                issueNumber: result.number,
                                title: payload.title,
                                body: payload.body,
                                labels: payload.labels,
                                assignees: payload.assignees,
                                milestone: payload.milestone ?? '',
                                custom_fields: payload.custom_fields,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...(testcaseCommentIds ? { testcaseCommentIds, testcaseStatuses } : {}),
                            },
                            lastApplied: new Date().toISOString(),
                        });
                        destroyed++;
                        added++;
                    }
                    else if (change.action === 'change') {
                        const address = (0, utils_1.formatResourceAddress)(change.resourceType, change.identity);
                        const remoteId = change.remoteId ?? '';
                        console.log(`${address}: Modifying... [id=${remoteId}]`);
                        const startTime = Date.now();
                        const payload = resources_1.resource.evaluate(change.resourceType, change.scenario, { state: stateObj });
                        await resolvePayloadMilestone(payload);
                        const result = await github.updateIssue(change.issueNumber, payload);
                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && payload.custom_fields) {
                                await github.updateProjectItemFields(itemId, payload.custom_fields);
                            }
                        }
                        // Sub-issues linking removed: testcases are now embedded in the testrun body.
                        const elapsed = (0, utils_1.elapsedSeconds)(startTime);
                        console.log((0, chalk_1.green)(`${address}: Modifications complete after ${elapsed}s [id=${remoteId}]`));
                        // Link sub-issues
                        await linkSubIssues(change, result.number);
                        // Sync status comments
                        const existingAttributes = stateObj.getResources(change.resourceType).find((r) => r.identity === change.identity)?.attributes;
                        const { testcaseCommentIds, testcaseStatuses } = await syncTestrunComments(change, result.number, existingAttributes);
                        // Update state
                        stateObj.upsertResource({
                            type: change.resourceType,
                            identity: change.identity,
                            attributes: {
                                localHash: change.localHash,
                                remoteId,
                                issueNumber: change.issueNumber,
                                title: payload.title,
                                body: payload.body,
                                labels: payload.labels,
                                assignees: payload.assignees,
                                milestone: payload.milestone ?? '',
                                custom_fields: payload.custom_fields,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...(testcaseCommentIds ? { testcaseCommentIds, testcaseStatuses } : {}),
                            },
                            lastApplied: new Date().toISOString(),
                        });
                        changed++;
                    }
                    else if (change.action === 'destroy') {
                        const address = (0, utils_1.formatResourceAddress)(change.resourceType, change.identity);
                        const remoteId = change.remoteId ?? '';
                        console.log(`${address}: Destroying... [id=${remoteId}]`);
                        const startTime = Date.now();
                        if (change.issueNumber) {
                            await github.closeIssue(change.issueNumber);
                        }
                        const elapsed = (0, utils_1.elapsedSeconds)(startTime);
                        console.log((0, chalk_1.green)(`${address}: Destruction complete after ${elapsed}s [id=${remoteId}]`));
                        // Remove from state
                        stateObj.removeResource(change.identity);
                        destroyed++;
                    }
                }
                catch (error) {
                    notify_1.notify.push({
                        type: 'error',
                        title: `${error.message}`,
                        detail: [
                            `  with ${change.resourceType}.${change.identity}`,
                        ],
                    });
                }
            }));
        }
        // Save state once after all operations
        // Final empty line for better UX
        console.log("");
        await stateObj.save();
        console.log((0, chalk_1.green)((0, chalk_1.bold)(`Apply complete! Resources: ${added} added, ${changed} changed, ${destroyed} destroyed.`)));
    }
    finally {
        await stateObj.releaseLock();
    }
};
exports.applyCmd = applyCmd;
