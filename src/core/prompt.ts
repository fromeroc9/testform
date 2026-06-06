/**
 * @fileoverview Interactive prompt utilities for CLI confirmation dialogs.
 *
 * Provides approval prompts used by `apply` and `destroy`
 * commands before executing destructive or irreversible operations.
 */

import { createInterface } from 'readline';
import { bold, red } from 'chalk';
import { TITLE_APP, MSG_APPROVE_ONLY_YES } from '../const';

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
export async function askConfirmation(lines: string[]): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
        console.log('');
        for (const line of lines) {
            console.log(line);
        }
        console.log(`  ${MSG_APPROVE_ONLY_YES}`);
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
export async function askApproval(): Promise<boolean> {
    return askConfirmation([
        'Do you want to perform these actions?',
        `  ${TITLE_APP} will perform the actions described above.`,
    ]);
}

/**
 * Destroy approval prompt.
 * Shown before `testform destroy` removes all managed resources.
 *
 * @param count - Number of resources that will be destroyed.
 * @param scope - Optional scope name being destroyed.
 * @returns `true` if the user approved, `false` if they declined.
 */
export async function askDestroyApproval(count: number, scope?: string): Promise<boolean> {
    const scopeMsg = scope ? ` in scope '${scope}'` : '';
    return askConfirmation([
        red(bold(`${TITLE_APP} will destroy ${count} resource(s)${scopeMsg}.`)),
        '  This action cannot be undone.',
    ]);
}

/**
 * Interactive prompt for state migration when backend configuration changes.
 *
 * @param newBackendType - The type of the new backend being configured.
 * @returns `true` if the user wants to copy state, `false` to start empty.
 */
export async function askMigrationApproval(newBackendType: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
        console.log('');
        console.log(bold('Do you want to copy existing state to the new backend?'));
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
export async function askStatus(): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
        console.log('');
        console.log(bold('Select the new status for this testcase:'));
        console.log('  Available options: passed, failed, pending, skipped, blocked, etc.');
        console.log('');

        rl.question('  Enter the new status: ', (answer) => {
            rl.close();
            console.log('');
            resolve(answer.trim().toLowerCase());
        });
    });
}
