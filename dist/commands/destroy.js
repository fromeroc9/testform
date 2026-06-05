"use strict";
/**
 * @fileoverview `testform destroy` command.
 *
 * Destroys all resources currently tracked in the state by closing their
 * corresponding GitHub issues. Requires explicit user confirmation unless
 * `-auto-approve` is passed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.destroyCmd = void 0;
const chalk_1 = require("chalk");
const state_1 = require("../core/state");
const logger_1 = require("../logger");
const notify_1 = require("../notify");
const const_1 = require("../const");
const command_context_1 = require("../core/command-context");
const prompt_1 = require("../core/prompt");
const utils_1 = require("../core/utils");
const destroyCmd = async (options) => {
    const { dir = '.', verbose = false, scope, lock = true, lockTimeout = '0s', input = true, statePath, backupPath } = options;
    const logger = new logger_1.Logger(verbose);
    const stateObj = new state_1.State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);
    try {
        if (!Object.prototype.hasOwnProperty.call(const_1.SCOPE_RESOURCE_MAP, scope)) {
            throw new Error(`Invalid scope: ${scope}`);
        }
        const resources = stateObj.getResources(const_1.SCOPE_RESOURCE_MAP[scope]);
        if (resources.length === 0) {
            console.log('No resources to destroy. State is empty.');
            return;
        }
        console.log((0, chalk_1.bold)(`\n${const_1.TITLE_APP} will destroy the following resources:\n`));
        for (const res of resources) {
            const remoteId = res.attributes.remoteId ?? '';
            console.log(`  ${(0, chalk_1.red)('-')} ${(0, utils_1.formatResourceAddress)(res.type, res.identity)} [id=${remoteId}]`);
        }
        console.log(`\n${(0, chalk_1.bold)('Plan:')} 0 to add, 0 to change, ${resources.length} to destroy.\n`);
        // Require interactive approval unless disabled
        if (!input) {
            const error = new Error('This command requires manual approval, but input is disabled. Use the\n-auto-approve flag to bypass approval.');
            error.name = 'No input allowed';
            throw error;
        }
        const approved = await (0, prompt_1.askDestroyApproval)(resources.length);
        if (!approved) {
            notify_1.notify.push({ type: 'error', title: 'error asking for approval: interrupted', detail: [] });
            return;
        }
        // Create GitHub context AFTER approval to avoid locking for nothing if user declines
        const ctx = await (0, command_context_1.createCommandContext)({ dir, verbose, statePath, backupPath, lock: false, silent: false });
        if (!ctx)
            return;
        let destroyed = 0;
        for (const res of resources) {
            try {
                const remoteId = res.attributes.remoteId ?? '';
                const address = (0, utils_1.formatResourceAddress)(res.type, res.identity);
                console.log(`${address}: Destroying... [id=${remoteId}]`);
                const startTime = Date.now();
                if (res.attributes.issueNumber) {
                    await ctx.github.closeIssue(res.attributes.issueNumber);
                }
                console.log((0, chalk_1.green)(`${address}: Destruction complete after ${(0, utils_1.elapsedSeconds)(startTime)}s [id=${remoteId}]`));
                stateObj.removeResource(res.identity);
                destroyed++;
            }
            catch (error) {
                notify_1.notify.push({
                    type: 'error',
                    title: error.message,
                    detail: [`  with ${(0, utils_1.formatResourceAddress)(res.type, res.identity)}`],
                });
            }
        }
        await stateObj.save();
        console.log('');
        console.log((0, chalk_1.green)((0, chalk_1.bold)(`Destroy complete! Resources: ${destroyed} destroyed.`)));
    }
    finally {
        await stateObj.releaseLock();
    }
};
exports.destroyCmd = destroyCmd;
