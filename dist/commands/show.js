"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.showCmd = void 0;
const chalk_1 = require("chalk");
const state_1 = require("../core/state");
const logger_1 = require("../logger");
const const_1 = require("../const");
const path_1 = __importDefault(require("path"));
const showCmd = async (options = {}) => {
    const { path, isJson = false, verbose = false, dir = '.', statePath, backupPath } = options;
    const logger = new logger_1.Logger(verbose);
    // If path is "state" or "plan" (legacy support)
    let actualPath = path;
    if (path === 'state')
        actualPath = undefined;
    if (path === 'plan') {
        logger.info(`Use "${const_1.TITLE_CLI} plan" to generate and view an execution plan.`);
        return;
    }
    const state = new state_1.State(dir, actualPath || statePath, backupPath);
    await state.init();
    const current = state.getState();
    const resources = current.resources;
    if (isJson) {
        console.log(JSON.stringify(current, null, 2));
        return;
    }
    console.log('');
    console.log((0, chalk_1.bold)(`# ${const_1.TITLE_APP} State`));
    console.log(`  Version:    ${current.version}`);
    console.log(`  Serial:     ${current.serial}`);
    console.log(`  Lineage:    ${current.lineage}`);
    console.log(`  Last Sync:  ${current.lastSync || '(never)'}`);
    console.log(`  Resources:  ${resources.length}`);
    console.log('');
    if (resources.length > 0) {
        for (const res of resources) {
            const remoteId = res.attributes.remoteId ?? '(unknown)';
            const status = res.attributes.issueNumber ? (0, chalk_1.green)('synced') : (0, chalk_1.yellow)('pending');
            let formattedIdentity = res.identity;
            if (formattedIdentity.includes('::')) {
                const parts = formattedIdentity.split('::');
                const base = path_1.default.basename(parts[0], '.feature');
                formattedIdentity = `${base}::${parts.slice(1).join('::')}`;
            }
            else {
                formattedIdentity = path_1.default.basename(formattedIdentity, '.feature');
            }
            console.log(`  ${(0, chalk_1.cyan)(res.type)}.${(0, chalk_1.bold)(formattedIdentity)} [id=${remoteId}] ${status}`);
            console.log(`    title:        ${res.attributes.title}`);
            console.log(`    issueNumber:  ${res.attributes.issueNumber ?? '(none)'}`);
            console.log(`    localHash:    ${(0, chalk_1.dim)(res.attributes.localHash.substring(0, 12))}...`);
            console.log(`    lastApplied:  ${res.lastApplied}`);
            console.log('');
        }
    }
};
exports.showCmd = showCmd;
