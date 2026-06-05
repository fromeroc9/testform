import { bold, red, green } from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { State } from '../core/state';
import { TITLE_CLI } from '../const';
import { formatHclValue } from '../core/utils';

interface StateCmdOptions {
    dir?: string;
    action: string;
    args: string[];
    statePath?: string;
    backupPath?: string;
    isJson?: boolean;
    id?: string;
    dryRun?: boolean;
    force?: boolean;
}

const ERROR_NO_STATE = `No state file was found!

State management commands require a state file. Run this command
in a directory where ${TITLE_CLI} has been run or use the -state flag
to point the command to a specific state location.`;



export const stateCmd = async (options: StateCmdOptions) => {
    const {
        dir = '.',
        action,
        args,
        statePath,
        backupPath,
        isJson,
        id,
        dryRun,
        force
    } = options;
    const state = new State(dir, statePath, backupPath);

    if (action !== 'push' && !(await state.hasState())) {
        console.error(red(ERROR_NO_STATE));
        process.exit(1);
    }

    await state.init();

    // Commands that don't need a lock
    if (action === 'pull') {
        const current = state.getState();
        console.log(JSON.stringify(current, null, 2));
        return;
    }

    if (action === 'push') {
        if (args.length !== 1) {
            console.error(red(`Usage: ${TITLE_CLI} state push [path]`));
            process.exit(1);
        }
        const localPath = resolve(process.cwd(), args[0]);
        if (!existsSync(localPath)) {
            console.error(red(`Error: File ${localPath} not found.`));
            process.exit(1);
        }
        try {
            const raw = readFileSync(localPath, 'utf-8');
            const parsed = JSON.parse(raw);
            
            await state.acquireLock(true, '0s');
            const current = state.getState();
            
            // Handle lineage validation if not forced
            if (!force && current.lineage && parsed.lineage && current.lineage !== parsed.lineage) {
                console.error(red(`Error: Cannot push state with different lineage. Use -force to override.`));
                process.exit(1);
            }

            const mutCurrent = current as any;
            mutCurrent.resources = parsed.resources || [];
            mutCurrent.serial += 1;
            await state.save();
            await state.releaseLock();

            console.log(green(`Successfully pushed state from ${args[0]}`));
            return;
        } catch (e: any) {
            console.error(red(`Error parsing or pushing state: ${e.message}`));
            process.exit(1);
        }
    }

    await state.acquireLock(true, '0s');

    try {
        const rawResources = state.getResources();
        
        const filterResources = (resources: any[]) => {
            let filtered = resources;
            if (id) {
                filtered = filtered.filter(r => r.attributes.issueNumber?.toString() === id || r.attributes.remoteId === id);
            }
            if (args.length > 0) {
                filtered = filtered.filter(r => {
                    const fullAddress = `${r.type}.${r.identity}`;
                    return args.some(addr => fullAddress.startsWith(addr) || r.identity.startsWith(addr));
                });
            }
            return filtered;
        };

        if (action === 'list') {
            const resources = filterResources(rawResources);
            if (resources.length === 0 && args.length > 0) {
                console.error(red(`No instance found for the given address!`));
                process.exit(1);
            } else if (resources.length === 0) {
                console.log('No resources found in state.');
            } else {
                for (const res of resources) {
                    const prefix = res.tainted ? '[tainted] ' : '';
                    console.log(`${prefix}${res.type}.${res.identity}`);
                }
            }
        } else if (action === 'identities') {
            if (!isJson) {
                console.error(red(`The \`${TITLE_CLI} state identities\` command requires the \`-json\` flag.`));
                process.exit(1);
            }
            const resources = filterResources(rawResources);
            const identities = resources.map(r => r.identity);
            console.log(JSON.stringify(identities, null, 2));

        } else if (action === 'show') {
            if (args.length !== 1) {
                console.error(red(`Exactly one argument expected.\nUsage: ${TITLE_CLI} [global options] state show [options] ADDRESS`));
                process.exit(1);
            }
            const address = args[0];
            const identity = address.includes('.') ? address.split('.').slice(1).join('.') : address;
            const res = rawResources.find(r => r.identity === identity || `${r.type}.${r.identity}` === identity);

            if (!res) {
                console.error(red(`No instance found for the given address!`));
                process.exit(1);
            }

            console.log(bold(`# ${res.type}.${res.identity}:`));
            console.log(`resource "${res.type}" "${res.identity}" {`);
            
            const keys = Object.keys(res.attributes);
            let maxKeyLen = 0;
            for (const k of keys) {
                if (k.length > maxKeyLen) maxKeyLen = k.length;
            }

            for (const key of keys) {
                const padding = ' '.repeat(maxKeyLen - key.length);
                const attrVal = Object.prototype.hasOwnProperty.call(res.attributes, key) ? res.attributes[key as keyof typeof res.attributes] : undefined;
                console.log(`    ${key}${padding} = ${formatHclValue(attrVal, 1)}`);
            }
            console.log(`}`);
            if (res.tainted) {
                console.log(red(`\nThis resource is marked as tainted.`));
            }
        } else if (action === 'rm') {
            if (args.length === 0) {
                console.error(red(`At least one address is required.\n\nUsage: ${TITLE_CLI} [global options] state rm [options] ADDRESS...`));
                process.exit(1);
            }
            
            let removedCount = 0;
            for (const arg of args) {
                const identity = arg.includes('.') ? arg.split('.').slice(1).join('.') : arg;
                if (rawResources.find(r => r.identity === identity || `${r.type}.${r.identity}` === identity)) {
                    if (dryRun) {
                        console.log(`Would remove ${arg}`);
                    } else {
                        state.removeResource(identity);
                        console.log(`Removed ${arg}`);
                    }
                    removedCount++;
                } else {
                    console.error(red(`Error: Resource ${arg} not found in state.`));
                }
            }

            if (removedCount > 0 && !dryRun) {
                await state.save();
                console.log(green(`\nSuccessfully removed ${removedCount} resource instance(s).`));
            }
        } else if (action === 'mv') {
            if (args.length !== 2) {
                console.error(red(`Exactly two arguments expected.\n\nUsage: ${TITLE_CLI} [global options] state mv [options] SOURCE DESTINATION`));
                process.exit(1);
            }
            const source = args[0];
            const dest = args[1];
            
            const sourceIdentity = source.includes('.') ? source.split('.').slice(1).join('.') : source;
            const destIdentity = dest.includes('.') ? dest.split('.').slice(1).join('.') : dest;

            const res = rawResources.find(r => r.identity === sourceIdentity || `${r.type}.${r.identity}` === sourceIdentity);
            if (!res) {
                console.error(red(`Error: Source resource ${source} not found in state.`));
                process.exit(1);
            }

            if (dryRun) {
                console.log(`Would move ${source} to ${dest}`);
            } else {
                state.removeResource(res.identity);
                res.identity = destIdentity;
                if (dest.includes('.')) {
                    res.type = dest.split('.')[0];
                }
                state.upsertResource(res);
                
                await state.save();
                console.log(green(`Move ${source} to ${dest} successfully executed!`));
            }

        } else {
            console.error(red(`Usage: ${TITLE_CLI} state <identities|list|mv|pull|push|rm|show> [options] [args]`));
            process.exit(1);
        }
    } finally {
        await state.releaseLock();
    }
};
