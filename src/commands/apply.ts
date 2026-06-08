import { MSG_ACQUIRING_LOCK, ERR_NO_INPUT_ALLOWED } from '../core/const';
import { existsSync, readFileSync } from 'fs';
import { bold, green } from 'chalk';
import { resource } from '../core/resources';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { logger as notify } from '../core/logger';
import { calculatePlan } from './plan';
import { IScope, GitHubIssuePayload } from '../core/types';
import { VariableParser } from '../core/variables';
import { refreshState } from './refresh';
import { askApproval } from '../core/prompt';
import { formatResourceAddress, elapsedSeconds } from '../core/utils';
import { createCommandContext } from '../core/command-context';

interface ApplyCmdOptions {
    dir?: string;
    autoApprove?: boolean;
    verbose?: boolean;
    scope: IScope | 'all';
    planFile?: string;
    lock?: boolean;
    lockTimeout?: string;
    input?: boolean;
    variables?: VariableParser;
    statePath?: string;
    backupPath?: string;
    target?: string | string[];
    refresh?: boolean;
    refreshOnly?: boolean;
    replaceTargets?: string | string[];
    parallelism?: string | number;
    compactWarnings?: boolean;
    testDirectory?: string;
}

export const applyCmd = async (options: ApplyCmdOptions) => {
    const {
        dir = '.',
        autoApprove = false,
        verbose = false,
        scope,
        planFile,
        lock = true,
        lockTimeout = '0s',
        input = true,
        variables,
        statePath,
        backupPath,
        target,
        refresh = true,
        refreshOnly = false,
        replaceTargets,
        parallelism,
        compactWarnings,
        testDirectory
    } = options;
    const logger = new Logger(verbose);
    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);

    try {
        let plan: import('../core/types').PlanResult;

        if (planFile) {
            const path = require('path');
            const resolvedPlanFile = path.resolve(dir, planFile);
            if (!existsSync(resolvedPlanFile)) {
                logger.error(`Failed to load "${planFile}" as a plan file\n\nstat ${resolvedPlanFile}: no such file or directory`);
            }
            try {
                const planContent = readFileSync(resolvedPlanFile, 'utf-8');
                const planData = JSON.parse(planContent);
                plan = {
                    changes: planData.changes || [],
                    hasChanges: planData.changes && planData.changes.length > 0,
                    state: new State(dir)
                };
                await plan.state.init();
            } catch (e: any) {
                logger.error(`Failed to load "${planFile}" as a plan file\n\nError parsing JSON: ${e.message}`);
                return;
            }
        } else {

            const scopesToRun: IScope[] = (scope as string) === 'all' ? ['testcase', 'testrun', 'testplan'] : [scope as IScope];
            let allChanges: any[] = [];
            let finalState = stateObj;

            for (const s of scopesToRun) {
                if (refresh && !refreshOnly) {
                    console.log(MSG_ACQUIRING_LOCK);
                    await refreshState({ dir, scope: s, state: stateObj, logger, silent: false, parallelismRaw: parallelism, target });
                }

                // Calculate plan (read-only)
                const sPlan = await calculatePlan({
                    dir, scope: s, variables, statePath, backupPath, target, destroyPlan: false, refreshOnly, preLoadedState: stateObj, lock, lockTimeout, replaceTargets, compactWarnings, testDirectory
                });

                allChanges.push(...sPlan.changes);
                finalState = sPlan.state;
            }

            plan = { changes: allChanges, hasChanges: allChanges.length > 0, state: finalState };

            // Show plan summary
            resource.summary(plan.changes, false, { state: plan.state });

            if (!plan.hasChanges) {
                return;
            }

            // Ask for approval
            if (!autoApprove) {
                if (!input) {
                    const error = new Error(ERR_NO_INPUT_ALLOWED + '\nUse the -auto-approve flag to bypass approval.');
                    error.name = 'No input allowed';
                    throw error;
                }
                const approved = await askApproval();
                if (!approved) {
                    notify.push({
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
        const ctx = await createCommandContext({ dir, verbose, lock: false });
        if (!ctx) return;
        const { github } = ctx;

        let added = 0;
        let changed = 0;
        let destroyed = 0;

        // Helper to resolve milestone titles to IDs
        const resolvePayloadMilestone = async (payload: GitHubIssuePayload) => {
            if (typeof payload.milestone === 'string' && payload.milestone) {
                payload.milestone = await github.getMilestoneByTitle(payload.milestone);
            } else if (!payload.milestone) {
                delete payload.milestone;
            }
        };

        // Helper to link testruns as sub-issues to testplans
        const linkSubIssues = async (change: any, parentIssueNumber: number) => {
            if (change.resourceType === 'github_testplan' && change.scenario.custom?.testruns) {
                for (const tr of change.scenario.custom.testruns) {
                    const runResources = stateObj.getResources('github_testrun').filter(r =>
                        r.identity.endsWith(tr) || r.identity.includes(tr)
                    );

                    if (runResources.length > 1) {
                        const uris = Array.from(new Set(runResources.map(r => r.identity)));
                        logger.warn(`Rule '${tr}' in Testplan matches multiple Testruns. Linking all of them:\n` + uris.map(u => `  - ${u}`).join('\n') + `\nIf this was unintentional, specify the full file path.`);
                    }

                    for (const runResource of runResources) {
                        if (runResource?.attributes?.issueNumber) {
                            try {
                                const issueDetails = await github.getIssue(runResource.attributes.issueNumber as number);
                                if (issueDetails && issueDetails.id) {
                                    await github.addSubIssue(parentIssueNumber, issueDetails.id);
                                    console.log(`  -> Linked testrun ${runResource.identity} as sub-issue to testplan`);
                                }
                            } catch (e: any) {
                                console.log(`  -> Failed to link testrun ${runResource.identity} as sub-issue: ${e.message}`);
                            }
                        }
                    }
                }
            }
        };

        // Helper to sync status comments for testruns
        const syncTestrunComments = async (change: any, issueNumber: number, existingAttributes?: any) => {
            if (change.resourceType !== 'github_testrun' || !change.scenario.custom?.testcases) return {};

            const testcaseCommentIds: Record<string, any> = existingAttributes?.testcaseCommentIds || {};
            const testcaseStatuses: Record<string, string> = existingAttributes?.testcaseStatuses || {};
            const expandedTestcases: string[] = [];

            const comments = resource.evaluateComments(change.resourceType, change.scenario, { state: stateObj, testDirectory, existingAttributes });

            for (const comment of comments) {
                const { identity, status, body } = comment;
                expandedTestcases.push(identity);

                if (!testcaseCommentIds[identity] || testcaseStatuses[identity] !== status) {
                    if (testcaseCommentIds[identity]) {
                        await github.updateIssueComment(testcaseCommentIds[identity], body);
                        console.log(`  -> Updated status comment for ${identity} to '${status}'`);
                    } else {
                        const result = await github.createIssueComment(issueNumber, body);
                        testcaseCommentIds[identity] = result.id;
                        console.log(`  -> Created status comment for ${identity} as '${status}'`);
                    }
                    testcaseStatuses[identity] = status;
                }
            }

            return { testcaseCommentIds, testcaseStatuses, expandedTestcases };
        };

        // Execute changes in parallel batches
        const parallelismNum = parallelism ? parseInt(String(parallelism), 10) || 10 : 10;

        for (let i = 0; i < plan.changes.length; i += parallelismNum) {
            const batch = plan.changes.slice(i, i + parallelismNum);

            await Promise.all(batch.map(async (change) => {
                try {
                    if (change.action === 'add') {
                        const address = formatResourceAddress(change.resourceType, change.identity);
                        console.log(`${address}: Creating...`);
                        const startTime = Date.now();

                        const payload = resource.evaluate(change.resourceType, change.scenario, { state: stateObj, testDirectory }) as unknown as GitHubIssuePayload;
                        await resolvePayloadMilestone(payload);
                        const result = await github.createIssue(payload);

                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && (payload as any).custom_fields) {
                                await github.updateProjectItemFields(itemId, (payload as any).custom_fields);
                            }
                        }

                        const elapsed = elapsedSeconds(startTime);
                        const remoteId = github.formatRemoteId(result.number);
                        console.log(green(`${address}: Creation complete after ${elapsed}s [id=${remoteId}]`));

                        // Link sub-issues
                        await linkSubIssues(change, result.number);

                        // Sync status comments
                        const { testcaseCommentIds, testcaseStatuses, expandedTestcases } = await syncTestrunComments(change, result.number);

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
                                assignees: (payload as any).assignees,
                                milestone: (payload as any).milestone ?? '',
                                custom_fields: (payload as any).custom_fields,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...(testcaseCommentIds ? { testcaseCommentIds, testcaseStatuses } : {}),
                            },
                            lastApplied: new Date().toISOString(),
                        });

                        // Link sub-issues
                        await linkSubIssues(change, result.number);

                        added++;

                    } else if (change.action === 'replace') {
                        const address = formatResourceAddress(change.resourceType, change.identity);
                        const remoteId = change.remoteId ?? '';
                        console.log(`${address}: Replacing... [id=${remoteId}]`);
                        const startTime = Date.now();

                        // 1. Destroy (close issue)
                        if (change.issueNumber) {
                            await github.updateIssue(change.issueNumber, { state: 'closed' });
                        }

                        // 2. Add (create new issue)
                        const payload = resource.evaluate(change.resourceType, change.scenario, { state: stateObj, testDirectory }) as unknown as GitHubIssuePayload;
                        await resolvePayloadMilestone(payload);
                        const result = await github.createIssue(payload);

                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && (payload as any).custom_fields) {
                                await github.updateProjectItemFields(itemId, (payload as any).custom_fields);
                            }
                        }

                        const elapsed = elapsedSeconds(startTime);
                        const newRemoteId = github.formatRemoteId(result.number);
                        console.log(green(`${address}: Replacement complete after ${elapsed}s [id=${newRemoteId}]`));

                        // Link sub-issues
                        await linkSubIssues(change, result.number);

                        // Sync status comments (existingAttributes is empty because it's a replacement)
                        const { testcaseCommentIds, testcaseStatuses, expandedTestcases } = await syncTestrunComments(change, result.number);

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
                                assignees: (payload as any).assignees,
                                milestone: (payload as any).milestone ?? '',
                                custom_fields: (payload as any).custom_fields,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...(testcaseCommentIds ? { testcaseCommentIds, testcaseStatuses } : {}),
                            },
                            lastApplied: new Date().toISOString(),
                        });

                        destroyed++;
                        added++;

                    } else if (change.action === 'change') {
                        const address = formatResourceAddress(change.resourceType, change.identity);
                        const remoteId = change.remoteId ?? '';
                        console.log(`${address}: Modifying... [id=${remoteId}]`);
                        const startTime = Date.now();

                        const payload = resource.evaluate(change.resourceType, change.scenario, { state: stateObj, testDirectory }) as unknown as GitHubIssuePayload;
                        await resolvePayloadMilestone(payload);
                        const result = await github.updateIssue(change.issueNumber!, payload);

                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && (payload as any).custom_fields) {
                                await github.updateProjectItemFields(itemId, (payload as any).custom_fields);
                            }
                        }

                        // Sub-issues linking removed: testcases are now embedded in the testrun body.

                        const elapsed = elapsedSeconds(startTime);
                        console.log(green(`${address}: Modifications complete after ${elapsed}s [id=${remoteId}]`));

                        // Link sub-issues
                        await linkSubIssues(change, result.number);

                        // Sync status comments
                        const existingAttributes = stateObj.getResources(change.resourceType).find((r: any) => r.identity === change.identity)?.attributes;
                        const { testcaseCommentIds, testcaseStatuses, expandedTestcases } = await syncTestrunComments(change, result.number, existingAttributes);

                        // Update state
                        stateObj.upsertResource({
                            type: change.resourceType,
                            identity: change.identity,
                            attributes: {
                                localHash: change.localHash,
                                remoteId,
                                issueNumber: change.issueNumber!,
                                title: payload.title,
                                body: payload.body,
                                labels: payload.labels,
                                assignees: (payload as any).assignees,
                                milestone: (payload as any).milestone ?? '',
                                custom_fields: (payload as any).custom_fields,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...(testcaseCommentIds ? { testcaseCommentIds, testcaseStatuses } : {}),
                            },
                            lastApplied: new Date().toISOString(),
                        });

                        changed++;

                    } else if (change.action === 'destroy') {
                        const address = formatResourceAddress(change.resourceType, change.identity);
                        const remoteId = change.remoteId ?? '';
                        console.log(`${address}: Destroying... [id=${remoteId}]`);
                        const startTime = Date.now();

                        if (change.issueNumber) {
                            await github.closeIssue(change.issueNumber);
                        }

                        const elapsed = elapsedSeconds(startTime);
                        console.log(green(`${address}: Destruction complete after ${elapsed}s [id=${remoteId}]`));

                        // Remove from state
                        stateObj.removeResource(change.identity);

                        destroyed++;
                    }
                } catch (error: any) {
                    notify.push({
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

        console.log(green(bold(`Apply complete! Resources: ${added} added, ${changed} changed, ${destroyed} destroyed.`)));
    } finally {
        await stateObj.releaseLock();
    }
}
