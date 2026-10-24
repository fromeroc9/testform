import { createHash } from 'crypto';
import { bold, green, yellow, red, cyan, dim, gray } from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import * as readline from 'readline';
import { Config } from '../core/config';
import { Parser } from '../core/parser';
import { VariableParser } from '../core/variables';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { IScope, DiffEntry, DiffStatus, ParserScenario, StateResource } from '../core/types';
import { SCOPE_RESOURCE_MAP, TITLE_APP } from '../core/const';
import { createCommandContext } from '../core/context';
import { resolveScopes } from '../core/cli';
import { updateFeatureScenario } from '../core/editor';

export function hashScenario(scenario: ParserScenario, scope?: IScope): string {
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
        case 'synced': return green('✔');
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

export interface DiffCmdOptions {
    dir?: string;
    testDirectory?: string;
    verbose?: boolean;
    scope: IScope | 'all' | 'remote';
    remote?: boolean;
    interactive?: boolean;
    statePath?: string;
    backupPath?: string;
    variables?: VariableParser;
}

export interface RemoteDriftDifference {
    field: string;
    local: string;
    remote: string;
}

export interface RemoteDriftItem {
    identity: string;
    resourceType: string;
    issueNumber: number;
    filePath?: string;
    differences: RemoteDriftDifference[];
    isClosed?: boolean;
    remoteIssue: any;
    scenario?: ParserScenario;
}

function promptUser(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolvePrompt) => {
        rl.question(question, (answer) => resolvePrompt(answer.trim()));
    });
}

export const diffCmd = async (options: DiffCmdOptions) => {
    const {
        dir = '.',
        testDirectory,
        verbose = false,
        scope,
        remote = false,
        interactive = false,
        statePath,
        backupPath
    } = options;

    const logger = new Logger(verbose);
    const isRemote = remote || (scope as string) === 'remote';
    const effectiveScope: IScope | 'all' = (scope as string) === 'remote' ? 'all' : (scope as IScope | 'all');

    // Load config and parse features
    const config = new Config(dir);
    const parseDir = testDirectory ? resolve(dir, testDirectory) : resolve(dir);
    const vars = options.variables || new VariableParser(undefined, undefined, dir);
    const parser = new Parser(parseDir, vars);
    const documents = parser.content();

    // Load state
    const state = new State(dir, statePath, backupPath);
    await state.init();

    if (isRemote) {
        await executeRemoteDrift(dir, parseDir, effectiveScope, state, config, parser, documents, interactive, verbose);
        return;
    }

    // ── Local vs State Diff Mode ──
    const entries: DiffEntry[] = [];
    const scopesToRun = resolveScopes(effectiveScope);

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
            if (rawIdentity.startsWith(scenario.uri) || rawIdentity === scenario.uri) {
                identity = rawIdentity;
            } else {
                identity = `${scenario.uri}.${rawIdentity}`;
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
    console.log(`  ${green('✔')} ${synced} synced`);
    if (modified > 0) console.log(`  ${yellow('~')} ${modified} modified locally`);
    if (newLocal > 0) console.log(`  ${cyan('+')} ${newLocal} new (not applied)`);
    if (orphaned > 0) console.log(`  ${red('-')} ${orphaned} orphaned (not in config)`);
    console.log('');
};

async function executeRemoteDrift(
    dir: string,
    parseDir: string,
    scope: IScope | 'all',
    state: State,
    config: Config,
    parser: Parser,
    documents: ParserScenario[],
    interactive: boolean,
    verbose: boolean
) {
    console.log('');
    console.log(bold(`# ${TITLE_APP} Remote Drift Detection`));
    console.log(dim('Checking local configuration and state against live remote provider...'));
    console.log('═'.repeat(60));
    console.log('');

    const ctx = await createCommandContext({ dir, verbose, lock: false, silent: true });
    if (!ctx) {
        console.error(red('Failed to initialize provider context for remote drift check.'));
        return;
    }
    const github = ctx.adapter || (ctx as any).github;

    const scopesToRun = resolveScopes(scope as any);
    const driftedItems: RemoteDriftItem[] = [];

    for (const s of scopesToRun) {
        const resourceType = SCOPE_RESOURCE_MAP[s];
        const resources = state.getResources(resourceType);
        const filterData = { identity: config.getIdentity(s), fields: config.getFields(s) };
        const localScenarios = parser.filter(documents, filterData, s) || [];

        for (const res of resources) {
            const issueNum = res.attributes.issueNumber;
            if (!issueNum) continue;

            const matchedScenario = localScenarios.find(ls => {
                const raw = ls.custom?.identity;
                return raw === res.identity || `${ls.uri}.${raw}` === res.identity || res.identity.endsWith(raw || '');
            });

            try {
                const issue = await github.getIssue(issueNum);
                if (!issue) {
                    driftedItems.push({
                        identity: res.identity,
                        resourceType,
                        issueNumber: issueNum,
                        differences: [{ field: 'status', local: 'exists in state', remote: 'not found on remote' }],
                        remoteIssue: null,
                        scenario: matchedScenario
                    });
                    continue;
                }

                const differences: RemoteDriftDifference[] = [];
                const isClosed = issue.state === 'closed';

                if (isClosed) {
                    differences.push({ field: 'state', local: 'open/tracked', remote: 'closed on remote' });
                }

                // Check title
                const localTitle = matchedScenario?.name || res.attributes.title || '';
                if (localTitle && issue.title && localTitle.trim() !== issue.title.trim()) {
                    differences.push({ field: 'title', local: localTitle, remote: issue.title });
                }

                // Check labels
                const localLabels = Array.isArray(res.attributes.labels)
                    ? res.attributes.labels.map(l => l.replace(/^@/, '').toLowerCase()).sort()
                    : [];
                const remoteLabels = Array.isArray(issue.labels)
                    ? issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name || '').replace(/^@/, '').toLowerCase()).sort()
                    : [];

                if (JSON.stringify(localLabels) !== JSON.stringify(remoteLabels)) {
                    differences.push({
                        field: 'labels',
                        local: `[${localLabels.join(', ')}]`,
                        remote: `[${remoteLabels.join(', ')}]`
                    });
                }

                if (differences.length > 0) {
                    driftedItems.push({
                        identity: res.identity,
                        resourceType,
                        issueNumber: issueNum,
                        filePath: matchedScenario?.uri,
                        differences,
                        isClosed,
                        remoteIssue: issue,
                        scenario: matchedScenario
                    });
                }
            } catch (err: any) {
                if (verbose) console.warn(yellow(`Could not fetch issue #${issueNum}: ${err.message}`));
            }
        }
    }

    if (driftedItems.length === 0) {
        console.log(green('✔ No remote drift detected. Local configuration and state are fully synchronized with remote.'));
        console.log('');
        return;
    }

    console.log(yellow(`Found ${driftedItems.length} resource(s) with remote drift:\n`));

    for (const item of driftedItems) {
        console.log(`  ${yellow('~')} ${cyan(item.resourceType)}.${bold(item.identity)} (Issue #${item.issueNumber})`);
        for (const diff of item.differences) {
            console.log(`     Field ${bold(diff.field)}:`);
            console.log(`       - Local:  ${red(diff.local)}`);
            console.log(`       + Remote: ${green(diff.remote)}`);
        }
        console.log('');
    }

    // ── Interactive Resolution ──
    if (interactive && driftedItems.length > 0) {
        console.log(bold('Interactive Drift Resolution'));
        console.log(dim('You can choose how to handle each drifted resource.\n'));

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        try {
            for (const item of driftedItems) {
                console.log(`Action for resource ${bold(item.identity)}:`);
                console.log(`  Enter 'pull' to update local file, 'overwrite' to keep local, or 'skip' to ignore.\n`);

                const rawAns = await promptUser(rl, '  Enter a value: ');
                const answer = rawAns.toLowerCase().trim();

                if (answer === 'pull' || answer === '1') {
                    if (item.filePath && existsSync(item.filePath) && item.remoteIssue) {
                        const rawLabels = Array.isArray(item.remoteIssue.labels)
                            ? item.remoteIssue.labels.map((l: any) => typeof l === 'string' ? l : l.name || '')
                            : [];
                        const updated = updateFeatureScenario(
                            item.filePath,
                            item.scenario?.name || '',
                            item.remoteIssue.title,
                            rawLabels
                        );
                        if (updated) {
                            // Update state attributes
                            const res = state.getResources(item.resourceType).find(r => r.identity === item.identity);
                            if (res) {
                                res.attributes.title = item.remoteIssue.title;
                                res.attributes.labels = rawLabels;
                                state.upsertResource(res);
                            }
                            console.log(green(`  ✔ Updated ${item.filePath} successfully!\n`));
                        } else {
                            console.log(yellow(`  Could not write changes to ${item.filePath}\n`));
                        }
                    } else {
                        console.log(yellow(`  No local file mapped for ${item.identity}. Cannot pull automatically.\n`));
                    }
                } else if (answer === 'overwrite' || answer === '2') {
                    console.log(cyan(`  → Kept local version. Will overwrite remote on next apply.\n`));
                } else {
                    console.log(dim(`  → Skipped.\n`));
                }
            }

            await state.save();
        } finally {
            rl.close();
        }
    } else if (!interactive) {
        console.log(dim(`Tip: Run 'testform diff --remote --interactive' (or -i) to resolve drift interactively.\n`));
    }
}
