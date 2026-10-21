/**
 * @fileoverview Interactive prompt utilities for CLI confirmation dialogs.
 *
 * Provides approval prompts used by `apply` and `destroy`
 * commands before executing destructive or irreversible operations.
 */

import { createInterface } from 'readline';
import { bold, red } from 'chalk';
import { TITLE_APP, MSG_APPROVE_ONLY_YES } from '../core/const';

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

export function isInteractive(): boolean {
    return Boolean(process.stdin.isTTY && !process.env.CI);
}

export async function askInput(promptText: string, defaultValue?: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const label = defaultValue ? `${promptText} [${defaultValue}]: ` : `${promptText}: `;
    return new Promise((resolve) => {
        rl.question(`  ${label}`, (answer) => {
            rl.close();
            const trimmed = answer.trim();
            resolve(trimmed || defaultValue || '');
        });
    });
}

export async function askSelect(
    titleText: string,
    choices: { label: string; value: string }[]
): Promise<string> {
    console.log(`\n${bold(titleText)}`);
    choices.forEach((c, idx) => {
        console.log(`  ${bold(`${idx + 1}.`)} ${c.label}`);
    });
    console.log('');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        const ask = () => {
            rl.question(`  Select an option (1-${choices.length}): `, (answer) => {
                const num = parseInt(answer.trim(), 10);
                if (num >= 1 && num <= choices.length) {
                    rl.close();
                    resolve(choices[num - 1].value);
                } else {
                    console.log(`  Invalid option. Please enter a number between 1 and ${choices.length}.`);
                    ask();
                }
            });
        };
        ask();
    });
}

/**
 * Interactive prompt for selecting a status.
 *
 * @returns The selected status string.
 */
export async function askStatus(defaultStatus: string = 'passed'): Promise<string> {
    return askSelect('Select the status:', [
        { label: 'passed - Prueba ejecutada con éxito', value: 'passed' },
        { label: 'failed - Prueba fallida', value: 'failed' },
        { label: 'pending - Pendiente de ejecución', value: 'pending' },
        { label: 'skipped - Prueba omitida', value: 'skipped' },
    ]);
}
