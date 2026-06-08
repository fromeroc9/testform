import { createHash } from 'crypto';
import { bold, green, yellow, red, cyan, dim } from 'chalk';
import { Config } from '../core/config';
import { Parser } from '../core/parser';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { IScope, DiffEntry, DiffStatus, ParserScenario } from '../core/types';
import { SCOPE_RESOURCE_MAP } from '../core/const';

function hashScenario(scenario: ParserScenario, scope?: IScope): string {
    const clone: ParserScenario = JSON.parse(JSON.stringify(scenario));
    if (!scope || scope === 'testcase') {
        clone.name = '';
    }
    if (!scope || scope === 'testrun' || scope === 'testplan') {
        if (clone.feature) {
            clone.feature.name = '';
        }
    }
    return createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

function getStatusIcon(status: DiffStatus): string {
    switch (status) {
        case 'synced': return green('✓');
        case 'modified_locally': return yellow('~');
        case 'new_local': return cyan('+');
        case 'orphaned_remote': return red('-');
    }
}

function getStatusLabel(status: DiffStatus): string {
    switch (status) {
        case 'synced': return 'synced';
        case 'modified_locally': return 'modified locally';
        case 'new_local': return 'new (not applied)';
        case 'orphaned_remote': return 'orphaned (not in config)';
    }
}

/**
 * Diff command: show drift between local configuration and state.
 * Unlike plan (which shows what apply WOULD do), diff shows the raw comparison
 * between local files and the last-applied state.
 */
interface DiffCmdOptions {
    dir?: string;
    verbose?: boolean;
    scope: IScope | 'all';
}

export const diffCmd = async (options: DiffCmdOptions) => {
    const { dir = '.', verbose = false, scope } = options;
    const logger = new Logger(verbose);

    // Load config and parse features
    const config = new Config(dir);
    const parser = new Parser(dir);
    const documents = parser.content();

    // Load state
    const state = new State(dir);
    await state.init();

    // Calculate diff
    const entries: DiffEntry[] = [];
    const scopesToRun: IScope[] = (scope as string) === 'all' ? ['testcase', 'testrun', 'testplan'] : [scope as IScope];

    for (const s of scopesToRun) {
        const data = {
            identity: config.getIdentity(s),
            fields: config.getFields(s),
        };

        const filtered = parser.filter(documents, data, s) || [];

        const resourceType = SCOPE_RESOURCE_MAP[s];
        const resources = state.getResources(resourceType);
        const stateMap = new Map(resources.map(r => [r.identity, r]));

        const localIds = new Set<string>();

        for (const scenario of filtered) {
            const rawIdentity = scenario.custom?.identity;
            if (!rawIdentity) continue;

            let identity: string;
            if (rawIdentity.includes('::')) {
                identity = rawIdentity;
            } else if (rawIdentity === scenario.uri) {
                identity = rawIdentity;
            } else {
                identity = `${scenario.uri}::${rawIdentity}`;
            }

            localIds.add(identity);
            const localHash = hashScenario(scenario, s);
            const stateRes = stateMap.get(identity);

            if (!stateRes) {
                entries.push({ identity, status: 'new_local', localHash });
            } else if (stateRes.attributes.localHash !== localHash) {
                entries.push({
                    identity,
                    status: 'modified_locally',
                    localHash,
                    stateHash: stateRes.attributes.localHash,
                    remoteId: stateRes.attributes.remoteId,
                });
            } else {
                entries.push({
                    identity,
                    status: 'synced',
                    localHash,
                    stateHash: stateRes.attributes.localHash,
                    remoteId: stateRes.attributes.remoteId,
                });
            }
        }

        for (const res of resources) {
            if (!localIds.has(res.identity)) {
                entries.push({
                    identity: res.identity,
                    status: 'orphaned_remote',
                    stateHash: res.attributes.localHash,
                    remoteId: res.attributes.remoteId,
                });
            }
        }
    }

    // Output
    console.log('');
    console.log(bold('Drift Detection Report'));
    console.log('═'.repeat(60));
    console.log('');

    const synced = entries.filter(e => e.status === 'synced').length;
    const modified = entries.filter(e => e.status === 'modified_locally').length;
    const newLocal = entries.filter(e => e.status === 'new_local').length;
    const orphaned = entries.filter(e => e.status === 'orphaned_remote').length;

    for (const entry of entries) {
        const icon = getStatusIcon(entry.status);
        const label = getStatusLabel(entry.status);
        const remoteInfo = entry.remoteId ? dim(` [id=${entry.remoteId}]`) : '';
        console.log(`  ${icon} ${bold(entry.identity)}: ${label}${remoteInfo}`);

        if (verbose && entry.status === 'modified_locally' && entry.localHash && entry.stateHash) {
            console.log(`     Local:  ${dim(entry.localHash.substring(0, 12))}...`);
            console.log(`     State:  ${dim(entry.stateHash.substring(0, 12))}...`);
        }
    }

    console.log('');
    console.log(bold('Summary:'));
    console.log(`  ${green('✓')} ${synced} synced`);
    if (modified > 0) console.log(`  ${yellow('~')} ${modified} modified locally`);
    if (newLocal > 0) console.log(`  ${cyan('+')} ${newLocal} new (not applied)`);
    if (orphaned > 0) console.log(`  ${red('-')} ${orphaned} orphaned (not in config)`);
    console.log('');
}
