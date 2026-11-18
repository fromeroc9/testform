import { resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { bold, green, yellow, red, cyan, dim, gray } from 'chalk';
import { Logger } from '../core/logger';
import { State } from '../core/state';
import { TITLE_CLI, FILE_STATE } from '../core/const';
import { HELP_WORKSPACE, HELP_WORKSPACE_NEW, HELP_WORKSPACE_DELETE, getCommandHelp } from '../core/help';
import { destroyCmd } from './destroy';

export interface WorkspaceCmdOptions {
    dir: string;
    verbose?: boolean;
    args?: string[];
    ephemeral?: boolean;
    ttl?: string;
    autoApprove?: boolean;
    force?: boolean;
    json?: boolean;
    ephemeralOnly?: boolean;
}

export interface WorkspaceMetadata {
    id: string;
    ephemeral?: boolean;
    createdAt: string;
    ttl?: string | null;
    expiresAt?: string | null;
}

export function parseDurationMs(duration: string): number | null {
    const match = duration.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?$/i);
    if (!match) return null;
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'h').toLowerCase();
    switch (unit) {
        case 's': return num * 1000;
        case 'm': return num * 60 * 1000;
        case 'h': return num * 60 * 60 * 1000;
        case 'd': return num * 24 * 60 * 60 * 1000;
        case 'w': return num * 7 * 24 * 60 * 60 * 1000;
        default: return num * 60 * 60 * 1000;
    }
}

export function formatRemainingTtl(expiresAtIso?: string | null): string {
    if (!expiresAtIso) return 'Infinito';
    const diffMs = new Date(expiresAtIso).getTime() - Date.now();
    if (diffMs <= 0) return '⚠️ Expirado';
    const hours = Math.floor(diffMs / (3600 * 1000));
    const minutes = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `⏳ ${days}d ${hours % 24}h restante`;
    }
    if (hours > 0) {
        return `⏳ ${hours}h ${minutes}m restante`;
    }
    return `⏳ ${minutes}m restante`;
}

export function getWorkspaceDir(dir: string, name: string): string {
    return resolve(dir, `${FILE_STATE}.d`, name);
}

export function getWorkspaceMetadata(dir: string, name: string): WorkspaceMetadata | null {
    if (name === 'default') return null;
    const metaPath = join(getWorkspaceDir(dir, name), 'metadata.json');
    if (existsSync(metaPath)) {
        try {
            return JSON.parse(readFileSync(metaPath, 'utf8'));
        } catch {
            return null;
        }
    }
    return null;
}

export function setWorkspaceMetadata(dir: string, name: string, meta: WorkspaceMetadata): void {
    const wsDir = getWorkspaceDir(dir, name);
    if (!existsSync(wsDir)) {
        mkdirSync(wsDir, { recursive: true });
    }
    const metaPath = join(wsDir, 'metadata.json');
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

export function getWorkspaceResourceCount(dir: string, name: string): number {
    const stateFile = name === 'default'
        ? resolve(dir, FILE_STATE)
        : resolve(getWorkspaceDir(dir, name), FILE_STATE);
    if (existsSync(stateFile)) {
        try {
            const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
            return (parsed.resources || []).length;
        } catch {
            return 0;
        }
    }
    return 0;
}

export const workspaceCmd = async (options: WorkspaceCmdOptions) => {
    const {
        dir,
        verbose = false,
        args = [],
        ephemeral = false,
        ttl,
        autoApprove = false,
        force = false,
        json = false,
        ephemeralOnly = false,
    } = options;

    const logger = new Logger(verbose);
    const stateObj = new State(dir);
    const subcommand = args[0];
    const name = args[1];

    if (!subcommand) {
        console.log(HELP_WORKSPACE);
        process.exit(1);
    }

    if (typeof stateObj.init === 'function') await stateObj.init();
    const currentWorkspace = stateObj.getCurrentWorkspace();

    switch (subcommand) {
        case 'help': {
            if (name) {
                const subHelp = getCommandHelp(`workspace ${name}`);
                if (subHelp) {
                    console.log(subHelp);
                    process.exit(0);
                }
            }
            console.log(HELP_WORKSPACE);
            process.exit(0);
        }

        case 'show': {
            if (!name) {
                console.log(currentWorkspace);
                break;
            }

            const isCurrent = name === currentWorkspace;
            const meta = getWorkspaceMetadata(dir, name);
            const isEph = Boolean(meta?.ephemeral);
            const stateFile = name === 'default'
                ? resolve(dir, FILE_STATE)
                : resolve(getWorkspaceDir(dir, name), FILE_STATE);

            let stateData: any = {};
            if (existsSync(stateFile)) {
                try {
                    stateData = JSON.parse(readFileSync(stateFile, 'utf8'));
                } catch {}
            }

            if (json) {
                console.log(JSON.stringify({
                    workspace: name,
                    type: isEph ? 'ephemeral' : 'persistent',
                    current: isCurrent,
                    metadata: meta,
                    state: stateData
                }, null, 2));
                return;
            }

            const resources = stateData.resources || [];
            const typeLabel = isEph ? '🧪 Ephemeral' : '🏛️ Persistent';
            console.log(bold(`\nWorkspace: `) + cyan(bold(name)) + ` (${typeLabel})`);
            if (meta?.createdAt) {
                console.log(dim(`Created: `) + new Date(meta.createdAt).toLocaleString());
            }
            if (isEph && meta?.expiresAt) {
                console.log(dim(`TTL Remaining: `) + formatRemainingTtl(meta.expiresAt));
            }
            console.log(dim(`State file: `) + stateFile);
            console.log(dim(`Tracked resources: `) + green(resources.length));

            if (resources.length > 0) {
                console.log(bold(`\nResources:`));
                for (const r of resources) {
                    const num = r.attributes?.issueNumber ? `#${r.attributes.issueNumber}` : (r.identity || '');
                    console.log(`  - ${cyan(r.type)}: ${r.address || r.identity} ${dim(num)}`);
                }
            }
            console.log('');
            break;
        }

        case 'list': {
            const allWorkspaces = await stateObj.listWorkspaces();
            const rows: Array<{
                name: string;
                isCurrent: boolean;
                isEphemeral: boolean;
                resourcesCount: number;
                createdAt: string;
                ttlDisplay: string;
                expiresAt?: string | null;
            }> = [];

            for (const ws of allWorkspaces) {
                const meta = getWorkspaceMetadata(dir, ws);
                const isEph = Boolean(meta?.ephemeral);

                if (ephemeralOnly && !isEph) {
                    continue;
                }

                const resCount = getWorkspaceResourceCount(dir, ws);
                const isCur = ws === currentWorkspace;
                const created = meta?.createdAt ? new Date(meta.createdAt).toLocaleString() : (ws === 'default' ? 'Official State' : 'N/A');
                const ttlDisplay = ws === 'default'
                    ? 'Infinito (Oficial)'
                    : isEph
                    ? formatRemainingTtl(meta?.expiresAt)
                    : 'Infinito';

                rows.push({
                    name: ws,
                    isCurrent: isCur,
                    isEphemeral: isEph,
                    resourcesCount: resCount,
                    createdAt: created,
                    ttlDisplay,
                    expiresAt: meta?.expiresAt,
                });
            }

            if (json) {
                console.log(JSON.stringify(rows, null, 2));
                return;
            }

            if (rows.length === 0) {
                if (ephemeralOnly) {
                    console.log(yellow('\nNo active ephemeral sandboxes found.\n'));
                } else {
                    console.log(yellow('\nNo workspaces found.\n'));
                }
                return;
            }

            console.log(bold(`\nActive Workspaces (${rows.length}):\n`));
            const nameH = 'WORKSPACE'.padEnd(22);
            const typeH = 'TYPE'.padEnd(16);
            const resH = 'RESOURCES'.padEnd(12);
            const ttlH = 'TTL RESTANTE'.padEnd(24);
            const dateH = 'CREATED AT';
            console.log(dim(`  ${nameH} ${typeH} ${resH} ${ttlH} ${dateH}`));
            console.log(dim(`  ${'─'.repeat(21)} ${'─'.repeat(15)} ${'─'.repeat(11)} ${'─'.repeat(23)} ${'─'.repeat(20)}`));

            for (const r of rows) {
                const prefix = r.isCurrent ? green('* ') : '  ';
                const nameCol = r.isCurrent ? green(bold(r.name.padEnd(20))) : cyan(r.name.padEnd(20));
                const typeCol = r.isEphemeral ? yellow('🧪 Ephemeral'.padEnd(16)) : dim('🏛️ Persistent'.padEnd(16));
                const resCol = green(String(r.resourcesCount).padEnd(12));
                const ttlCol = r.ttlDisplay.includes('Expirado') ? red(r.ttlDisplay.padEnd(24)) : dim(r.ttlDisplay.padEnd(24));
                const dateCol = dim(r.createdAt);

                console.log(`${prefix}${nameCol} ${typeCol} ${resCol} ${ttlCol} ${dateCol}`);
            }
            console.log('');
            break;
        }

        case 'new': {
            if (!name || name === '-h' || name === '-help' || name === '--help') {
                if (name === '-h' || name === '-help' || name === '--help') {
                    console.log(HELP_WORKSPACE_NEW);
                    process.exit(0);
                }
                logger.error(`Expected a workspace name.\n\n${HELP_WORKSPACE_NEW}`);
                process.exit(1);
            }
            if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
                logger.error(`Invalid workspace name "${name}". Use alphanumeric characters, hyphens, and underscores.`);
                process.exit(1);
            }
            const existingForNew = await stateObj.listWorkspaces();
            if (existingForNew.includes(name)) {
                logger.error(`Workspace "${name}" already exists`);
                process.exit(1);
            }

            // Create workspace state directory
            const wsDir = getWorkspaceDir(dir, name);
            if (!existsSync(wsDir)) {
                mkdirSync(wsDir, { recursive: true });
            }

            let expiresAt: string | null = null;
            if (ephemeral && ttl) {
                const durMs = parseDurationMs(ttl);
                if (durMs !== null) {
                    expiresAt = new Date(Date.now() + durMs).toISOString();
                }
            }

            if (ephemeral) {
                setWorkspaceMetadata(dir, name, {
                    id: name,
                    ephemeral: true,
                    createdAt: new Date().toISOString(),
                    ttl: ttl || null,
                    expiresAt,
                });
            }

            stateObj.setCurrentWorkspace(name);

            // Re-instantiate state to bind backend to the new workspace
            const newStateObj = new State(dir);
            if (typeof newStateObj.init === 'function') await newStateObj.init();
            if (typeof newStateObj.clearResources === 'function') newStateObj.clearResources();
            if (typeof newStateObj.save === 'function') await newStateObj.save();

            const statePath = resolve(wsDir, FILE_STATE);
            if (ephemeral) {
                console.log(cyan(bold(`\n🚀 Initializing ephemeral QA workspace: `) + bold(name)));
                console.log(dim(`   Isolated state: ${statePath}\n`));
                if (expiresAt) {
                    console.log(dim(`   TTL duration: ${ttl} (Expires: ${new Date(expiresAt).toLocaleString()})`));
                }
                console.log(green(bold(`✔ Ephemeral workspace "${name}" successfully created and activated!`)));
                console.log(gray(`  All testform commands will now safely execute in this sandbox.`));
                console.log(cyan(`  To teardown and close all remote issues when done:`));
                console.log(bold(`    $ ${TITLE_CLI} workspace delete ${name} -auto-approve\n`));
            } else {
                console.log(green(`Created and switched to workspace "${name}"!`));
                console.log('');
                console.log(`You're now on a new, empty workspace. Workspaces isolate their state,`);
                console.log(`so if you run "${TITLE_CLI} plan" ${TITLE_CLI} will not see any existing state`);
                console.log(`for this configuration.`);
            }
            break;
        }

        case 'select': {
            if (!name) {
                logger.error('Expected a workspace name');
                process.exit(1);
            }
            const existingForSelect = await stateObj.listWorkspaces();
            if (!existingForSelect.includes(name)) {
                logger.error(`Workspace "${name}" doesn't exist.\n\nYou can create this workspace with the "new" subcommand.`);
                process.exit(1);
            }
            stateObj.setCurrentWorkspace(name);

            const meta = getWorkspaceMetadata(dir, name);
            if (meta?.ephemeral) {
                const ttlInfo = meta.expiresAt ? ` (${formatRemainingTtl(meta.expiresAt)})` : '';
                console.log(green(`Switched to ephemeral workspace "${name}"${ttlInfo}.`));
            } else {
                console.log(green(`Switched to workspace "${name}".`));
            }
            break;
        }

        case 'delete': {
            if (!name || name === '-h' || name === '-help' || name === '--help') {
                if (name === '-h' || name === '-help' || name === '--help') {
                    console.log(HELP_WORKSPACE_DELETE);
                    process.exit(0);
                }
                logger.error(`Expected a workspace name.\n\n${HELP_WORKSPACE_DELETE}`);
                process.exit(1);
            }
            if (name === 'default') {
                logger.error(`Workspace "default" cannot be deleted.`);
                process.exit(1);
            }
            if (name === currentWorkspace && !force) {
                logger.error(`Workspace "${name}" is your active workspace.\n\nYou cannot delete the currently active workspace. Please switch\nto another workspace and try again.`);
                process.exit(1);
            }
            const existingForDelete = await stateObj.listWorkspaces();
            if (!existingForDelete.includes(name)) {
                logger.error(`Workspace "${name}" doesn't exist.`);
                process.exit(1);
            }

            const meta = getWorkspaceMetadata(dir, name);
            const isEph = Boolean(meta?.ephemeral);
            const wsDir = getWorkspaceDir(dir, name);
            const statePath = resolve(wsDir, FILE_STATE);
            const backupPath = `${statePath}.backup`;

            if (isEph) {
                console.log(yellow(bold(`\n🧹 Tearing down ephemeral workspace: `) + bold(name)));

                if (existsSync(statePath)) {
                    await destroyCmd({
                        dir,
                        autoApprove: Boolean(autoApprove),
                        input: !autoApprove,
                        verbose: Boolean(verbose),
                        statePath,
                        backupPath,
                    });
                }

                if (existsSync(wsDir)) {
                    rmSync(wsDir, { recursive: true, force: true });
                }

                if (name === currentWorkspace) {
                    stateObj.setCurrentWorkspace('default');
                }

                console.log(green(bold(`\n✨ Ephemeral workspace "${name}" is completely destroyed!`)));
                console.log(dim(`   Remote issues closed and isolated state directory removed. Zero orphans left.\n`));
            } else {
                const deleted = await stateObj.deleteWorkspace(name);
                if (deleted) {
                    if (name === currentWorkspace) {
                        stateObj.setCurrentWorkspace('default');
                    }
                    console.log(green(`Deleted workspace "${name}"!`));
                } else {
                    logger.error(`Failed to delete workspace "${name}".`);
                    process.exit(1);
                }
            }
            break;
        }

        case 'promote': {
            if (!name) {
                logger.error('Expected a workspace name to promote into default');
                process.exit(1);
            }
            if (name === 'default') {
                logger.error(`Cannot promote "default" into itself.`);
                process.exit(1);
            }
            const existingForPromote = await stateObj.listWorkspaces();
            if (!existingForPromote.includes(name)) {
                logger.error(`Workspace "${name}" doesn't exist.`);
                process.exit(1);
            }

            const wsDir = getWorkspaceDir(dir, name);
            const wsStateFile = resolve(wsDir, FILE_STATE);
            if (!existsSync(wsStateFile)) {
                logger.error(`Workspace "${name}" has no state file to promote.`);
                process.exit(1);
            }

            let wsStateRaw: any = {};
            try {
                wsStateRaw = JSON.parse(readFileSync(wsStateFile, 'utf8'));
            } catch {
                logger.error(`Failed to read state file for workspace "${name}".`);
                process.exit(1);
            }

            const wsResources = wsStateRaw.resources || [];
            const defaultStateFile = resolve(dir, FILE_STATE);
            let defaultStateRaw: any = {
                version: wsStateRaw.version || 1,
                serial: 0,
                lineage: wsStateRaw.lineage,
                lastSync: new Date().toISOString(),
                resources: [],
            };

            if (existsSync(defaultStateFile)) {
                try {
                    defaultStateRaw = JSON.parse(readFileSync(defaultStateFile, 'utf8'));
                } catch {}
            }

            console.log(cyan(bold(`\n🚀 Promoting workspace "${name}" into default...`)));

            // Reconcile / merge resources cleanly by address/identity
            const resourceMap = new Map<string, any>();
            for (const r of defaultStateRaw.resources || []) {
                const key = r.address || r.identity || r.type;
                resourceMap.set(key, r);
            }
            for (const r of wsResources) {
                const key = r.address || r.identity || r.type;
                resourceMap.set(key, r);
            }

            defaultStateRaw.resources = Array.from(resourceMap.values());
            defaultStateRaw.serial = (defaultStateRaw.serial || 0) + 1;
            defaultStateRaw.lastSync = new Date().toISOString();

            writeFileSync(defaultStateFile, JSON.stringify(defaultStateRaw, null, 2), 'utf8');

            // Clean up workspace directory
            if (existsSync(wsDir)) {
                rmSync(wsDir, { recursive: true, force: true });
            }

            // Return to default
            stateObj.setCurrentWorkspace('default');

            console.log(green(bold(`✔ ${wsResources.length} resources safely reconciled and merged into Official State.`)));
            console.log(green(bold(`✨ Workspace "${name}" promoted and cleaned up. Active workspace set to "default".\n`)));
            break;
        }

        case 'cleanup': {
            console.log(cyan(bold(`\n🧹 Scanning for expired ephemeral workspaces...`)));
            const all = await stateObj.listWorkspaces();
            let cleaned = 0;

            for (const ws of all) {
                if (ws === 'default') continue;
                const meta = getWorkspaceMetadata(dir, ws);
                if (meta?.ephemeral && meta.expiresAt) {
                    if (new Date(meta.expiresAt).getTime() <= Date.now()) {
                        console.log(yellow(`  - Cleaning expired sandbox: ${ws}`));
                        const wsDir = getWorkspaceDir(dir, ws);
                        const statePath = resolve(wsDir, FILE_STATE);
                        const backupPath = `${statePath}.backup`;

                        if (existsSync(statePath)) {
                            await destroyCmd({
                                dir,
                                autoApprove: true,
                                input: false,
                                verbose: false,
                                statePath,
                                backupPath,
                            });
                        }
                        if (existsSync(wsDir)) {
                            rmSync(wsDir, { recursive: true, force: true });
                        }
                        cleaned++;
                    }
                }
            }

            if (cleaned === 0) {
                console.log(dim(`No expired ephemeral workspaces found.\n`));
            } else {
                console.log(green(bold(`✔ Successfully cleaned up ${cleaned} expired ephemeral workspace(s).\n`)));
            }
            break;
        }

        default:
            logger.error(`Invalid workspace subcommand: "${subcommand}".\n\n${HELP_WORKSPACE}`);
            process.exit(1);
    }
};
