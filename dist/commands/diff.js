"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffCmd = void 0;
const crypto_1 = require("crypto");
const chalk_1 = require("chalk");
const config_1 = require("../core/config");
const parser_1 = require("../core/parser");
const state_1 = require("../core/state");
const logger_1 = require("../logger");
const const_1 = require("../const");
function hashScenario(scenario) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(scenario)).digest('hex');
}
function getStatusIcon(status) {
    switch (status) {
        case 'synced': return (0, chalk_1.green)('✓');
        case 'modified_locally': return (0, chalk_1.yellow)('~');
        case 'new_local': return (0, chalk_1.cyan)('+');
        case 'orphaned_remote': return (0, chalk_1.red)('-');
    }
}
function getStatusLabel(status) {
    switch (status) {
        case 'synced': return 'synced';
        case 'modified_locally': return 'modified locally';
        case 'new_local': return 'new (not applied)';
        case 'orphaned_remote': return 'orphaned (not in config)';
    }
}
const diffCmd = async (options) => {
    const { dir = '.', verbose = false, scope } = options;
    const logger = new logger_1.Logger(verbose);
    // Load config and parse features
    const config = new config_1.Config(dir);
    const parser = new parser_1.Parser(dir);
    const documents = parser.content();
    const data = {
        identity: config.getIdentity(scope),
        fields: config.getFields(scope),
    };
    const filtered = parser.filter(documents, data, scope) || [];
    // Load state
    const state = new state_1.State(dir);
    await state.init();
    const resourceType = const_1.SCOPE_RESOURCE_MAP[scope];
    const resources = state.getResources(resourceType);
    const stateMap = new Map(resources.map(r => [r.identity, r]));
    // Calculate diff
    const entries = [];
    const localIds = new Set();
    for (const scenario of filtered) {
        const rawIdentity = scenario.custom?.identity;
        if (!rawIdentity)
            continue;
        let identity;
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
        const stateRes = stateMap.get(identity);
        if (!stateRes) {
            entries.push({ identity, status: 'new_local', localHash });
        }
        else if (stateRes.attributes.localHash !== localHash) {
            entries.push({
                identity,
                status: 'modified_locally',
                localHash,
                stateHash: stateRes.attributes.localHash,
                remoteId: stateRes.attributes.remoteId,
            });
        }
        else {
            entries.push({
                identity,
                status: 'synced',
                localHash,
                stateHash: stateRes.attributes.localHash,
                remoteId: stateRes.attributes.remoteId,
            });
        }
    }
    // Check for orphaned resources (in state but not in local)
    for (const res of resources) {
        if (!localIds.has(res.identity)) {
            entries.push({
                identity: res.identity,
                status: 'orphaned_remote',
                stateHash: res.attributes.localHash,
                remoteId: res.attributes.remoteId,
            });
        }
    }
    // Output
    console.log('');
    console.log((0, chalk_1.bold)('Drift Detection Report'));
    console.log('═'.repeat(60));
    console.log('');
    const synced = entries.filter(e => e.status === 'synced').length;
    const modified = entries.filter(e => e.status === 'modified_locally').length;
    const newLocal = entries.filter(e => e.status === 'new_local').length;
    const orphaned = entries.filter(e => e.status === 'orphaned_remote').length;
    for (const entry of entries) {
        const icon = getStatusIcon(entry.status);
        const label = getStatusLabel(entry.status);
        const remoteInfo = entry.remoteId ? (0, chalk_1.dim)(` [id=${entry.remoteId}]`) : '';
        console.log(`  ${icon} ${(0, chalk_1.bold)(entry.identity)}: ${label}${remoteInfo}`);
        if (verbose && entry.status === 'modified_locally' && entry.localHash && entry.stateHash) {
            console.log(`     Local:  ${(0, chalk_1.dim)(entry.localHash.substring(0, 12))}...`);
            console.log(`     State:  ${(0, chalk_1.dim)(entry.stateHash.substring(0, 12))}...`);
        }
    }
    console.log('');
    console.log((0, chalk_1.bold)('Summary:'));
    console.log(`  ${(0, chalk_1.green)('✓')} ${synced} synced`);
    if (modified > 0)
        console.log(`  ${(0, chalk_1.yellow)('~')} ${modified} modified locally`);
    if (newLocal > 0)
        console.log(`  ${(0, chalk_1.cyan)('+')} ${newLocal} new (not applied)`);
    if (orphaned > 0)
        console.log(`  ${(0, chalk_1.red)('-')} ${orphaned} orphaned (not in config)`);
    console.log('');
};
exports.diffCmd = diffCmd;
