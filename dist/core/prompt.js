"use strict";
/**
 * @fileoverview Interactive prompt utilities for CLI confirmation dialogs.
 *
 * Provides approval prompts used by `apply` and `destroy`
 * commands before executing destructive or irreversible operations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.askConfirmation = askConfirmation;
exports.askApproval = askApproval;
exports.askDestroyApproval = askDestroyApproval;
exports.askMigrationApproval = askMigrationApproval;
exports.askStatus = askStatus;
const readline_1 = require("readline");
const chalk_1 = require("chalk");
const const_1 = require("../const");
/**
 * Generic stdin confirmation prompt that accepts only "yes" as approval.
 *
 * @param lines - Lines of text to display before the prompt input.
 * @returns `true` if the user typed "yes" (case-insensitive), `false` otherwise.
 *
 * @example
 * const ok = await askConfirmation(['Are you sure you want to delete everything?']);
 * if (!ok) process.exit(0);
 */
async function askConfirmation(lines) {
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        console.log('');
        for (const line of lines) {
            console.log(line);
        }
        console.log(`  ${const_1.MSG_APPROVE_ONLY_YES}`);
        console.log('');
        rl.question('  Enter a value: ', (answer) => {
            rl.close();
            console.log('');
            resolve(answer.trim().toLowerCase() === 'yes');
        });
    });
}
/**
 * Apply approval prompt.
 * Shown before `testform apply` executes any planned changes.
 *
 * @returns `true` if the user approved, `false` if they declined.
 */
async function askApproval() {
    return askConfirmation([
        'Do you want to perform these actions?',
        `  ${const_1.TITLE_APP} will perform the actions described above.`,
    ]);
}
/**
 * Destroy approval prompt.
 * Shown before `testform destroy` removes all managed resources.
 *
 * @param count - Number of resources that will be destroyed.
 * @returns `true` if the user approved, `false` if they declined.
 */
async function askDestroyApproval(count) {
    return askConfirmation([
        (0, chalk_1.red)((0, chalk_1.bold)(`${const_1.TITLE_APP} will destroy ${count} resource(s).`)),
        '  This action cannot be undone.',
    ]);
}
/**
 * Interactive prompt for state migration when backend configuration changes.
 *
 * @param newBackendType - The type of the new backend being configured.
 * @returns `true` if the user wants to copy state, `false` to start empty.
 */
async function askMigrationApproval(newBackendType) {
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        console.log('');
        console.log((0, chalk_1.bold)('Do you want to copy existing state to the new backend?'));
        console.log('  Pre-existing state was found while migrating the previous');
        console.log(`  backend to the newly configured "${newBackendType}" backend.`);
        console.log('  Do you want to copy this state to the new backend?');
        console.log('  Enter "yes" to copy and "no" to start with an empty state.');
        console.log('');
        rl.question('  Enter a value: ', (answer) => {
            rl.close();
            console.log('');
            resolve(answer.trim().toLowerCase() === 'yes');
        });
    });
}
/**
 * Interactive prompt for selecting a status.
 *
 * @returns The selected status string.
 */
async function askStatus() {
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        console.log('');
        console.log((0, chalk_1.bold)('Select the new status for this testcase:'));
        console.log('  Available options: passed, failed, pending, skipped, blocked, etc.');
        console.log('');
        rl.question('  Enter the new status: ', (answer) => {
            rl.close();
            console.log('');
            resolve(answer.trim().toLowerCase());
        });
    });
}
