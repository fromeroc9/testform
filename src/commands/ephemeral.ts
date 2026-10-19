import { resolve, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'fs';
import { bold, green, yellow, red, cyan, dim, gray } from 'chalk';
import { IScope } from '../core/types';
import { applyCmd } from './apply';
import { destroyCmd } from './destroy';
import { TITLE_APP, TITLE_CLI } from '../core/const';

export interface EphemeralCmdOptions {
    subcommand?: string;
    id?: string;
    dir?: string;
    testDirectory?: string;
    scope?: IScope | 'all';
    autoApprove?: boolean;
    force?: boolean;
    json?: boolean;
    verbose?: boolean;
}

export interface EphemeralMetadata {
    id: string;
    createdAt: string;
    updatedAt: string;
    scope: string;
}

export function getEphemeralBaseDir(dir: string): string {
    return resolve(dir, '.testform', 'ephemeral');
}

export function getEphemeralSandboxDir(dir: string, id: string): string {
    return join(getEphemeralBaseDir(dir), id);
}

export function isValidSandboxId(id: string): boolean {
    return /^[a-zA-Z0-9_\-\.]+$/.test(id);
}

export const ephemeralCmd = async (options: EphemeralCmdOptions) => {
    const {
        subcommand,
        id,
        dir = '.',
        testDirectory,
        scope = 'all',
        autoApprove = false,
        force = false,
        json = false,
        verbose = false
    } = options;

    if (!subcommand) {
        console.error(red(`\nError: Missing subcommand for ${TITLE_CLI} ephemeral.`));
        console.log(`\nUsage:`);
        console.log(`  ${TITLE_CLI} ephemeral up <id> [options]      Deploy an isolated ephemeral sandbox`);
        console.log(`  ${TITLE_CLI} ephemeral down <id> [options]    Destroy all remote issues and clean sandbox`);
        console.log(`  ${TITLE_CLI} ephemeral list [options]         List all active ephemeral sandboxes`);
        console.log(`  ${TITLE_CLI} ephemeral show <id> [options]    Inspect an ephemeral sandbox\n`);
        process.exit(1);
    }

    const baseDir = getEphemeralBaseDir(dir);

    switch (subcommand) {
        case 'up':
        case 'apply': {
            if (!id) {
                console.error(red('\nError: Expected an ephemeral sandbox ID (e.g., pr-42, branch-login).'));
                process.exit(1);
            }
            if (!isValidSandboxId(id)) {
                console.error(red(`\nError: Invalid sandbox ID "${id}". Use alphanumeric characters, hyphens, and underscores.`));
                process.exit(1);
            }

            const sandboxDir = getEphemeralSandboxDir(dir, id);
            if (!existsSync(sandboxDir)) {
                mkdirSync(sandboxDir, { recursive: true });
            }

            const statePath = join(sandboxDir, 'testform.state');
            const backupPath = join(sandboxDir, 'testform.state.backup');
            const metaPath = join(sandboxDir, 'metadata.json');

            let meta: EphemeralMetadata = {
                id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                scope: String(scope)
            };

            if (existsSync(metaPath)) {
                try {
                    const existing = JSON.parse(readFileSync(metaPath, 'utf8'));
                    meta.createdAt = existing.createdAt || meta.createdAt;
                } catch {
                    // Ignore parse error
                }
            }
            writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

            console.log(cyan(bold(`\n🚀 Initializing ephemeral QA sandbox: `) + bold(id)));
            console.log(dim(`   Isolated state: ${statePath}\n`));

            await applyCmd({
                dir,
                testDirectory,
                scope,
                autoApprove: Boolean(autoApprove),
                verbose: Boolean(verbose),
                statePath,
                backupPath
            });

            console.log(green(bold(`\n✔ Ephemeral sandbox "${id}" successfully deployed!`)));
            console.log(gray(`  State location: ${statePath}`));
            console.log(cyan(`  To tear down this sandbox and close all created remote issues:`));
            console.log(bold(`    $ ${TITLE_CLI} ephemeral down ${id} --auto-approve\n`));
            break;
        }

        case 'down':
        case 'destroy': {
            if (!id) {
                console.error(red('\nError: Expected an ephemeral sandbox ID (e.g., pr-42, branch-login).'));
                process.exit(1);
            }

            const sandboxDir = getEphemeralSandboxDir(dir, id);
            const statePath = join(sandboxDir, 'testform.state');
            const backupPath = join(sandboxDir, 'testform.state.backup');

            if (!existsSync(sandboxDir) || !existsSync(statePath)) {
                if (!force) {
                    console.log(yellow(`\nNo active ephemeral sandbox found with ID "${id}". Nothing to destroy.`));
                    return;
                }
            }

            console.log(yellow(bold(`\n🧹 Tearing down ephemeral QA sandbox: `) + bold(id)));

            if (existsSync(statePath)) {
                await destroyCmd({
                    dir,
                    scope: 'all',
                    autoApprove: Boolean(autoApprove),
                    input: !autoApprove,
                    verbose: Boolean(verbose),
                    statePath,
                    backupPath
                });
            }

            // Clean up sandbox directory
            if (existsSync(sandboxDir)) {
                rmSync(sandboxDir, { recursive: true, force: true });
            }

            console.log(green(bold(`\n✨ Ephemeral sandbox "${id}" is completely destroyed!`)));
            console.log(dim(`   Remote issues closed and isolated state directory removed. Zero orphans left.\n`));
            break;
        }

        case 'list': {
            if (!existsSync(baseDir)) {
                if (json) {
                    console.log('[]');
                } else {
                    console.log(yellow('\nNo active ephemeral sandboxes found.\n'));
                }
                return;
            }

            const entries = readdirSync(baseDir, { withFileTypes: true });
            const sandboxes: Array<{ id: string; resourcesCount: number; createdAt: string; scope: string }> = [];

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const sId = entry.name;
                    const sDir = join(baseDir, sId);
                    const stateFile = join(sDir, 'testform.state');
                    const metaFile = join(sDir, 'metadata.json');

                    let count = 0;
                    let createdAt = 'Unknown';
                    let sc = 'all';

                    if (existsSync(stateFile)) {
                        try {
                            const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
                            count = (parsed.resources || []).length;
                        } catch {}
                    }

                    if (existsSync(metaFile)) {
                        try {
                            const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
                            createdAt = meta.createdAt ? new Date(meta.createdAt).toLocaleString() : 'Unknown';
                            sc = meta.scope || 'all';
                        } catch {}
                    }

                    sandboxes.push({ id: sId, resourcesCount: count, createdAt, scope: sc });
                }
            }

            if (json) {
                console.log(JSON.stringify(sandboxes, null, 2));
                return;
            }

            if (sandboxes.length === 0) {
                console.log(yellow('\nNo active ephemeral sandboxes found.\n'));
                return;
            }

            console.log(bold(`\nActive Ephemeral Sandboxes (${sandboxes.length}):\n`));
            const idHeader = 'SANDBOX ID'.padEnd(20);
            const resHeader = 'RESOURCES'.padEnd(12);
            const scopeHeader = 'SCOPE'.padEnd(12);
            const createdHeader = 'CREATED AT';
            console.log(dim(`  ${idHeader} ${resHeader} ${scopeHeader} ${createdHeader}`));
            console.log(dim(`  ${'─'.repeat(19)} ${'─'.repeat(11)} ${'─'.repeat(11)} ${'─'.repeat(20)}`));

            for (const s of sandboxes) {
                const idCol = cyan(s.id.padEnd(20));
                const resCol = green(String(s.resourcesCount).padEnd(12));
                const scopeCol = yellow(s.scope.padEnd(12));
                const dateCol = dim(s.createdAt);
                console.log(`  ${idCol} ${resCol} ${scopeCol} ${dateCol}`);
            }
            console.log('');
            break;
        }

        case 'show': {
            if (!id) {
                console.error(red('\nError: Expected an ephemeral sandbox ID.'));
                process.exit(1);
            }
            const sandboxDir = getEphemeralSandboxDir(dir, id);
            const stateFile = join(sandboxDir, 'testform.state');
            const metaFile = join(sandboxDir, 'metadata.json');

            if (!existsSync(sandboxDir) || !existsSync(stateFile)) {
                console.error(red(`\nError: Ephemeral sandbox "${id}" not found.`));
                process.exit(1);
            }

            let stateData: any = {};
            let metaData: any = {};

            try {
                stateData = JSON.parse(readFileSync(stateFile, 'utf8'));
            } catch {}

            if (existsSync(metaFile)) {
                try {
                    metaData = JSON.parse(readFileSync(metaFile, 'utf8'));
                } catch {}
            }

            if (json) {
                console.log(JSON.stringify({ metadata: metaData, state: stateData }, null, 2));
                return;
            }

            const resources = stateData.resources || [];
            console.log(bold(`\nEphemeral Sandbox: `) + cyan(bold(id)));
            console.log(dim(`Created: `) + (metaData.createdAt ? new Date(metaData.createdAt).toLocaleString() : 'N/A'));
            console.log(dim(`State file: `) + stateFile);
            console.log(dim(`Tracked resources: `) + green(resources.length));

            if (resources.length > 0) {
                console.log(bold(`\nResources:`));
                for (const r of resources) {
                    const num = r.attributes?.issueNumber ? `#${r.attributes.issueNumber}` : '(unassigned)';
                    console.log(`  - ${cyan(r.type)}: ${r.identity} ${dim(num)}`);
                }
            }
            console.log('');
            break;
        }

        default:
            console.error(red(`\nUnknown ephemeral subcommand: "${subcommand}".`));
            console.log(`Available subcommands: up, down, list, show\n`);
            process.exit(1);
    }
};
