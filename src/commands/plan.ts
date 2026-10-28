import { createHash } from 'crypto';
import { MSG_ACQUIRING_LOCK } from '../core/const';
import { bold } from 'chalk';
import { resource } from '../core/resources';
import { Config } from '../core/config';
import { Parser } from '../core/parser';
import { policy } from '../core/policy';
import { State } from '../core/state';
import { Logger, logger as notify } from '../core/logger';
import { writeFileSync } from 'fs';
import { IScope, PlanChange, PlanResult, ParserScenario } from '../core/types';
import { VariableParser } from '../core/variables';
import { refreshState } from './refresh';
import { SCOPE_CONFIG, VERSION_CLI } from '../core/const';
import { formatResourceAddress, normalizeAddress } from '../core/utils';
import { join } from 'path';
import { matchesScope, matchesTarget } from '../core/selector';
import { resolveScopes } from '../core/cli';
import { LifecycleResolver } from '../core/lifecycle';

/**
 * Calculate the hash for a scenario (used for idempotency).
 */
export function hashScenario(scenario: ParserScenario, scope?: IScope, ignoreChanges: string[] = []): string {
    const clone: ParserScenario = JSON.parse(JSON.stringify(scenario));
    const ignored = new Set(ignoreChanges.map(s => s.toLowerCase()));

    // Testcases depend on uri and tags, NEVER on the Scenario title
    if (!scope || scope === 'testcase' || ignored.has('title') || ignored.has('name')) {
        clone.name = '';
    }
    // Testruns and Testplans depend on uri and tags, NEVER on the Feature title
    if (!scope || scope === 'testrun' || scope === 'testplan' || ignored.has('title') || ignored.has('name')) {
        if (clone.feature) {
            clone.feature.name = '';
        }
    }

    if (ignored.has('tags') || ignored.has('labels')) {
        clone.tags = [];
        if (clone.feature) {
            clone.feature.tags = [];
        }
    }

    if (ignored.has('steps') || ignored.has('body')) {
        clone.steps = [];
    }

    if (ignored.has('custom_fields') && clone.custom) {
        delete (clone.custom as any).fields;
    }

    return createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

interface CalculatePlanOptions {
    dir: string;
    scope: IScope;
    variables?: VariableParser;
    statePath?: string;
    backupPath?: string;
    target?: string | string[];
    destroyPlan?: boolean;
    refreshOnly?: boolean;
    preLoadedState?: State;
    lock?: boolean;
    lockTimeout?: string;
    replaceTargets?: string | string[];
    compactWarnings?: boolean;
    testDirectory?: string;
}

/**
 * Calculate a plan by comparing local .feature files against the state.
 * This is a PURE READ-ONLY operation — state is never modified.
 */
export async function calculatePlan(options: CalculatePlanOptions): Promise<PlanResult> {
    const {
        dir,
        scope,
        variables,
        statePath,
        backupPath,
        target,
        destroyPlan = false,
        refreshOnly = false,
        preLoadedState,
        lock = true,
        lockTimeout = '0s',
        replaceTargets,
        compactWarnings,
        testDirectory
    } = options;
    const config = new Config(dir);

    if (!Object.prototype.hasOwnProperty.call(SCOPE_CONFIG, scope)) {
        throw new Error(`Invalid scope: ${scope}`);
    }
    const scopeCfg = SCOPE_CONFIG[scope as keyof typeof SCOPE_CONFIG];
    const RESOURCE_TYPE = scopeCfg.resource;

    const parseDir = testDirectory ? join(dir, testDirectory) : dir;
    const parser = new Parser(parseDir, variables);
    const documents = parser.content();

    // Only process scenarios that match the requested scope
    const matchPattern = config.getMatch?.(scope);
    let rawScenarios = documents.filter(s => matchesScope(s, scope, matchPattern));

    const data = {
        identity: config.getIdentity(scope),
        fields: config.getFields(scope),
    };

    let filtered = parser.filter(rawScenarios, data, scope) || [];

    if (target) {
        filtered = filtered.filter(s => {
            const id = s.custom?.identity ? `${s.uri}.${s.custom.identity}` : s.uri;
            return matchesTarget(id, target, scope) || matchesTarget(s.uri, target, scope);
        });
    }

    if (destroyPlan) {
        // If destroy, we treat local scenarios as empty
        // to force destruction of everything.
        filtered = [];
    }


    // If refresh-only, policy scanning might not be relevant for empty local state, but we already filtered it.
    if (policy && typeof policy.loadCustomPolicies === 'function') {
        await policy.loadCustomPolicies(dir);
    }
    const policiesConfig = (config && typeof config.getPolicies === 'function') ? config.getPolicies() : undefined;
    if (policiesConfig && policy && typeof policy.configure === 'function') {
        policy.configure(policiesConfig);
    }
    const hasViolations = policy.scanner(filtered, scope, false, compactWarnings);
    if (hasViolations) {
        const err = new Error("Please fix them before continuing.");
        err.name = "Policy violations found";
        throw err;
    }

    // Load state (read-only)
    const state = preLoadedState || new State(dir, statePath, backupPath);
    if (!preLoadedState) {
        await state.init();
        await state.acquireLock(lock, lockTimeout);
    }
    let resources = state.getResources(RESOURCE_TYPE);

    if (target) {
        resources = resources.filter(r => matchesTarget(r.identity, target, scope) || (r.type && matchesTarget(r.type, target, scope)));
    }

    if (refreshOnly) {
        return {
            changes: [],
            state,
            hasChanges: false,
        };
    }

    for (const res of resources) {
        // Display refreshing text
        const remoteIdPart = res.attributes.remoteId ? `[id=${res.attributes.remoteId}]` : '';
        console.log(bold(`${formatResourceAddress(res.type, res.identity)}: Refreshing state... ${remoteIdPart}`));
    }
    console.log("");

    // Build a lookup map for O(1) access by normalized identity
    const stateMap = new Map(resources.map(r => [normalizeAddress(r.identity), r]));

    // Track which identities exist locally
    const localIds = new Set<string>();

    const changes: PlanChange[] = [];
    const lifecycleResolver = new LifecycleResolver(dir);

    // Check for creates and updates
    for (const scenario of filtered) {
        let identity: string;

        const rawIdentity = scenario.custom?.identity;
        if (!rawIdentity) continue;
        
        if (rawIdentity.startsWith(scenario.uri) || rawIdentity === scenario.uri) {
            identity = rawIdentity;
        } else {
            identity = `${scenario.uri}.${rawIdentity}`;
        }

        const normId = normalizeAddress(identity);
        localIds.add(normId);
        const scenarioTags = scenario.tags ? scenario.tags.map(t => typeof t === 'string' ? t : (t as any).name) : [];
        const lc = lifecycleResolver.getLifecycle(identity, scenarioTags);
        const localHash = hashScenario(scenario, scope, lc.ignore_changes);
        const existing = stateMap.get(normId);

        const shouldForceReplace = replaceTargets ? matchesTarget(identity, replaceTargets) : false;

        if (!existing) {
            // New resource — needs to be created
            changes.push({
                action: 'add',
                identity,
                resourceType: RESOURCE_TYPE,
                scenario,
                localHash,
            });
        } else if (existing.tainted || shouldForceReplace) {
            // Tainted or forced replace resource — needs to be replaced
            changes.push({
                action: 'replace',
                identity,
                resourceType: RESOURCE_TYPE,
                scenario,
                remoteId: existing.attributes.remoteId,
                issueNumber: existing.attributes.issueNumber,
                localHash,
                oldAttributes: existing.attributes,
            });
        } else if (existing.attributes.localHash !== localHash) {

            // Changed resource — needs to be updated
            changes.push({
                action: 'change',
                identity,
                resourceType: RESOURCE_TYPE,
                scenario,
                remoteId: existing.attributes.remoteId,
                issueNumber: existing.attributes.issueNumber,
                localHash,
                oldAttributes: existing.attributes,
            });
        }
        // If hashes match → synced, no action needed
    }

    // Check for destroys (in state but not in local files)
    for (const res of resources) {
        if (!localIds.has(normalizeAddress(res.identity))) {
            const lc = lifecycleResolver.getLifecycle(res.identity, res.attributes.labels || []);
            if (lc.prevent_destroy) {
                notify.push({
                    type: 'error',
                    title: 'Instance cannot be destroyed',
                    detail: [
                        `Resource ${formatResourceAddress(res.type, res.identity)} has lifecycle.prevent_destroy set, but the plan calls for this resource to be destroyed. To avoid this error and continue with the plan, either disable lifecycle.prevent_destroy or target other resources.`
                    ],
                    close: true
                });
                throw new Error(`Instance cannot be destroyed: ${res.identity} has lifecycle.prevent_destroy set.`);
            }

            // Create a minimal scenario from state for display
            changes.push({
                action: 'destroy',
                identity: res.identity,
                resourceType: RESOURCE_TYPE,
                scenario: (scope === 'testrun' || scope === 'testplan') ? {
                    uri: '(state)',
                    feature: { tags: [], keyword: '', name: res.attributes.title, description: '', location: 0 },
                    location: 0,
                    keyword: '',
                    name: res.attributes.title,
                    description: '',
                    steps: [],
                    tags: Array.isArray(res.attributes.labels) ? res.attributes.labels : (res.attributes.labels ? String(res.attributes.labels).split(',') : []),
                    custom: { identity: res.identity },
                } : {
                    uri: '(state)',
                    feature: { tags: [], keyword: '', name: '', description: '', location: 0 },
                    location: 0,
                    keyword: '',
                    name: res.attributes.title,
                    description: '',
                    steps: [],
                    tags: Array.isArray(res.attributes.labels) ? res.attributes.labels : (res.attributes.labels ? String(res.attributes.labels).split(',') : []),
                    custom: { identity: res.identity },
                },
                remoteId: res.attributes.remoteId,
                issueNumber: res.attributes.issueNumber,
                localHash: res.attributes.localHash,
            });
        }
    }

    return { changes, hasChanges: changes.length > 0, state };
}

/**
 * Plan command: show changes required by current configuration.
 * Does NOT modify state — pure read-only.
 */
interface PlanCmdOptions {
    dir?: string;
    verbose?: boolean;
    scope?: IScope | 'all';
    outPath?: string;
    lock?: boolean;
    lockTimeout?: string;
    input?: boolean;
    variables?: VariableParser;
    isJson?: boolean;
    detailedExitCode?: boolean;
    statePath?: string;
    backupPath?: string;
    target?: string | string[];
    destroyPlan?: boolean;
    refresh?: boolean;
    refreshOnly?: boolean;
    replaceTargets?: string | string[];
    parallelism?: string | number;
    compactWarnings?: boolean;
    testDirectory?: string;
}

export const planCmd = async (options: PlanCmdOptions) => {
    const {
        dir = '.',
        verbose = false,
        scope,
        outPath,
        lock = true,
        lockTimeout = '0s',
        input = true,
        variables,
        isJson = false,
        detailedExitCode = false,
        statePath,
        backupPath,
        target,
        destroyPlan = false,
        refresh = true,
        refreshOnly = false,
        replaceTargets,
        parallelism,
        compactWarnings = false,
        testDirectory
    } = options;
    const logger = new Logger(verbose);

    // Interactive prompt for required missing variables if -input=true
    if (variables) {
        const missingVars = variables.getMissingRequiredVars();
        if (missingVars.length > 0) {
            if (!input || !process.stdin.isTTY) {
                logger.push({
                    type: 'error',
                    title: 'No value for required variable',
                    detail: missingVars.map(v => `The root module input variable "${v.name}" is not set, and has no default value. Use -var or -var-file to supply a value.`),
                    close: true
                });
                return;
            }

            const readline = require('readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, (ans: string) => res(ans.trim())));

            for (const v of missingVars) {
                console.log(`var.${v.name}`);
                if (v.description) {
                    console.log(`  ${v.description}`);
                }
                console.log('');
                const val = await ask('  Enter a value: ');
                console.log('');
                variables.setVar(v.name, val);
            }
            rl.close();
        }
    }

    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);

    let plan: PlanResult = { changes: [], hasChanges: false, state: stateObj };
    try {
        const scopesToRun = resolveScopes(scope, target);
        
        if (refresh && !destroyPlan) {
            if (!isJson) console.log(MSG_ACQUIRING_LOCK);
            // We can just run refreshState once if we modify it to support 'all' or we loop here.
            // But wait, refreshState requires IScope. Let's loop.
        }

        let allChanges: PlanChange[] = [];

        for (const s of scopesToRun) {
            if (refresh && !destroyPlan) {
                await refreshState({ dir, scope: s, state: stateObj, logger, silent: isJson, parallelismRaw: parallelism, target });
            }

            const sPlan = await calculatePlan({
                dir, scope: s, variables, statePath, backupPath, target, destroyPlan, refreshOnly, preLoadedState: stateObj, lock, lockTimeout, replaceTargets, compactWarnings, testDirectory
            });
            
            allChanges.push(...sPlan.changes);
            plan.state = sPlan.state;
        }
        
        plan.changes = allChanges;
        plan.hasChanges = allChanges.length > 0;

        if (isJson) {
            const planData = {
                format_version: '1.0',
                testform_version: VERSION_CLI,
                scope: scope,
                changes: plan.changes
            };
            console.log(JSON.stringify(planData, null, 2));
        } else {
            resource.summary(plan.changes, true, { state: plan.state, outPath });
        }
    } finally {
        await stateObj.releaseLock();
    }

    if (outPath) {
        const path = require('path');
        const resolvedOutPath = path.resolve(dir, outPath);
        const planData = {
            format_version: '1.0',
            testform_version: VERSION_CLI,
            scope: scope,
            changes: plan.changes
        };
        try {
            writeFileSync(resolvedOutPath, JSON.stringify(planData, null, 2), 'utf-8');
            console.log(`\nSaved the plan to: ${outPath}\n\nTo perform exactly these actions, run the following command to apply:\n    testform apply "${outPath}"`);
        } catch (e: any) {
            logger.error(`Failed to write plan to ${resolvedOutPath}: ${e.message}`);
        }
    }

    if (detailedExitCode) {
        process.exitCode = plan.hasChanges ? 2 : 0;
    }

    return plan;
}
