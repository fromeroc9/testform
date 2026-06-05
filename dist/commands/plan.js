"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planCmd = void 0;
exports.hashScenario = hashScenario;
exports.calculatePlan = calculatePlan;
const crypto_1 = require("crypto");
const const_1 = require("../const");
const chalk_1 = require("chalk");
const resources_1 = require("../adapters/resources");
const config_1 = require("../core/config");
const parser_1 = require("../core/parser");
const policy_1 = require("../core/policy");
const state_1 = require("../core/state");
const logger_1 = require("../logger");
const fs_1 = require("fs");
const refresh_1 = require("./refresh");
const const_2 = require("../const");
const utils_1 = require("../core/utils");
const path_1 = require("path");
/**
 * Calculate the hash for a scenario (used for idempotency).
 */
function hashScenario(scenario) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(scenario)).digest('hex');
}
/**
 * Calculate a plan by comparing local .feature files against the state.
 * This is a PURE READ-ONLY operation — state is never modified.
 */
async function calculatePlan(options) {
    const { dir, scope, variables, statePath, backupPath, target, destroyPlan = false, refreshOnly = false, preLoadedState, lock = true, lockTimeout = '0s', replaceTargets, compactWarnings, testDirectory } = options;
    const config = new config_1.Config(dir);
    if (!Object.prototype.hasOwnProperty.call(const_2.SCOPE_CONFIG, scope)) {
        throw new Error(`Invalid scope: ${scope}`);
    }
    const scopeCfg = const_2.SCOPE_CONFIG[scope];
    const RESOURCE_TYPE = scopeCfg.resource;
    const parseDir = testDirectory ? (0, path_1.join)(dir, testDirectory) : dir;
    const parser = new parser_1.Parser(parseDir, variables);
    const documents = parser.content();
    const matchesScope = (s, scopeName) => {
        if (!Object.prototype.hasOwnProperty.call(const_2.SCOPE_CONFIG, scopeName))
            return false;
        const cfg = const_2.SCOPE_CONFIG[scopeName];
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
        filtered = filtered.filter(s => {
            const id = s.custom?.identity ? `${s.uri}::${s.custom.identity}` : '';
            return id === target || id.startsWith(`${target}::`) || id.endsWith(`/${target}`) || id.endsWith(target);
        });
    }
    if (destroyPlan) {
        // If destroy, we treat local scenarios as empty
        // to force destruction of everything.
        filtered = [];
    }
    // If refresh-only, policy scanning might not be relevant for empty local state, but we already filtered it.
    const hasViolations = policy_1.policy.scanner(filtered, scope, false, compactWarnings);
    if (hasViolations) {
        const err = new Error("Please fix them before continuing.");
        err.name = "Policy violations found";
        throw err;
    }
    // Load state (read-only)
    const state = preLoadedState || new state_1.State(dir, statePath, backupPath);
    if (!preLoadedState) {
        await state.init();
        await state.acquireLock(lock, lockTimeout);
    }
    let resources = state.getResources(RESOURCE_TYPE);
    if (target) {
        resources = resources.filter(r => r.identity === target || r.identity.startsWith(`${target}::`) || r.identity.endsWith(`/${target}`) || r.identity.endsWith(target));
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
        console.log((0, chalk_1.bold)(`${(0, utils_1.formatResourceAddress)(res.type, res.identity)}: Refreshing state... ${remoteIdPart}`));
    }
    console.log("");
    // Build a lookup map for O(1) access by identity
    const stateMap = new Map(resources.map(r => [r.identity, r]));
    // Track which identities exist locally
    const localIds = new Set();
    const changes = [];
    // Check for creates and updates
    for (const scenario of filtered) {
        let identity;
        const rawIdentity = scenario.custom?.identity;
        if (!rawIdentity)
            continue;
        if (rawIdentity.includes('::')) {
            identity = rawIdentity;
        }
        else if (rawIdentity === scenario.uri) {
            identity = rawIdentity;
        }
        else {
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
        }
        else if (existing.tainted || shouldForceReplace) {
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
        }
        else if (existing.attributes.localHash !== localHash) {
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
const planCmd = async (options) => {
    const { dir = '.', verbose = false, scope, outPath, lock = true, lockTimeout = '0s', variables, isJson = false, detailedExitCode = false, statePath, backupPath, target, destroyPlan = false, refresh = true, refreshOnly = false, replaceTargets, parallelism, compactWarnings = false, testDirectory } = options;
    const logger = new logger_1.Logger(verbose);
    const stateObj = new state_1.State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);
    let plan;
    try {
        if (refresh && !destroyPlan) {
            if (!isJson)
                console.log(const_1.MSG_ACQUIRING_LOCK);
            await (0, refresh_1.refreshState)({ dir, scope, state: stateObj, logger, silent: isJson, parallelismRaw: parallelism, target });
        }
        plan = await calculatePlan({
            dir, scope, variables, statePath, backupPath, target, destroyPlan, refreshOnly, preLoadedState: stateObj, lock, lockTimeout, replaceTargets, compactWarnings, testDirectory
        });
        if (isJson) {
            const planData = {
                testform_version: const_2.VERSION_CLI,
                scope: scope,
                changes: plan.changes
            };
            console.log(JSON.stringify(planData, null, 2));
        }
        else {
            resources_1.resource.summary(plan.changes, true, { state: plan.state, outPath });
        }
    }
    finally {
        await stateObj.releaseLock();
    }
    if (outPath) {
        const path = require('path');
        const resolvedOutPath = path.resolve(dir, outPath);
        const planData = {
            testform_version: const_2.VERSION_CLI,
            scope: scope,
            changes: plan.changes
        };
        try {
            (0, fs_1.writeFileSync)(resolvedOutPath, JSON.stringify(planData, null, 2), 'utf-8');
            console.log(`\nSaved the plan to: ${outPath}\n\nTo perform exactly these actions, run the following command to apply:\n    testform apply "${outPath}"`);
        }
        catch (e) {
            logger.error(`Failed to write plan to ${resolvedOutPath}: ${e.message}`);
        }
    }
    if (detailedExitCode) {
        process.exitCode = plan.hasChanges ? 2 : 0;
    }
    return plan;
};
exports.planCmd = planCmd;
