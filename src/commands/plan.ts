import { createHash } from 'crypto';
import { MSG_ACQUIRING_LOCK } from '../const';
import { bold } from 'chalk';
import { resource } from '../adapters/resources';
import { Config } from '../core/config';
import { Parser } from '../core/parser';
import { policy } from '../core/policy';
import { State } from '../core/state';
import { Logger } from '../logger';
import { writeFileSync } from 'fs';
import { IScope, PlanChange, PlanResult, ParserScenario } from '../types';
import { VariableParser } from '../core/variables';
import { refreshState } from './refresh';
import { SCOPE_CONFIG, VERSION_CLI } from '../const';
import { formatResourceAddress } from '../core/utils';
import { join } from 'path';

/**
 * Calculate the hash for a scenario (used for idempotency).
 */
export function hashScenario(scenario: ParserScenario): string {
    return createHash('sha256').update(JSON.stringify(scenario)).digest('hex');
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

    const matchesScope = (s: any, scopeName: IScope) => {
        if (!Object.prototype.hasOwnProperty.call(SCOPE_CONFIG, scopeName)) return false;
        const cfg = SCOPE_CONFIG[scopeName as keyof typeof SCOPE_CONFIG];
        return s.feature?.tags?.includes(cfg.tag) || s.uri.endsWith(cfg.ext);
    };

    // Only process scenarios that match the requested scope
    let rawScenarios = documents.filter(s => matchesScope(s, scope));

    const data = {
        identity: config.getIdentity(scope),
        fields: config.getFields(scope),
    };

    let filtered = parser.filter(rawScenarios, data, scope) || [];

    if (target) {
        const targetArray = Array.isArray(target) ? target : [target];
        filtered = filtered.filter(s => {
            const id = s.custom?.identity ? `${s.uri}::${s.custom.identity}` : '';
            return targetArray.some(t => id === t || id.startsWith(`${t}::`) || id.endsWith(`/${t}`) || id.endsWith(t));
        });
    }

    if (destroyPlan) {
        // If destroy, we treat local scenarios as empty
        // to force destruction of everything.
        filtered = [];
    }


    // If refresh-only, policy scanning might not be relevant for empty local state, but we already filtered it.
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
        const targetArray = Array.isArray(target) ? target : [target];
        resources = resources.filter(r => targetArray.some(t => r.identity === t || r.identity.startsWith(`${t}::`) || r.identity.endsWith(`/${t}`) || r.identity.endsWith(t)));
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

    // Build a lookup map for O(1) access by identity
    const stateMap = new Map(resources.map(r => [r.identity, r]));

    // Track which identities exist locally
    const localIds = new Set<string>();

    const changes: PlanChange[] = [];

    // Check for creates and updates
    for (const scenario of filtered) {
        let identity: string;

        const rawIdentity = scenario.custom?.identity;
        if (!rawIdentity) continue;
        
        if (rawIdentity.includes('::')) {
            identity = rawIdentity;
        } else if (rawIdentity === scenario.uri) {
            identity = rawIdentity;
        } else {
            identity = `${scenario.uri}::${rawIdentity}`;
        }

        localIds.add(identity);
        const localHash = hashScenario(scenario);
        const existing = stateMap.get(identity);

        const shouldForceReplace = replaceTargets
            ? (Array.isArray(replaceTargets)
                ? replaceTargets.some(t => identity === t || identity.startsWith(`${t}::`) || identity.endsWith(`/${t}`) || identity.endsWith(t))
                : (identity === replaceTargets || identity.startsWith(`${replaceTargets}::`) || identity.endsWith(`/${replaceTargets}`) || identity.endsWith(replaceTargets)))
            : false;

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
        if (!localIds.has(res.identity)) {
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
                    tags: res.attributes.labels,
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
    scope: IScope;
    outPath?: string;
    lock?: boolean;
    lockTimeout?: string;
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
    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);

    let plan: PlanResult;
    try {
        if (refresh && !destroyPlan) {
            if (!isJson) console.log(MSG_ACQUIRING_LOCK);
            await refreshState({ dir, scope, state: stateObj, logger, silent: isJson, parallelismRaw: parallelism, target });
        }

        plan = await calculatePlan({
            dir, scope, variables, statePath, backupPath, target, destroyPlan, refreshOnly, preLoadedState: stateObj, lock, lockTimeout, replaceTargets, compactWarnings, testDirectory
        });

        if (isJson) {
            const planData = {
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
