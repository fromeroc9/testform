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
import { OutputResolver } from '../core/outputs';
import { refreshState } from './refresh';
import { askApproval } from '../core/prompt';
import { formatResourceAddress, elapsedSeconds } from '../core/utils';
import { createCommandContext } from '../core/context';
import { executeInBatches } from '../core/sync';
import { resolveScopes, assertApprovalAllowed } from '../core/cli';
import { DependencyResolver } from '../core/dependencies';

interface ApplyCmdOptions {
    dir?: string;
    autoApprove?: boolean;
    verbose?: boolean;
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
    gherkin?: boolean;
}

export const applyCmd = async (options: ApplyCmdOptions) => {
    const {
        dir = '.',
        autoApprove = false,
        verbose = false,
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
        testDirectory,
        gherkin = false
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

            const effectiveTarget = target || (options as any).scope;
        const realTarget = effectiveTarget || (options as any).scope;
    const scopesToRun = resolveScopes(realTarget);
            let allChanges: any[] = [];
            let finalState = stateObj;

            if (refresh && !refreshOnly) {
                console.log(MSG_ACQUIRING_LOCK);
            }

            for (const s of scopesToRun) {
                if (refresh && !refreshOnly) {
                    await refreshState({ dir, scope: s, state: stateObj, logger, silent: false, isImplicit: true, parallelismRaw: parallelism, target });
                }

                // Calculate plan (read-only)
                const sPlan = await calculatePlan({
                    dir, scope: s, variables, statePath, backupPath, target, destroyPlan: false, refreshOnly, preLoadedState: stateObj, lock, lockTimeout, replaceTargets, compactWarnings, testDirectory
                });

                allChanges.push(...sPlan.changes);
                finalState = sPlan.state;
            }

            if (refresh && !refreshOnly) {
                console.log('');
            }

            plan = { changes: allChanges, hasChanges: allChanges.length > 0, state: finalState };

            // Show plan summary
            resource.summary(plan.changes, false, { state: plan.state, gherkin });

            if (!plan.hasChanges) {
                await stateObj.save();
                return;
            }

            // Ask for approval
            if (!autoApprove) {
                assertApprovalAllowed(autoApprove, input);
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
        const github = (ctx.adapter || (ctx as any).github);

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
            if (change.resourceType.endsWith('testplan') && change.scenario.custom?.testruns) {
                for (const tr of change.scenario.custom.testruns) {
                    const runResources = stateObj.getResources('testrun').filter(r =>
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
                                    if (github.addSubIssue) await github.addSubIssue(parentIssueNumber, issueDetails.id);
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

        // Execute changes in parallel batches with topological dependency ordering
        const parallelismNum = parallelism ? parseInt(String(parallelism), 10) || 1 : 1;
        const depResolver = new DependencyResolver(dir);
        let orderedChanges = plan.changes;

        try {
            orderedChanges = depResolver.sortTopologically(
                plan.changes,
                (c) => c.identity,
                (c) => c.scenario?.tags ? c.scenario.tags.map(t => typeof t === 'string' ? t : (t as any).name) : []
            );
        } catch (err: any) {
            notify.push({
                type: 'error',
                title: 'Circular dependency detected',
                detail: [err.message],
                close: true
            });
            throw err;
        }

        // Helper to execute API and state payload dispatch
        const applyApiPayload = async (change: any, existingIssueNumber?: number) => {
            const apiPayload = resource.evaluateApi(change.resourceType, change.scenario, { state: stateObj, testDirectory });
            const statePayload = resource.evaluateState(change.resourceType, change.scenario, { state: stateObj, testDirectory });

            const issueData = apiPayload.issue || apiPayload;
            const projectData = apiPayload.project?.fields ? { custom_fields: apiPayload.project.fields } : (apiPayload.custom_fields ? { custom_fields: apiPayload.custom_fields } : {});

            await resolvePayloadMilestone(issueData);

            let result: any;
            if (github.apis) {
                // Find matching service key in provider.apis:
                // 1. Exact match with resourceType (e.g. apis.defect or apis.testcase)
                // 2. Or matching key present in apiPayload (e.g. apiPayload.pokemon -> apis.pokemon)
                // 3. Fallback to 'issue' or the first exposed api service
                const serviceKey = Object.keys(github.apis).find(k => k === change.resourceType || apiPayload[k]) 
                    || (github.apis.issue ? 'issue' : Object.keys(github.apis)[0]);
                const service = serviceKey ? github.apis[serviceKey] : undefined;
                const dataToPass = (serviceKey && apiPayload[serviceKey]) ? apiPayload[serviceKey] : issueData;

                if (service) {
                    if (existingIssueNumber && service.update) {
                        result = await service.update(existingIssueNumber, dataToPass);
                    } else if (service.create) {
                        result = await service.create(dataToPass);
                    }
                }

                if (github.apis.project?.create && apiPayload.project) {
                    await github.apis.project.create(apiPayload.project, { issueResult: result });
                }
            } else {
                if (existingIssueNumber) {
                    result = await github.updateIssue(existingIssueNumber, issueData);
                } else {
                    result = await github.createIssue(issueData);
                }
                if (result?.node_id && github.addToProject && projectData.custom_fields) {
                    const itemId = await github.addToProject(result.node_id);
                    if (itemId && github.updateProjectItemFields) {
                        await github.updateProjectItemFields(itemId, projectData.custom_fields);
                    }
                }
            }

            if (!result) {
                result = { id: existingIssueNumber || 1, number: existingIssueNumber || 1 };
            }

            return { result, issueData, projectData, statePayload };
        };

        await executeInBatches(orderedChanges, parallelismNum, async (change) => {
            try {
                    if (change.action === 'add') {
                        const address = formatResourceAddress(change.resourceType, change.identity);
                        console.log(`${address}: Creating...`);
                        const startTime = Date.now();

                        const { result, issueData, projectData, statePayload } = await applyApiPayload(change);

                        const elapsed = elapsedSeconds(startTime);
                        const numOrId = result.number ?? result.id ?? 1;
                        const remoteId = github.formatRemoteId ? github.formatRemoteId(numOrId) : String(numOrId);
                        console.log(green(`${address}: Creation complete after ${elapsed}s [id=${remoteId}]`));

                        // Link sub-issues
                        await linkSubIssues(change, numOrId);

                        // Update state
                        stateObj.upsertResource({
                            type: change.resourceType,
                            identity: change.identity,
                            attributes: {
                                localHash: change.localHash,
                                remoteId,
                                issueNumber: numOrId,
                                title: issueData.title,
                                body: issueData.body,
                                labels: issueData.labels,
                                assignees: issueData.assignees,
                                milestone: issueData.milestone || undefined,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...projectData,
                                ...statePayload,
                            },
                            lastApplied: new Date().toISOString(),
                        });

                        added++;

                    } else if (change.action === 'replace') {
                        const address = formatResourceAddress(change.resourceType, change.identity);
                        const remoteId = change.remoteId ?? '';
                        console.log(`${address}: Replacing... [id=${remoteId}]`);
                        const startTime = Date.now();

                        // 1. Destroy (close issue or delete from agnostic api)
                        if (change.issueNumber) {
                            if (github.apis) {
                                const svcKey = Object.keys(github.apis).find(k => k === change.resourceType || k === 'issue');
                                if (svcKey && github.apis[svcKey]?.delete) {
                                    await github.apis[svcKey].delete(change.issueNumber);
                                } else if (github.updateIssue) {
                                    await github.updateIssue(change.issueNumber, { state: 'closed' });
                                }
                            } else if (github.updateIssue) {
                                await github.updateIssue(change.issueNumber, { state: 'closed' });
                            }
                        }

                        // 2. Add (create new issue or agnostic resource)
                        const { result, issueData, projectData, statePayload } = await applyApiPayload(change);

                        const elapsed = elapsedSeconds(startTime);
                        const numOrId = result.number ?? result.id ?? 1;
                        const newRemoteId = github.formatRemoteId ? github.formatRemoteId(numOrId) : String(numOrId);
                        console.log(green(`${address}: Replacement complete after ${elapsed}s [id=${newRemoteId}]`));

                        // Link sub-issues
                        await linkSubIssues(change, numOrId);

                        // 3. Update state
                        stateObj.upsertResource({
                            type: change.resourceType,
                            identity: change.identity,
                            attributes: {
                                localHash: change.localHash,
                                remoteId: newRemoteId,
                                issueNumber: numOrId,
                                title: issueData.title,
                                body: issueData.body,
                                labels: issueData.labels,
                                assignees: issueData.assignees,
                                milestone: issueData.milestone || undefined,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...projectData,
                                ...statePayload,
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

                        const { result, issueData, projectData, statePayload } = await applyApiPayload(change, change.issueNumber);

                        const elapsed = elapsedSeconds(startTime);
                        const numOrId = result.number ?? result.id ?? change.issueNumber;
                        console.log(green(`${address}: Modifications complete after ${elapsed}s [id=${remoteId}]`));

                        // Link sub-issues
                        await linkSubIssues(change, numOrId);

                        // Update state
                        stateObj.upsertResource({
                            type: change.resourceType,
                            identity: change.identity,
                            attributes: {
                                localHash: change.localHash,
                                remoteId,
                                issueNumber: change.issueNumber!,
                                title: issueData.title,
                                body: issueData.body,
                                labels: issueData.labels,
                                assignees: issueData.assignees,
                                milestone: issueData.milestone || undefined,
                                createdAt: result.created_at,
                                updatedAt: result.updated_at,
                                ...projectData,
                                ...statePayload,
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
        });

        // Save state once after all operations
        // Final empty line for better UX
        console.log("");
        await stateObj.save();

        console.log(green(bold(`Apply complete! Resources: ${added} added, ${changed} changed, ${destroyed} destroyed.`)));

        // Evaluate and save outputs
        const outputResolver = new OutputResolver(dir);
        const resolvedOutputs = outputResolver.resolve(stateObj, variables);
        if (Object.keys(resolvedOutputs).length > 0) {
            stateObj.setOutputs(resolvedOutputs);
            await stateObj.save();
            console.log("\n" + bold("Outputs:\n"));
            console.log(outputResolver.format(resolvedOutputs));
        }
    } finally {
        await stateObj.releaseLock();
    }
}
