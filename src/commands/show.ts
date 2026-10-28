import { bold, cyan, dim, green, yellow } from 'chalk';
import { existsSync, readFileSync } from 'fs';
import pathLib from 'path';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { TITLE_APP, TITLE_CLI } from '../core/const';
import { resource } from '../core/resources';

interface ShowCmdOptions {
    path?: string;
    isJson?: boolean;
    verbose?: boolean;
    dir?: string;
    statePath?: string;
    backupPath?: string;
}

export const showCmd = async (options: ShowCmdOptions = {}) => {
    const {
        path,
        isJson = false,
        verbose = false,
        dir = '.',
        statePath,
        backupPath
    } = options;
    const logger = new Logger(verbose);

    if (path) {
        const resolvedPath = pathLib.resolve(dir, path);
        if (!existsSync(resolvedPath)) {
            logger.error(`The specified file does not exist: ${resolvedPath}`);
            process.exitCode = 1;
            return;
        }
        try {
            const content = readFileSync(resolvedPath, 'utf-8');
            const parsed = JSON.parse(content);
            // Check if this is a plan file rather than a state file
            if (parsed && (Array.isArray(parsed.changes) || ((parsed.testform_version || parsed.format_version) && !parsed.resources))) {
                if (isJson) {
                    console.log(JSON.stringify(parsed, null, 2));
                    return;
                }
                const changes = parsed.changes || [];
                const state = new State(dir, statePath, backupPath);
                try {
                    await state.init();
                } catch {
                    // ignore state init errors when displaying plan
                }
                resource.summary(changes, true, { state });
                return;
            }
        } catch (err: any) {
            if (err instanceof SyntaxError) {
                logger.error(`Failed to parse file at ${resolvedPath}: ${err.message}`);
                process.exitCode = 1;
                return;
            }
        }
    }

    const state = new State(dir, path || statePath, backupPath);
    await state.init();

    const current = state.getState();
    const resources = current.resources;

    if (isJson) {
        console.log(JSON.stringify(current, null, 2));
        return;
    }

    console.log('');
    console.log(bold(`# ${TITLE_APP} State`));
    console.log(`  Version:    ${current.version}`);
    console.log(`  Serial:     ${current.serial}`);
    console.log(`  Lineage:    ${current.lineage}`);
    console.log(`  Last Sync:  ${current.lastSync || '(never)'}`);
    console.log(`  Resources:  ${resources.length}`);
    console.log('');

    if (resources.length > 0) {
        for (const res of resources) {
            const remoteId = res.attributes.remoteId ?? '(unknown)';
            const status = res.attributes.issueNumber ? green('synced') : yellow('pending');

            const formattedIdentity = res.identity;

            console.log(`  ${cyan(res.type)}.${bold(formattedIdentity)} [id=${remoteId}] ${status}`);
            console.log(`    title:        ${res.attributes.title}`);
            console.log(`    issueNumber:  ${res.attributes.issueNumber ?? '(none)'}`);
            console.log(`    localHash:    ${dim(res.attributes.localHash.substring(0, 12))}...`);
            console.log(`    lastApplied:  ${res.lastApplied}`);
            console.log('');
        }
    }
}

