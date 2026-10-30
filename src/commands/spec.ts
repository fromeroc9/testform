import { resolve, join, basename, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { bold, green, yellow, red, cyan, gray, magenta } from 'chalk';
import { Config } from '../core/config';
import { State } from '../core/state';
import { Parser } from '../core/parser';
import { IScope } from '../core/types';
import { Diag } from '../core/diagnostics';
import { TITLE_CLI, SCOPE_CONFIG, TESTCASE_STATUSES } from '../core/const';
import { findNextIdentity, GherkinEditor } from '../core/editor';
import { VariableParser } from '../core/variables';
import { matchesScope, matchesFeatureFile } from '../core/selector';

export interface SpecCmdOptions {
    dir: string;
    resource?: string;
    action?: string;
    target?: string;
    case?: string;
    run?: string;
    title?: string;
    status?: string;
    trace?: string;
    evidence?: string;
    severity?: string;
    priority?: string;
    showName?: boolean;
    showDetail?: boolean;
    testDirectory?: string;
    statePath?: string;
    backupPath?: string;
    variables?: VariableParser;
    verbose?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusBadge(status: string = 'pending'): string {
    const s = status.toLowerCase();
    if (s === 'passed') return green('✔ passed');
    if (s === 'failed') return red('✗ failed');
    if (s === 'pending') return yellow('⧖ pending');
    if (s === 'skipped') return gray('- skipped');
    return gray(`? ${status}`);
}

function getBugBadge(status: string = 'failed'): string {
    const s = status.toLowerCase();
    if (s === 'passed') return green('✔ resolved');
    if (s === 'failed') return red('● active');
    if (s === 'pending') return yellow('⧖ in review');
    return gray(`? ${status}`);
}

function findFeatureFiles(dir: string): string[] {
    return GherkinEditor.findFeatureFiles(dir, true);
}

function resolveScopeFile(dir: string, target: string, scope: IScope, testDir?: string): string | undefined {
    const allFiles = findFeatureFiles(dir);
    const scopeExt = (SCOPE_CONFIG as any)[scope]?.ext || '';
    const scopeTag = (SCOPE_CONFIG as any)[scope]?.tag || '';

    // Check if target is a file path
    const directPath = testDir ? resolve(dir, testDir, target) : resolve(dir, target);
    if (existsSync(directPath)) return directPath;

    // Disambiguate by filename or identity tag
    const normTarget = target.trim().toLowerCase();
    for (const f of allFiles) {
        const base = basename(f).toLowerCase();
        if (base === normTarget || base.replace(/\.feature$/i, '') === normTarget) {
            return f;
        }
        // Match identity inside file
        try {
            const content = readFileSync(f, 'utf-8');
            if (content.toLowerCase().includes(normTarget)) {
                return f;
            }
        } catch {}
    }

    return undefined;
}

// ─── TESTCASE HANDLERS ───────────────────────────────────────────────────────

async function handleTestcase(options: SpecCmdOptions) {
    const { dir, action, target, title, showName, showDetail, statePath, backupPath, testDirectory } = options;
    const config = new Config(dir, false);

    switch (action) {
        case 'new': {
            const convention = config.getConvention('testcase');
            const targetDir = convention?.directory || config.getScopeConf('testcase')?.directory || 'tests/features';
            const absDir = resolve(dir, targetDir);
            if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });

            const safeTitle = title || 'Testcase Specification';
            const slug = safeTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const filename = target ? (target.endsWith('.case.feature') ? target : `${target}.case.feature`) : `${slug}.case.feature`;
            const filePath = resolve(absDir, filename);

            if (existsSync(filePath)) {
                Diag.error({
                    title: `Testcase file already exists: ${filename}`,
                    detail: [`Choose a different target name or edit ${filePath}`]
                }).abort();
                return;
            }

            const content = `@testcase\nFeature: ${safeTitle}\n\n`;
            writeFileSync(filePath, content, 'utf-8');
            console.log(green(bold(`\n✓ Created testcase specification: ${filePath}`)));
            break;
        }

        case 'add': {
            if (!target) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec testcase add -target=<file> [-title="Scenario title"]`,
                    detail: [`Specify -target to indicate which .case.feature file to add the scenario into.`]
                }).abort();
                return;
            }

            const filePath = resolveScopeFile(dir, target, 'testcase', testDirectory);
            if (!filePath || !existsSync(filePath)) {
                Diag.error({
                    title: `Testcase file not found for target: ${target}`,
                    detail: [`Verify the file path or name.`]
                }).abort();
                return;
            }

            const idPattern = config.getIdentity('testcase');
            const nextTag = findNextIdentity(dir, idPattern) || '@tc-1';
            const scTitle = title || `Scenario ${nextTag}`;

            const scenarioContent = `\n  ${nextTag}\n  Scenario: ${scTitle}\n    Given a precondition\n    When an action is performed\n    Then verify the expected result\n`;
            writeFileSync(filePath, readFileSync(filePath, 'utf-8').trimEnd() + scenarioContent, 'utf-8');
            console.log(green(bold(`\n✓ Added scenario ${nextTag} "${scTitle}" to ${basename(filePath)}`)));
            break;
        }

        case 'delete': {
            if (!target) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec testcase delete -target=<@tc-X|file>`,
                    detail: [`Specify -target with the scenario identity tag or file to remove.`]
                }).abort();
                return;
            }

            if (target.endsWith('.case.feature') || target.endsWith('.feature')) {
                const filePath = resolveScopeFile(dir, target, 'testcase', testDirectory);
                if (filePath && existsSync(filePath)) {
                    unlinkSync(filePath);
                    console.log(green(bold(`\n✓ Deleted testcase file: ${filePath}`)));
                    return;
                }
            }

            // Remove scenario by tag or name
            const allFiles = findFeatureFiles(dir);
            let found = false;
            for (const f of allFiles) {
                const content = readFileSync(f, 'utf-8');
                if (content.includes(target)) {
                    const lines = content.split('\n');
                    const newLines: string[] = [];
                    let i = 0;
                    while (i < lines.length) {
                        const line = lines[i];
                        const trimmed = line.trim();
                        if (trimmed.startsWith('@') && lines.slice(i, i + 2).some(l => l.includes(target))) {
                            i++;
                            if (i < lines.length && lines[i].trim().startsWith('Scenario:')) {
                                i++;
                            }
                            while (i < lines.length) {
                                const nextTrimmed = lines[i].trim();
                                if (nextTrimmed.startsWith('@') || nextTrimmed.startsWith('Scenario:') || nextTrimmed.startsWith('Rule:') || nextTrimmed.startsWith('Feature:')) {
                                    break;
                                }
                                i++;
                            }
                            found = true;
                            continue;
                        } else if (trimmed.startsWith('Scenario:') && line.includes(target)) {
                            i++;
                            while (i < lines.length) {
                                const nextTrimmed = lines[i].trim();
                                if (nextTrimmed.startsWith('@') || nextTrimmed.startsWith('Scenario:') || nextTrimmed.startsWith('Rule:') || nextTrimmed.startsWith('Feature:')) {
                                    break;
                                }
                                i++;
                            }
                            found = true;
                            continue;
                        }
                        newLines.push(line);
                        i++;
                    }
                    if (found) {
                        writeFileSync(f, newLines.join('\n'), 'utf-8');
                        console.log(green(bold(`\n✓ Deleted scenario matching ${target} from ${basename(f)}`)));
                        break;
                    }
                }
            }

            if (!found) {
                Diag.error({
                    title: `Scenario or file matching "${target}" not found.`,
                    detail: [`Verify the target identity tag or filename.`]
                }).abort();
            }
            break;
        }

        case 'status': {
            // Reverse lookup: query testruns and bugs linked to this testcase!
            const state = new State(dir, statePath, backupPath);
            await state.init();

            const testruns = state.getResources('github_testrun');
            const bugs = state.getResources('github_bug');
            const testcases = state.getResources('github_testcase');

            if (target) {
                const cleanTarget = target.trim();
                const matchedTc = testcases.find((tc: any) => {
                    const normId = (tc.identity || '').replace(/\\/g, '/');
                    const cleanT = cleanTarget.replace(/\\/g, '/');
                    return normId === cleanT || normId.endsWith(cleanT) || cleanT.endsWith(normId) ||
                           (tc.attributes?.title && tc.attributes.title.toLowerCase() === cleanTarget.toLowerCase());
                });

                const tcDisplayName = (matchedTc && showName && matchedTc.attributes?.title) ? matchedTc.attributes.title : (matchedTc?.identity || cleanTarget);
                const tcTitle = matchedTc?.attributes?.title || 'Unknown title';
                const tcTags = (matchedTc?.attributes?.labels || []).join(' ') || '';

                console.log(bold(`\n======================================================================`));
                console.log(`${bold('TESTCASE:')} ${cyan(tcDisplayName)}`);
                if (showName && matchedTc?.identity) {
                    console.log(`${bold('Address:')}  ${gray(matchedTc.identity)}`);
                }
                console.log(`${bold('Title:')}    ${tcTitle}`);
                if (tcTags) console.log(`${bold('Tags:')}     ${tcTags}`);
                console.log(`----------------------------------------------------------------------`);
                console.log(bold(`EXECUTION HISTORY (Runs):`));

                let runMatches = 0;
                for (const tr of testruns) {
                    const tcMap = ((tr.attributes as any)?.testcases || (tr.attributes as any)?.testcaseStatuses || {}) as Record<string, string>;
                    const traces = ((tr.attributes as any)?.testcaseTraces || {}) as Record<string, string>;
                    const evidences = ((tr.attributes as any)?.testcaseEvidence || {}) as Record<string, any>;

                    const matchedKey = Object.keys(tcMap).find(k => {
                        const normK = k.replace(/\\/g, '/');
                        const normTarget = cleanTarget.replace(/\\/g, '/');
                        return normK === normTarget || normK.endsWith(normTarget) || normTarget.endsWith(normK);
                    });

                    if (matchedKey) {
                        runMatches++;
                        const verdict = tcMap[matchedKey];
                        const runTitle = (showName && tr.attributes?.title) ? tr.attributes.title : tr.identity;
                        console.log(`  ${getStatusBadge(verdict)}  ${bold(runTitle)} -> ${verdict}`);

                        if (showDetail) {
                            if (traces[matchedKey]) {
                                console.log(`      ${red('Trace:')} ${traces[matchedKey]}`);
                            }
                            if (evidences[matchedKey]) {
                                const evList = Array.isArray(evidences[matchedKey]) ? evidences[matchedKey] : [evidences[matchedKey]];
                                console.log(`      ${cyan('Evidence:')} ${evList.join(', ')}`);
                            }
                        }
                    }
                }

                if (runMatches === 0) {
                    console.log(`  ${gray('No recorded run executions found in state.')}`);
                }

                console.log(`----------------------------------------------------------------------`);
                console.log(bold(`LINKED BUGS:`));

                let bugMatches = 0;
                for (const bg of bugs) {
                    const linkedTc = bg.attributes?.testcase || bg.attributes?.custom_fields?.target || '';
                    const normLinked = linkedTc.replace(/\\/g, '/');
                    const normTarget = cleanTarget.replace(/\\/g, '/');

                    if (normLinked && (normLinked === normTarget || normLinked.endsWith(normTarget) || normTarget.endsWith(normLinked))) {
                        bugMatches++;
                        const bgStatus = bg.attributes?.status || 'failed';
                        const bgTitle = (showName && bg.attributes?.title) ? bg.attributes.title : bg.identity;
                        const sev = bg.attributes?.severity || bg.attributes?.custom_fields?.severity || 'unspecified';
                        const prio = bg.attributes?.priority || bg.attributes?.custom_fields?.priority || 'unspecified';

                        console.log(`  ${getBugBadge(bgStatus)}  ${bold(bgTitle)} [${bgStatus}] (Severity: ${sev}, Priority: ${prio})`);

                        if (showDetail) {
                            if (bg.attributes?.trace) {
                                console.log(`      ${red('Trace:')} ${bg.attributes.trace}`);
                            }
                            const bgEv = (bg.attributes as any)?.evidence;
                            if (Array.isArray(bgEv) && bgEv.length > 0) {
                                console.log(`      ${cyan('Evidence:')} ${bgEv.join(', ')}`);
                            }
                        }
                    }
                }

                if (bugMatches === 0) {
                    console.log(`  ${gray('No linked bugs found in state.')}`);
                }

                console.log(`======================================================================\n`);
            } else {
                // List all testcases with execution summary
                console.log(bold(`\n${cyan('Testcase Specifications Summary:')}`));
                if (testcases.length === 0) {
                    console.log(yellow(`  No testcases found in state. Run \`${TITLE_CLI} apply\` or specify -target.`));
                    return;
                }

                for (const tc of testcases) {
                    const tcDisplayName = (showName && tc.attributes?.title) ? tc.attributes.title : tc.identity;
                    let lastVerdict = 'untested';
                    for (const tr of testruns) {
                        const tcMap = tr.attributes?.testcases || tr.attributes?.testcaseStatuses || {};
                        const kMatch = Object.keys(tcMap).find(k => k === tc.identity || tc.identity.endsWith(k));
                        if (kMatch) lastVerdict = tcMap[kMatch];
                    }
                    console.log(`  ${getStatusBadge(lastVerdict)}  ${tcDisplayName}`);
                }
                console.log('');
            }
            break;
        }

        default:
            printResourceUsage('testcase');
    }
}

// ─── TESTRUN HANDLERS ────────────────────────────────────────────────────────

async function handleTestrun(options: SpecCmdOptions) {
    const { dir, action, target, case: tcArg, title, status = 'pending', trace, evidence, showName, showDetail, statePath, backupPath, testDirectory } = options;
    const config = new Config(dir, false);

    switch (action) {
        case 'new': {
            const convention = config.getConvention('testrun');
            const targetDir = convention?.directory || config.getScopeConf('testrun')?.directory || 'tests/runs';
            const absDir = resolve(dir, targetDir);
            if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });

            const now = new Date();
            const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
            const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');
            const idPattern = config.getIdentity('testrun');
            const trTag = findNextIdentity(dir, idPattern) || '@tr-1';

            const runTitle = title || `Test Run ${trTag}`;
            const filename = target ? (target.endsWith('.run.feature') ? target : `${target}.run.feature`) : `${YYYYMMDD}_${HHmmss}.run.feature`;
            const filePath = resolve(absDir, filename);

            const content = `@testrun ${trTag}\nFeature: ${runTitle}\n\n`;
            writeFileSync(filePath, content, 'utf-8');
            console.log(green(bold(`\n✓ Created testrun specification: ${filePath}`)));
            break;
        }

        case 'add': {
            if (!target || !tcArg) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec testrun add -target=<@tr-X|file> -case=<testcase_address> [-status=pending]`,
                    detail: [`Specify -target for the testrun and -case for the testcase to link.`]
                }).abort();
                return;
            }

            const filePath = resolveScopeFile(dir, target, 'testrun', testDirectory);
            if (!filePath || !existsSync(filePath)) {
                Diag.error({
                    title: `Testrun file not found for target: ${target}`,
                    detail: [`Verify the target run identifier or file.`]
                }).abort();
                return;
            }

            const scenarioContent = `\n  Scenario: ${tcArg}\n    * mark status = ${status}\n`;
            writeFileSync(filePath, readFileSync(filePath, 'utf-8').trimEnd() + scenarioContent, 'utf-8');
            console.log(green(bold(`\n✓ Linked testcase ${tcArg} to testrun ${basename(filePath)} with status ${status}`)));
            break;
        }

        case 'delete': {
            if (!target) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec testrun delete -target=<@tr-X|file> [-case=<testcase_address>]`,
                    detail: [`Specify -target to remove a testrun or -case to remove a testcase from the run.`]
                }).abort();
                return;
            }

            const filePath = resolveScopeFile(dir, target, 'testrun', testDirectory);
            if (!filePath || !existsSync(filePath)) {
                Diag.error({ title: `Testrun file not found for target: ${target}`, detail: [] }).abort();
                return;
            }

            if (!tcArg) {
                unlinkSync(filePath);
                console.log(green(bold(`\n✓ Deleted testrun file: ${filePath}`)));
                return;
            }

            // Remove case scenario from run
            const content = readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const newLines: string[] = [];
            let skipping = false;
            for (const line of lines) {
                if (line.includes(`Scenario: ${tcArg}`) || line.includes(`Scenario: ${tcArg.replace(/^@/, '')}`)) {
                    skipping = true;
                    continue;
                }
                if (skipping) {
                    if (line.trim().startsWith('Scenario:') || line.trim().startsWith('Rule:') || line.trim().startsWith('@')) {
                        skipping = false;
                    } else {
                        continue;
                    }
                }
                newLines.push(line);
            }
            writeFileSync(filePath, newLines.join('\n'), 'utf-8');
            console.log(green(bold(`\n✓ Removed testcase ${tcArg} from testrun ${basename(filePath)}`)));
            break;
        }

        case 'mark': {
            if (!target || !tcArg) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec testrun mark -target=<@tr-X|file> -case=<testcase_address> -status=<passed|failed|pending|skipped> [-trace="..."] [-evidence="..."]`,
                    detail: [`Record execution status, stack trace, and evidence for a testcase inside a testrun.`]
                }).abort();
                return;
            }

            const filePath = resolveScopeFile(dir, target, 'testrun', testDirectory);
            if (!filePath || !existsSync(filePath)) {
                Diag.error({ title: `Testrun file not found for target: ${target}`, detail: [] }).abort();
                return;
            }

            const content = readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const newLines: string[] = [];
            let inTargetScenario = false;
            let foundScenario = false;
            let statusUpdated = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim().startsWith('Scenario:') && (line.includes(tcArg) || line.includes(tcArg.replace(/^@/, '')))) {
                    inTargetScenario = true;
                    foundScenario = true;
                    newLines.push(line);
                    continue;
                }

                if (inTargetScenario) {
                    if (line.trim().startsWith('Scenario:') || line.trim().startsWith('Rule:') || (line.trim().startsWith('@') && !line.includes('mark'))) {
                        // Exiting target scenario
                        inTargetScenario = false;
                    } else {
                        if (line.includes('mark status =')) {
                            newLines.push(`    * mark status = ${status}`);
                            statusUpdated = true;
                            if (trace) newLines.push(`    * mark trace = ${trace.split('\n')[0]}`);
                            if (evidence) newLines.push(`    * mark evidence = ${evidence}`);
                            continue;
                        }
                        if (line.includes('mark trace =') || line.includes('mark evidence =')) {
                            // Skipped; replaced above
                            continue;
                        }
                    }
                }

                newLines.push(line);
            }

            if (!foundScenario) {
                // Scenario not found, append it!
                newLines.push(`\n  Scenario: ${tcArg}`);
                newLines.push(`    * mark status = ${status}`);
                if (trace) newLines.push(`    * mark trace = ${trace.split('\n')[0]}`);
                if (evidence) newLines.push(`    * mark evidence = ${evidence}`);
            } else if (!statusUpdated) {
                // Scenario existed but had no mark step
                const scIdx = newLines.findIndex(l => l.includes(`Scenario: ${tcArg}`));
                if (scIdx !== -1) {
                    newLines.splice(scIdx + 1, 0, `    * mark status = ${status}`);
                    if (trace) newLines.splice(scIdx + 2, 0, `    * mark trace = ${trace.split('\n')[0]}`);
                    if (evidence) newLines.splice(scIdx + 3, 0, `    * mark evidence = ${evidence}`);
                }
            }

            writeFileSync(filePath, newLines.join('\n'), 'utf-8');
            console.log(green(bold(`\n✓ Marked testcase ${tcArg} as ${status} in ${basename(filePath)}`)));
            break;
        }

        case 'status': {
            const state = new State(dir, statePath, backupPath);
            await state.init();

            const testruns = state.getResources('github_testrun');
            const testcases = state.getResources('github_testcase');

            if (target) {
                const cleanTarget = target.trim();
                const tr = testruns.find((r: any) => {
                    const normId = (r.identity || '').replace(/\\/g, '/');
                    return normId === cleanTarget || normId.endsWith(cleanTarget) || cleanTarget.endsWith(normId) ||
                           (r.attributes?.title && r.attributes.title.toLowerCase() === cleanTarget.toLowerCase());
                });

                if (!tr) {
                    Diag.error({
                        title: `Testrun not found in state: ${target}`,
                        detail: [`Run \`${TITLE_CLI} apply\` first to synchronize the testrun into state.`]
                    }).abort();
                    return;
                }

                const tcMap = ((tr.attributes as any)?.testcases || (tr.attributes as any)?.testcaseStatuses || {}) as Record<string, string>;
                const traces = ((tr.attributes as any)?.testcaseTraces || {}) as Record<string, string>;
                const evidences = ((tr.attributes as any)?.testcaseEvidence || {}) as Record<string, any>;
                const keys = Object.keys(tcMap);

                const counts = { total: keys.length, passed: 0, failed: 0, pending: 0, skipped: 0 };
                keys.forEach(k => {
                    const st = (tcMap[k] || 'pending').toLowerCase();
                    if (st === 'passed') counts.passed++;
                    else if (st === 'failed') counts.failed++;
                    else if (st === 'skipped') counts.skipped++;
                    else counts.pending++;
                });

                const runDisplayName = (showName && tr.attributes?.title) ? tr.attributes.title : tr.identity;
                console.log(bold(`\n======================================================================`));
                console.log(`${bold('TESTRUN:')} ${cyan(runDisplayName)}`);
                if (showName && tr.identity) {
                    console.log(`${bold('Address:')} ${gray(tr.identity)}`);
                }
                console.log(`${bold('Title:')}   ${tr.attributes?.title || 'Unknown title'}`);
                console.log(`${bold('Status:')}  Total: ${counts.total} | ${green('Passed: ' + counts.passed)} | ${red('Failed: ' + counts.failed)} | ${yellow('Pending: ' + counts.pending)} | ${gray('Skipped: ' + counts.skipped)}`);
                console.log(`----------------------------------------------------------------------`);
                console.log(bold(`SCENARIO BREAKDOWN:`));

                for (const k of keys) {
                    const verdict = tcMap[k] || 'pending';
                    const tcRes = testcases.find((t: any) => t.identity === k || k.endsWith(t.identity) || t.identity?.endsWith(k));
                    const displayName = (showName && tcRes?.attributes?.title) ? tcRes.attributes.title : k;

                    console.log(`  ${getStatusBadge(verdict)}  ${displayName}`);
                    if (showDetail) {
                        if (traces[k]) console.log(`      ${red('Trace:')} ${traces[k]}`);
                        if (evidences[k]) {
                            const evList = Array.isArray(evidences[k]) ? evidences[k] : [evidences[k]];
                            console.log(`      ${cyan('Evidence:')} ${evList.join(', ')}`);
                        }
                    }
                }
                console.log(`======================================================================\n`);
            } else {
                console.log(bold(`\n${cyan('Testruns Overview:')}`));
                if (testruns.length === 0) {
                    console.log(yellow(`  No testruns found in state. Run \`${TITLE_CLI} apply\` first.`));
                    return;
                }

                for (const tr of testruns) {
                    const runTitle = (showName && tr.attributes?.title) ? tr.attributes.title : tr.identity;
                    const tcMap = tr.attributes?.testcases || tr.attributes?.testcaseStatuses || {};
                    const total = Object.keys(tcMap).length;
                    const passed = Object.values(tcMap).filter(v => v === 'passed').length;
                    const failed = Object.values(tcMap).filter(v => v === 'failed').length;
                    console.log(`  ${cyan(runTitle)} - Total: ${total} [${green('Passed: ' + passed)}, ${red('Failed: ' + failed)}]`);
                }
                console.log('');
            }
            break;
        }

        default:
            printResourceUsage('testrun');
    }
}

// ─── TESTPLAN HANDLERS ───────────────────────────────────────────────────────

async function handleTestplan(options: SpecCmdOptions) {
    const { dir, action, target, run: runArg, title, showName, showDetail, statePath, backupPath, testDirectory } = options;
    const config = new Config(dir, false);

    switch (action) {
        case 'new': {
            const convention = config.getConvention('testplan');
            const targetDir = convention?.directory || config.getScopeConf('testplan')?.directory || 'tests/plans';
            const absDir = resolve(dir, targetDir);
            if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });

            const idPattern = config.getIdentity('testplan');
            const tpTag = findNextIdentity(dir, idPattern) || '@tp-1';
            const planTitle = title || `Test Plan ${tpTag}`;
            const filename = target ? (target.endsWith('.plan.feature') ? target : `${target}.plan.feature`) : `plan_${tpTag.replace('@', '')}.plan.feature`;
            const filePath = resolve(absDir, filename);

            const content = `@testplan ${tpTag}\nFeature: ${planTitle}\n\n`;
            writeFileSync(filePath, content, 'utf-8');
            console.log(green(bold(`\n✓ Created testplan specification: ${filePath}`)));
            break;
        }

        case 'add': {
            if (!target || !runArg) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec testplan add -target=<@tp-X|file> -run=<testrun_address>`,
                    detail: [`Specify -target for the testplan and -run for the testrun to link.`]
                }).abort();
                return;
            }

            const filePath = resolveScopeFile(dir, target, 'testplan', testDirectory);
            if (!filePath || !existsSync(filePath)) {
                Diag.error({ title: `Testplan file not found for target: ${target}`, detail: [] }).abort();
                return;
            }

            const scenarioContent = `\n  Scenario: ${runArg}\n`;
            writeFileSync(filePath, readFileSync(filePath, 'utf-8').trimEnd() + scenarioContent, 'utf-8');
            console.log(green(bold(`\n✓ Linked testrun ${runArg} to testplan ${basename(filePath)}`)));
            break;
        }

        case 'delete': {
            if (!target) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec testplan delete -target=<@tp-X|file> [-run=<testrun_address>]`,
                    detail: [`Specify -target to remove a testplan or -run to remove a run from the plan.`]
                }).abort();
                return;
            }

            const filePath = resolveScopeFile(dir, target, 'testplan', testDirectory);
            if (!filePath || !existsSync(filePath)) {
                Diag.error({ title: `Testplan file not found for target: ${target}`, detail: [] }).abort();
                return;
            }

            if (!runArg) {
                unlinkSync(filePath);
                console.log(green(bold(`\n✓ Deleted testplan file: ${filePath}`)));
                return;
            }

            const content = readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').filter(l => !l.includes(`Scenario: ${runArg}`));
            writeFileSync(filePath, lines.join('\n'), 'utf-8');
            console.log(green(bold(`\n✓ Removed testrun ${runArg} from testplan ${basename(filePath)}`)));
            break;
        }

        case 'status': {
            const state = new State(dir, statePath, backupPath);
            await state.init();

            const testplans = state.getResources('github_testplan');
            const testruns = state.getResources('github_testrun');

            if (target) {
                const cleanTarget = target.trim();
                const plan = testplans.find((p: any) => {
                    const normId = (p.identity || '').replace(/\\/g, '/');
                    return normId === cleanTarget || normId.endsWith(cleanTarget) || cleanTarget.endsWith(normId) ||
                           (p.attributes?.title && p.attributes.title.toLowerCase() === cleanTarget.toLowerCase());
                });

                if (!plan) {
                    Diag.error({ title: `Testplan not found in state: ${target}`, detail: [] }).abort();
                    return;
                }

                const planDisplayName = (showName && plan.attributes?.title) ? plan.attributes.title : plan.identity;
                console.log(bold(`\n======================================================================`));
                console.log(`${bold('TESTPLAN:')} ${cyan(planDisplayName)}`);
                if (showName && plan.identity) {
                    console.log(`${bold('Address:')}  ${gray(plan.identity)}`);
                }
                console.log(`${bold('Title:')}    ${plan.attributes?.title || 'Unknown title'}`);
                console.log(`----------------------------------------------------------------------`);
                console.log(bold(`LINKED TESTRUNS:`));

                const rawPlanRuns = (plan.attributes as any)?.testruns;
                const planRuns: string[] = Array.isArray(rawPlanRuns) ? rawPlanRuns : Object.keys(rawPlanRuns || {});
                let planTotal = 0;
                let planPassed = 0;
                let planFailed = 0;

                for (const rKey of planRuns) {
                    const tr = testruns.find((r: any) => r.identity === rKey || r.identity.endsWith(rKey) || rKey.endsWith(r.identity));
                    const rTitle = (showName && tr?.attributes?.title) ? tr.attributes.title : rKey;
                    const tcMap = tr?.attributes?.testcases || tr?.attributes?.testcaseStatuses || {};
                    const rTotal = Object.keys(tcMap).length;
                    const rPassed = Object.values(tcMap).filter(v => v === 'passed').length;
                    const rFailed = Object.values(tcMap).filter(v => v === 'failed').length;

                    planTotal += rTotal;
                    planPassed += rPassed;
                    planFailed += rFailed;

                    console.log(`  ${cyan('▶')} ${bold(rTitle)} - Cases: ${rTotal} [${green('Passed: ' + rPassed)}, ${red('Failed: ' + rFailed)}]`);

                    if (showDetail && tr) {
                        for (const [tcId, st] of Object.entries(tcMap)) {
                            console.log(`      ${getStatusBadge(st as string)}  ${tcId}`);
                        }
                    }
                }

                console.log(`----------------------------------------------------------------------`);
                console.log(`${bold('Aggregate Progress:')} Total: ${planTotal} | ${green('Passed: ' + planPassed)} | ${red('Failed: ' + planFailed)}`);
                console.log(`======================================================================\n`);
            } else {
                console.log(bold(`\n${cyan('Testplans Overview:')}`));
                for (const tp of testplans) {
                    const titleStr = (showName && tp.attributes?.title) ? tp.attributes.title : tp.identity;
                    console.log(`  ${cyan(titleStr)} - Linked runs: ${(tp.attributes?.testruns || []).length}`);
                }
                console.log('');
            }
            break;
        }

        default:
            printResourceUsage('testplan');
    }
}

// ─── BUG HANDLERS ────────────────────────────────────────────────────────────

async function handleBug(options: SpecCmdOptions) {
    const { dir, action, target, case: tcArg, run: runArg, title, status = 'failed', severity, priority, trace, evidence, showName, showDetail, statePath, backupPath, testDirectory } = options;
    const config = new Config(dir, false);

    switch (action) {
        case 'new': {
            const convention = config.getConvention('bug');
            const targetDir = convention?.directory || config.getScopeConf('bug')?.directory || 'tests/bugs';
            const absDir = resolve(dir, targetDir);
            if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });

            const now = new Date();
            const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
            const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');

            const bugTitle = title || (runArg ? `Bugs from ${runArg}` : `Defect Container ${YYYYMMDD}`);
            const filename = target ? (target.endsWith('.bug.feature') ? target : `${target}.bug.feature`) : `${YYYYMMDD}_${HHmmss}.bug.feature`;
            const filePath = resolve(absDir, filename);

            const content = `@bug\nFeature: ${bugTitle}\n\n`;
            writeFileSync(filePath, content, 'utf-8');
            console.log(green(bold(`\n✓ Created bug specification: ${filePath}`)));
            break;
        }

        case 'add': {
            const targetFile = target || runArg;
            if (!targetFile) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec bug add -target=<file> [-case=<testcase_address>] [-title="Bug title"] [-status=failed] [-severity=critical|high|medium|low] [-priority=high|medium|low]`,
                    detail: [`Add a new bug scenario to a bug specification file.`]
                }).abort();
                return;
            }

            const filePath = resolveScopeFile(dir, targetFile, 'bug', testDirectory);
            if (!filePath || !existsSync(filePath)) {
                Diag.error({ title: `Bug specification file not found for target: ${targetFile}`, detail: [] }).abort();
                return;
            }

            const idPattern = config.getIdentity('bug');
            const bgTag = findNextIdentity(dir, idPattern) || '@bg-1';
            const bugScenarioTitle = title || (tcArg ? `Defect in ${tcArg}` : `Bug ${bgTag}`);

            let sc = `\n  ${bgTag}\n  Scenario: ${bugScenarioTitle}\n`;
            if (tcArg) sc += `    * mark target = ${tcArg}\n`;
            sc += `    * mark status = ${status}\n`;
            if (severity) sc += `    * mark severity = ${severity}\n`;
            if (priority) sc += `    * mark priority = ${priority}\n`;
            if (trace) sc += `    * mark trace = ${trace.split('\n')[0]}\n`;
            if (evidence) sc += `    * mark evidence = ${evidence}\n`;

            writeFileSync(filePath, readFileSync(filePath, 'utf-8').trimEnd() + sc, 'utf-8');
            console.log(green(bold(`\n✓ Added bug scenario ${bgTag} "${bugScenarioTitle}" to ${basename(filePath)}`)));
            break;
        }

        case 'delete': {
            if (!target) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec bug delete -target=<@bg-X|file>`,
                    detail: [`Specify -target to remove a bug scenario or bug specification file.`]
                }).abort();
                return;
            }

            if (target.endsWith('.bug.feature') || target.endsWith('.feature')) {
                const filePath = resolveScopeFile(dir, target, 'bug', testDirectory);
                if (filePath && existsSync(filePath)) {
                    unlinkSync(filePath);
                    console.log(green(bold(`\n✓ Deleted bug file: ${filePath}`)));
                    return;
                }
            }

            const allFiles = findFeatureFiles(dir);
            let found = false;
            for (const f of allFiles) {
                const content = readFileSync(f, 'utf-8');
                if (content.includes(target)) {
                    const lines = content.split('\n');
                    const newLines: string[] = [];
                    let i = 0;
                    while (i < lines.length) {
                        const line = lines[i];
                        const trimmed = line.trim();
                        if (trimmed.startsWith('@') && lines.slice(i, i + 2).some(l => l.includes(target))) {
                            i++;
                            if (i < lines.length && lines[i].trim().startsWith('Scenario:')) {
                                i++;
                            }
                            while (i < lines.length) {
                                const nextTrimmed = lines[i].trim();
                                if (nextTrimmed.startsWith('@') || nextTrimmed.startsWith('Scenario:') || nextTrimmed.startsWith('Rule:') || nextTrimmed.startsWith('Feature:')) {
                                    break;
                                }
                                i++;
                            }
                            found = true;
                            continue;
                        } else if (trimmed.startsWith('Scenario:') && line.includes(target)) {
                            i++;
                            while (i < lines.length) {
                                const nextTrimmed = lines[i].trim();
                                if (nextTrimmed.startsWith('@') || nextTrimmed.startsWith('Scenario:') || nextTrimmed.startsWith('Rule:') || nextTrimmed.startsWith('Feature:')) {
                                    break;
                                }
                                i++;
                            }
                            found = true;
                            continue;
                        }
                        newLines.push(line);
                        i++;
                    }
                    if (found) {
                        writeFileSync(f, newLines.join('\n'), 'utf-8');
                        console.log(green(bold(`\n✓ Deleted bug scenario ${target} from ${basename(f)}`)));
                        break;
                    }
                }
            }

            if (!found) {
                Diag.error({ title: `Bug scenario or file matching "${target}" not found.`, detail: [] }).abort();
            }
            break;
        }

        case 'mark': {
            if (!target) {
                Diag.usage({
                    syntax: `${TITLE_CLI} spec bug mark -target=<@bg-X> -status=<failed|passed|pending> [-trace="..."] [-evidence="..."]`,
                    detail: [`Update resolution status, stack trace, and evidence for a bug scenario.`]
                }).abort();
                return;
            }

            const allFiles = findFeatureFiles(dir);
            let updated = false;

            for (const f of allFiles) {
                const content = readFileSync(f, 'utf-8');
                if (content.includes(target)) {
                    const lines = content.split('\n');
                    const newLines: string[] = [];
                    let inBug = false;

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (line.includes(target) && (line.trim().startsWith('@') || line.trim().startsWith('Scenario:'))) {
                            inBug = true;
                            newLines.push(line);
                            continue;
                        }
                        if (inBug) {
                            if (line.trim().startsWith('@') || line.trim().startsWith('Feature:') ||
                                (line.trim().startsWith('Scenario:') && !lines[i - 1]?.trim().startsWith('@'))) {
                                inBug = false;
                            } else if (line.includes('mark status =')) {
                                newLines.push(`    * mark status = ${status}`);
                                if (trace) newLines.push(`    * mark trace = ${trace.split('\n')[0]}`);
                                if (evidence) newLines.push(`    * mark evidence = ${evidence}`);
                                updated = true;
                                continue;
                            } else if (line.includes('mark trace =') || line.includes('mark evidence =')) {
                                continue;
                            }
                        }
                        newLines.push(line);
                    }

                    if (updated) {
                        writeFileSync(f, newLines.join('\n'), 'utf-8');
                        console.log(green(bold(`\n✓ Updated bug ${target} status to ${status} in ${basename(f)}`)));
                        break;
                    }
                }
            }

            if (!updated) {
                Diag.error({ title: `Bug scenario ${target} not found to update.`, detail: [] }).abort();
            }
            break;
        }

        case 'status': {
            const state = new State(dir, statePath, backupPath);
            await state.init();

            const bugs = state.getResources('github_bug');
            const testcases = state.getResources('github_testcase');

            if (target) {
                const cleanTarget = target.trim();
                const bug = bugs.find((b: any) => {
                    const normId = (b.identity || '').replace(/\\/g, '/');
                    return normId === cleanTarget || normId.endsWith(cleanTarget) || cleanTarget.endsWith(normId);
                });

                if (!bug) {
                    Diag.error({ title: `Bug not found in state: ${target}`, detail: [] }).abort();
                    return;
                }

                const bStatus = bug.attributes?.status || 'failed';
                const bTitle = (showName && bug.attributes?.title) ? bug.attributes.title : bug.identity;
                const linkedTc = bug.attributes?.testcase || bug.attributes?.custom_fields?.target || 'none';
                const tcRes = testcases.find((t: any) => t.identity === linkedTc || linkedTc.endsWith(t.identity));
                const tcDisplayName = (showName && tcRes?.attributes?.title) ? tcRes.attributes.title : linkedTc;

                console.log(bold(`\n======================================================================`));
                console.log(`${bold('BUG:')}        ${cyan(bTitle)}`);
                if (showName && bug.identity) {
                    console.log(`${bold('Address:')}    ${gray(bug.identity)}`);
                }
                console.log(`${bold('Status:')}     ${getBugBadge(bStatus)} (${bStatus})`);
                console.log(`${bold('Testcase:')}   ${tcDisplayName}`);
                console.log(`${bold('Severity:')}   ${bug.attributes?.severity || bug.attributes?.custom_fields?.severity || 'unspecified'}`);
                console.log(`${bold('Priority:')}   ${bug.attributes?.priority || bug.attributes?.custom_fields?.priority || 'unspecified'}`);

                if (showDetail) {
                    if (bug.attributes?.trace) console.log(`${bold('Trace:')}      ${red(bug.attributes.trace)}`);
                    const bEv = (bug.attributes as any)?.evidence;
                    if (Array.isArray(bEv) && bEv.length > 0) {
                        console.log(`${bold('Evidence:')}   ${cyan(bEv.join(', '))}`);
                    }
                }
                console.log(`======================================================================\n`);
            } else {
                console.log(bold(`\n${cyan('Defects / Bugs Overview:')}`));
                if (bugs.length === 0) {
                    console.log(green(`  No bugs recorded in state.`));
                    return;
                }

                for (const b of bugs) {
                    const bStatus = b.attributes?.status || 'failed';
                    const bTitle = (showName && b.attributes?.title) ? b.attributes.title : b.identity;
                    const sev = b.attributes?.severity || b.attributes?.custom_fields?.severity || 'medium';
                    console.log(`  ${getBugBadge(bStatus)}  ${cyan(bTitle)} (Severity: ${sev})`);
                }
                console.log('');
            }
            break;
        }

        default:
            printResourceUsage('bug');
    }
}

// ─── Help & Usage ────────────────────────────────────────────────────────────

function printResourceUsage(resource: string) {
    Diag.usage({
        syntax: `${TITLE_CLI} spec ${resource} <action> [options]`,
        detail: [
            `Available actions for ${resource}: new, add, delete, status${resource === 'testrun' || resource === 'bug' ? ', mark' : ''}`,
            ``,
            `Examples:`,
            `  ${TITLE_CLI} spec ${resource} new -title="Title"`,
            `  ${TITLE_CLI} spec ${resource} status -show-name -show-detail`,
        ]
    }).abort();
}

function printGeneralUsage() {
    Diag.usage({
        syntax: `${TITLE_CLI} spec <resource> <action> [options]`,
        detail: [
            `Manage test lifecycle specifications and executions across all resources.`,
            ``,
            `Available Resources:`,
            `  testcase   - Author, organize, and query testcase specifications`,
            `  testrun    - Plan, link testcases, record executions, and review run dashboards`,
            `  testplan   - Coordinate testruns into master test plans and rollup metrics`,
            `  bug        - Track defects, link failures to testcases, and manage resolutions`,
            ``,
            `Standard Actions:`,
            `  new        - Generate a new specification file for the resource`,
            `  add        - Append a scenario or linkage to an existing specification`,
            `  delete     - Remove a specification file or scenario`,
            `  mark       - Record execution status, traces, and evidence (testrun, bug)`,
            `  status     - Display terminal status, dashboards, or reverse lookup (all)`,
            ``,
            `Options:`,
            `  -target       Target identifier, tag, or file path`,
            `  -case         Target testcase address or tag`,
            `  -run          Target testrun address or tag`,
            `  -title        Title for the specification or scenario`,
            `  -status       Execution or defect verdict (passed, failed, pending, skipped)`,
            `  -trace        Error stack trace or log message`,
            `  -evidence     Path to evidence screenshot or file`,
            `  -severity     Bug severity (critical, high, medium, low)`,
            `  -priority     Bug priority (high, medium, low)`,
            `  -show-name    Display scenario titles in place of canonical addresses`,
            `  -show-detail  Display full stack traces, evidence files, and metadata`,
            ``,
            `Examples:`,
            `  ${TITLE_CLI} spec testrun status -target="@tr-1" -show-name -show-detail`,
            `  ${TITLE_CLI} spec testcase status -target="@tc-01" -show-name`,
            `  ${TITLE_CLI} spec bug add -target="bugs.bug.feature" -case="@tc-01" -severity=critical`,
            `  ${TITLE_CLI} spec bug mark -target="@bg-1" -status=passed`
        ]
    }).abort();
}

// ─── Main Dispatcher ─────────────────────────────────────────────────────────

export const specCmd = async (options: SpecCmdOptions) => {
    const { resource, action } = options;

    if (!resource || !action) {
        printGeneralUsage();
        return;
    }

    const normResource = resource.toLowerCase();
    switch (normResource) {
        case 'testcase':
            await handleTestcase(options);
            break;
        case 'testrun':
            await handleTestrun(options);
            break;
        case 'testplan':
            await handleTestplan(options);
            break;
        case 'bug':
        case 'defect':
            await handleBug(options);
            break;
        default:
            printGeneralUsage();
    }
};
