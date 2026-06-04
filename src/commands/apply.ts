import { createInterface } from 'readline';
import { existsSync, readFileSync } from 'fs';
import { bold, green } from 'chalk';
import { resource } from '../adapters/resources';
import { State } from '../core/state';
import { Logger } from '../logger';
import { notify } from '../notify';
import { calculatePlan } from './plan';
import { IScope, GitHubIssuePayload } from '../types';
import { VariableParser } from '../core/variables';
import { refreshState } from './refresh';
import { askApproval } from '../core/prompt';
import { elapsedSeconds, formatResourceAddress } from '../core/utils';
import { createCommandContext, CommandContext } from '../core/command-context';
import { GitHubAdapter } from '../adapters/github';
import { writeStatusToFeatureFiles } from '../core/feature-writer';

export interface ApplyCmdOptions {
    dir?: string;
    autoApprove?: boolean;
    verbose?: boolean;
    scope: IScope;
    planFile?: string;
    lock?: boolean;
    lockTimeout?: string;
    input?: boolean;
    variables?: VariableParser;
    statePath?: string;
    backupPath?: string;
    target?: string;
    refresh?: boolean;
    refreshOnly?: boolean;
    setStatus?: string;
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
        setStatus,
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
        let plan: import('../types').PlanResult;

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
            // Only allow status modifications when applying the current configuration (no plan file)
            if (setStatus && scope === 'testrun') {
                writeStatusToFeatureFiles(dir, scope, setStatus);
            }

            if (refresh && !refreshOnly) {
                console.log('Acquiring state lock. This may take a few moments...');
                await refreshState({ dir, scope, state: stateObj, logger, silent: false, parallelismRaw: parallelism, target });
            }

            // Calculate plan (read-only)
            plan = await calculatePlan({
                dir, scope, variables, statePath, backupPath, target, destroyPlan: false, refreshOnly, preLoadedState: stateObj, lock, lockTimeout, replaceTargets, compactWarnings, testDirectory
            });

            // Show plan summary
            resource.summary(plan.changes, false, { state: plan.state });

            if (!plan.hasChanges) {
                return;
            }

            // Ask for approval
            if (!autoApprove) {
                if (!input) {
                    const error = new Error('This command requires manual approval, but input is disabled. Use the\n-auto-approve flag to bypass approval.');
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
                        r.identity.endsWith(tr)
                    );
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
            if (change.resourceType !== 'github_testrun' || !change.scenario.custom?.groupScenarios) return {};

            const testcaseCommentIds: Record<string, number> = existingAttributes?.testcaseCommentIds || {};
            const testcaseStatuses: Record<string, string> = existingAttributes?.testcaseStatuses || {};

            let i = 1;
            for (const tcScenario of change.scenario.custom.groupScenarios) {
                if (!tcScenario.rule || !tcScenario.name) continue;

                const tcIdentity = `${tcScenario.rule.name}::${tcScenario.name}`;
                const localStatus = tcScenario.custom?.fields?.status || 'pending';
                const tcTitle = tcScenario.name;

                if (!testcaseCommentIds[tcIdentity] || testcaseStatuses[tcIdentity] !== localStatus) {
                    const commentBody = `| # | Test Case | Status |\n|---|-----------|--------|\n| ${i} | ${tcTitle} | ${localStatus} |`;

                    if (testcaseCommentIds[tcIdentity]) {
                        await github.updateIssueComment(testcaseCommentIds[tcIdentity], commentBody);
                        console.log(`  -> Updated status comment for ${tcIdentity} to '${localStatus}'`);
                    } else {
                        const result = await github.createIssueComment(issueNumber, commentBody);
                        testcaseCommentIds[tcIdentity] = result.id;
                        console.log(`  -> Created status comment for ${tcIdentity} as '${localStatus}'`);
                    }

                    testcaseStatuses[tcIdentity] = localStatus;
                }
                i++;
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
                        const address = formatResourceAddress(change.resourceType, change.identity);
                        console.log(`${address}: Creating...`);
                        const startTime = Date.now();

                        const payload = resource.evaluate(change.resourceType, change.scenario, { state: stateObj }) as unknown as GitHubIssuePayload;
                        await resolvePayloadMilestone(payload);
                        const result = await github.createIssue(payload);

                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && change.scenario?.custom?.fields) {
                                await github.updateProjectItemFields(itemId, change.scenario.custom.fields);
                            }
                        }

                        const elapsed = elapsedSeconds(startTime);
                        const remoteId = github.formatRemoteId(result.number);
                        console.log(green(`${address}: Creation complete after ${elapsed}s [id=${remoteId}]`));

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
                        const payload = resource.evaluate(change.resourceType, change.scenario, { state: stateObj }) as unknown as GitHubIssuePayload;
                        await resolvePayloadMilestone(payload);
                        const result = await github.createIssue(payload);

                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && change.scenario?.custom?.fields) {
                                await github.updateProjectItemFields(itemId, change.scenario.custom.fields);
                            }
                        }

                        const elapsed = elapsedSeconds(startTime);
                        const newRemoteId = github.formatRemoteId(result.number);
                        console.log(green(`${address}: Replacement complete after ${elapsed}s [id=${newRemoteId}]`));

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

                        const payload = resource.evaluate(change.resourceType, change.scenario, { state: stateObj }) as unknown as GitHubIssuePayload;
                        await resolvePayloadMilestone(payload);
                        const result = await github.updateIssue(change.issueNumber!, payload);

                        if (result.node_id) {
                            const itemId = await github.addToProject(result.node_id);
                            if (itemId && change.scenario?.custom?.fields) {
                                await github.updateProjectItemFields(itemId, change.scenario.custom.fields);
                            }
                        }

                        // Sub-issues linking removed: testcases are now embedded in the testrun body.

                        const elapsed = elapsedSeconds(startTime);
                        console.log(green(`${address}: Modifications complete after ${elapsed}s [id=${remoteId}]`));

                        // Link sub-issues
                        await linkSubIssues(change, result.number);

                        // Sync status comments
                        const existingAttributes = stateObj.getResources(change.resourceType).find((r: any) => r.identity === change.identity)?.attributes;
                        const { testcaseCommentIds, testcaseStatuses } = await syncTestrunComments(change, result.number, existingAttributes);

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
