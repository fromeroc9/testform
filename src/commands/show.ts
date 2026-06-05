import { bold, cyan, dim, green, yellow } from 'chalk';
import { State } from '../core/state';
import { Logger } from '../logger';
import { TITLE_APP, TITLE_CLI } from '../const';

import pathLib from 'path';

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

    // If path is "state" or "plan" (legacy support)
    let actualPath = path;
    if (path === 'state') actualPath = undefined;
    if (path === 'plan') {
        logger.info(`Use "${TITLE_CLI} plan" to generate and view an execution plan.`);
        return;
    }

    const state = new State(dir, actualPath || statePath, backupPath);
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

            let formattedIdentity = res.identity;
            if (formattedIdentity.includes('::')) {
                const parts = formattedIdentity.split('::');
                const base = pathLib.basename(parts[0], '.feature');
                formattedIdentity = `${base}::${parts.slice(1).join('::')}`;
            } else {
                formattedIdentity = pathLib.basename(formattedIdentity, '.feature');
            }

            console.log(`  ${cyan(res.type)}.${bold(formattedIdentity)} [id=${remoteId}] ${status}`);
            console.log(`    title:        ${res.attributes.title}`);
            console.log(`    issueNumber:  ${res.attributes.issueNumber ?? '(none)'}`);
            console.log(`    localHash:    ${dim(res.attributes.localHash.substring(0, 12))}...`);
            console.log(`    lastApplied:  ${res.lastApplied}`);
            console.log('');
        }
    }
}

