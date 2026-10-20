import { join, resolve, basename } from 'path';
import { readFileSync } from 'fs';
import { bold, green, yellow, red } from 'chalk';
import { generateCmd } from './generate';
import { GherkinEditor } from '../core/gherkin-editor';
import { Parser } from '../core/parser';
import { Config } from '../core/config';
import { State } from '../core/state';
import { logger as notify } from '../core/logger';
import { createCommandContext } from '../core/command-context';
import { resource } from '../core/resources';
import { VariableParser } from '../core/variables';
import { IScope } from '../core/types';
import { TITLE_CLI, SCOPE_CONFIG, TESTCASE_STATUSES } from '../core/const';
import { askStatus } from '../core/prompt';
import { Parser as GherkinRawParser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';

function matchesScope(s: any, scopeName: IScope): boolean {
    if (!s) return false;
    if (!Object.prototype.hasOwnProperty.call(SCOPE_CONFIG, scopeName)) return false;
    const cfg = SCOPE_CONFIG[scopeName as keyof typeof SCOPE_CONFIG];
    return s.feature?.tags?.includes(cfg.tag) || (typeof s.uri === 'string' && s.uri.endsWith(cfg.ext));
}

async function resolveTargetScenario(target: string, dir: string, scopeKey: IScope, testDirectory?: string, variables?: VariableParser) {
    const searchDir = testDirectory ? join(dir, testDirectory) : dir;
    const parser = new Parser(searchDir, variables);
    const config = new Config(dir);

    const data = {
        identity: config.getIdentity(scopeKey),
        fields: config.getFields(scopeKey),
    };

    const documents = parser.content() || [];

    const rawScenarios = documents.filter(s => matchesScope(s, scopeKey));
    const filtered = parser.filter(rawScenarios, data, scopeKey) || [];

    const matches = filtered.filter(s => {
        const id = s.custom?.identity ? `${s.uri}::${s.custom.identity}` : s.uri;
        return id === target || id.startsWith(`${target}::`) || id.endsWith(`/${target}`) || id.endsWith(target) ||
            s.uri === target || s.uri.endsWith(`/${target}`) || s.uri.endsWith(target);
    });

    if (matches.length === 1) {
        return {
            absolutePath: resolve(searchDir, matches[0].uri),
            scenario: matches[0]
        };
    }

    if (matches.length === 0) {
        notify.push({
            type: 'error',
            title: `No ${scopeKey} matched target '${target}'.`,
            detail: [`Run \`${TITLE_CLI} state list\` to list available resources.`],
        });
        process.exit(1);
    }

    // Ambiguity
    const relPaths = Array.from(new Set(matches.map(m => `  - ${m.uri}`)));
    notify.push({
        type: 'error',
        title: `Multiple ${scopeKey} files matched '${target}'. Please specify a full path or identity tag.`,
        detail: relPaths,
    });
    process.exit(1);
}

// ---------------------------------------------------------------------------
// test add  (formerly "generate", testrun and testplan only)
// ---------------------------------------------------------------------------

async function runAdd(options: {
    dir: string;
    scope: IScope;
    title?: string;
    rules?: string[];
}) {
    const { dir, scope, title, rules } = options;

    if (scope === 'testcase') {
        notify.push({
            type: 'error',
            title: `\`testform suite init\` does not support scope 'testcase'.`,
            detail: [`Use \`${TITLE_CLI} generate\` for testcase files, or specify -scope=testrun or -scope=testplan.`],
        });
        process.exit(1);
    }

    await generateCmd({ dir, scope, title, rules });
}

// ---------------------------------------------------------------------------
// suite fill  (testrun only)
// ---------------------------------------------------------------------------

async function runAutocomplete(options: {
    dir: string;
    target: string;
    testDirectory?: string;
    variables?: VariableParser;
}) {
    const { dir, target, testDirectory, variables } = options;
    const searchDir = testDirectory ? join(dir, testDirectory) : dir;

    const { absolutePath: absoluteRunPath } = await resolveTargetScenario(target, dir, 'testrun', testDirectory, variables);

    // Parse the testrun feature file to find Rule blocks
    const rawContent = readFileSync(absoluteRunPath, 'utf-8');
    const builder = new AstBuilder(IdGenerator.uuid());
    const gherkinParser = new GherkinRawParser(builder, new GherkinClassicTokenMatcher());
    const doc = gherkinParser.parse(rawContent);

    if (!doc.feature) {
        notify.push({ type: 'error', title: `No Feature block found in '${target}'.`, detail: [] });
        process.exit(1);
    }

    const ruleChildren = (doc.feature.children || []).filter((c: any) => c.rule);

    if (ruleChildren.length === 0) {
        notify.push({ type: 'error', title: `No Rule blocks found in '${target}'.`, detail: [] });
        process.exit(1);
    }

    // Get all testcases from the parser to match rules
    const caseParser = new Parser(searchDir, variables);
    const allDocuments = caseParser.content() || [];

    const allCases = allDocuments.filter(s => matchesScope(s, 'testcase'));
    const allCaseFiles = Array.from(new Set(allCases.map(s => s.uri)));

    let expandedCount = 0;

    for (const child of ruleChildren) {
        const rule = child?.rule;
        if (!rule) continue;

        const ruleName: string = typeof rule === 'string' ? rule : (rule.name || '');

        // If Rule already has explicit scenarios → skip (respect manual control)
        const ruleChildrenNodes = typeof rule === 'object' && rule.children ? rule.children : [];
        const ruleScenarios = ruleChildrenNodes.filter((c: any) => c.scenario);
        if (ruleScenarios.length > 0) {
            console.log(`  ${yellow('~')} Rule '${ruleName}': already has ${ruleScenarios.length} explicit scenario(s). Skipping.`);
            continue;
        }

        // Find the .case.feature referenced by this Rule
        const normalized = ruleName.replace(/\.feature$/i, '');
        const matchingFile = allCaseFiles.find(f => {
            return (
                f === ruleName ||
                f.replace(/\.feature$/i, '') === normalized ||
                basename(f).replace(/\.feature$/i, '') === normalized ||
                f.endsWith('/' + ruleName) ||
                f.endsWith('/' + ruleName + '.feature')
            );
        });

        if (!matchingFile) {
            console.log(`  ${red('!')} Rule '${ruleName}': source file not found in workspace. Skipping.`);
            continue;
        }

        const caseScenarios = allCases.filter(s => s.uri === matchingFile);

        if (caseScenarios.length === 0) {
            console.log(`  ${red('!')} Rule '${ruleName}': no scenarios parsed from source file. Skipping.`);
            continue;
        }

        // Build testcases list: "ruleName::scenarioIdentity"
        const config = new Config(dir);
        const caseData = { identity: config.getIdentity('testcase'), fields: config.getFields('testcase') };
        const filteredCases = caseParser.filter(caseScenarios, caseData, 'testcase') || [];

        const testcases = filteredCases.map((s: any) => {
            const id = s.custom?.identity || s.name;
            return `${ruleName}::${id}`;
        });

        GherkinEditor.expandScenarios(absoluteRunPath, testcases, 'pending');
        console.log(`  ${green('✓')} Rule '${ruleName}': expanded ${testcases.length} scenario(s).`);
        expandedCount += testcases.length;
    }

    if (expandedCount === 0) {
        console.log('No scenarios were expanded. All Rules already have explicit scenarios or source files were not found.');
    } else {
        console.log(green(bold(`\nAutocomplete complete! ${expandedCount} scenario(s) expanded.`)));
    }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// suite link / mark  (replaces apply -set-status)
// ---------------------------------------------------------------------------

/**
 * Parse testcase argument for `suite link` (and `suite mark`).
 *
 * Supported identity strategies:
 *   1. Only tag:       "@tc-1=passed" or "tc-1=passed"
 *   2. File + tag:     "checkout.case.feature::@tc-1=passed" or "checkout.case.feature@tc-1=passed"
 *   3. Scenario name:  "Pago con tarjeta=passed"
 *
 * Returns: { featurePart, casePart, newStatus, rawIdentifier }
 */
function parseTcArg(tcArg: string, subCommand: string = 'link'): { featurePart: string; casePart: string; newStatus: string; rawIdentifier: string } {
    const eqIdx = tcArg.lastIndexOf('=');
    if (eqIdx === -1) {
        notify.push({
            type: 'error',
            title: `Invalid format: '${tcArg}'`,
            detail: [
                `Expected format: '<identifier>=<status>'`,
                `Examples:`,
                `  ${TITLE_CLI} suite ${subCommand} "@tc-1=passed" -target="@tr-2"`,
                `  ${TITLE_CLI} suite ${subCommand} "cuenta/inicio-sesion.feature@tc-1=passed" -target="@tr-2"`,
                `  ${TITLE_CLI} suite ${subCommand} "Validar login exitoso=passed" -target="@tr-2"`,
                ``,
                `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
            ],
        });
        process.exit(1);
    }

    const newStatus = tcArg.slice(eqIdx + 1).trim();
    const rawIdentifier = tcArg.slice(0, eqIdx).trim();

    if (!TESTCASE_STATUSES.includes(newStatus as any)) {
        notify.push({
            type: 'error',
            title: `Invalid status '${newStatus}' in '${tcArg}'.`,
            detail: [
                `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
            ],
        });
        process.exit(1);
    }

    if (!rawIdentifier) {
        notify.push({
            type: 'error',
            title: `Could not find scenario identity in '${tcArg}'.`,
            detail: [
                `Expected format: '<identifier>=<status>'`,
                `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
            ],
        });
        process.exit(1);
    }

    // Strip type prefix (e.g. github_testcase., local_testcase., testcase.)
    const stripped = rawIdentifier.replace(/^([a-zA-Z0-9_-]+_)?testcase\./, '');

    let featurePart = '';
    let casePart = '';

    if (stripped.includes('::')) {
        const doubleColonIdx = stripped.indexOf('::');
        featurePart = stripped.slice(0, doubleColonIdx).trim();
        casePart = stripped.slice(doubleColonIdx + 2).trim();
    } else {
        const atIdx = stripped.lastIndexOf('@');
        if (atIdx > 0) {
            // e.g. "cuenta/inicio-sesion.feature@tc-1"
            featurePart = stripped.slice(0, atIdx).trim();
            casePart = stripped.slice(atIdx).trim();
        } else {
            // e.g. "@tc-1", "tc-1", or scenario title "Validar login exitoso"
            featurePart = '';
            casePart = stripped.trim();
        }
    }

    return { featurePart, casePart, newStatus, rawIdentifier };
}

async function runState(options: {
    dir: string;
    target: string;
    subCommand?: string;
    tcArg?: string;
    statePath?: string;
    backupPath?: string;
    testDirectory?: string;
    variables?: VariableParser;
    verbose?: boolean;
}) {
    const { dir, target, subCommand = 'link', tcArg, statePath, backupPath, testDirectory, variables, verbose = false } = options;

    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();

    const searchDir = testDirectory ? join(dir, testDirectory) : dir;
    const { scenario: runScenario, absolutePath: absoluteRunPath } = await resolveTargetScenario(target, dir, 'testrun', testDirectory, variables);

    let identity: string;
    const rawIdentity = runScenario.custom?.identity;
    if (!rawIdentity) {
        identity = runScenario.uri;
    } else if (rawIdentity.includes('::')) {
        identity = rawIdentity;
    } else if (rawIdentity === runScenario.uri) {
        identity = rawIdentity;
    } else {
        identity = `${runScenario.uri}::${rawIdentity}`;
    }

    // Find testrun resource in state
    const runs = stateObj.getResources('testrun');
    const foundRun = runs.find((r: any) => r.identity === identity);

    if (!foundRun) {
        notify.push({
            type: 'error',
            title: `Testrun not found in state for target '${target}' (Identity: ${identity}).`,
            detail: [`Try running \`${TITLE_CLI} refresh -scope testrun\` to sync state.`],
        });
        process.exit(1);
    }

    // Resolve tc argument or prompt interactively
    let featurePart: string;
    let casePart: string;
    let newStatus: string;
    let rawIdentifier: string;

    const allTestcases = stateObj.getResources('testcase');

    if (tcArg) {
        ({ featurePart, casePart, newStatus, rawIdentifier } = parseTcArg(tcArg, subCommand));
    } else {
        // Interactive: list available testcases and prompt
        const commentIds: Record<string, any> = foundRun.attributes?.testcaseCommentIds || {};
        const keys = Object.keys(commentIds);
        if (keys.length === 0) {
            notify.push({ type: 'error', title: `No testcases found in testrun '${target}'. Run \`testform apply\` first.`, detail: [] });
            process.exit(1);
        }
        console.log(bold(`\nAvailable testcases in '${foundRun.identity}':`));
        keys.forEach((k, i) => {
            const status = foundRun.attributes?.testcaseStatuses?.[k] || 'pending';
            const tcRes = allTestcases.find((r: any) => r.identity === k);
            const titlePart = tcRes?.attributes?.title ? ` - "${tcRes.attributes.title}"` : '';
            console.log(`  ${i + 1}. ${k}${titlePart} [${status}]`);
        });
        console.log(`\n${bold('Available statuses:')} ${TESTCASE_STATUSES.join(', ')}\n`);
        notify.push({
            type: 'error',
            title: `Please provide the testcase argument.`,
            detail: [
                `Usage: ${TITLE_CLI} suite ${subCommand} "<identifier>=<status>" -target="${target}"`,
                `Strategies:`,
                `  1. Only tag:       "@tc-1=passed"`,
                `  2. File + tag:     "checkout.case.feature::@tc-1=passed"`,
                `  3. Scenario name:  "Pago con tarjeta=passed"`,
            ]
        });
        process.exit(1);
    }

    // Find the matching comment ID key in state using the 3 identity strategies
    const commentIds: Record<string, any> = foundRun.attributes?.testcaseCommentIds || {};

    const matchingKeys = Object.keys(commentIds).filter(k => {
        const [kFile = '', kId = ''] = k.split('::');
        const kFileNorm = kFile.replace(/\.feature$/i, '');
        const tcRes = allTestcases.find((r: any) => r.identity === k);
        const tcTitle = tcRes?.attributes?.title || '';

        // If featurePart was specified, enforce file match
        if (featurePart) {
            const normalizedFeature = featurePart.replace(/\.feature$/i, '');
            const fileMatches = (
                kFile === featurePart ||
                kFileNorm === normalizedFeature ||
                kFile.endsWith(featurePart) ||
                kFile.endsWith('/' + featurePart) ||
                kFile.endsWith('/' + featurePart + '.feature') ||
                basename(kFileNorm) === basename(normalizedFeature)
            );
            if (!fileMatches) return false;
        }

        const normCase = casePart.trim().toLowerCase();
        const normId = kId.trim().toLowerCase();
        const normTitle = tcTitle.trim().toLowerCase();

        // 1. Exact ID/Tag match (with or without '@')
        if (normId === normCase || normId.replace(/^@/, '') === normCase.replace(/^@/, '')) {
            return true;
        }

        // 2. Exact Title match
        if (normTitle && normTitle === normCase) {
            return true;
        }

        // 3. Fallback: Full identity match
        if (k.toLowerCase() === rawIdentifier.toLowerCase()) {
            return true;
        }

        return false;
    });

    if (matchingKeys.length === 0) {
        const available = Object.keys(commentIds).slice(0, 10).map(k => `  - ${k}`);
        notify.push({
            type: 'error',
            title: `Testcase '${rawIdentifier}' not found in testrun '${target}'.`,
            detail: [
                `Available testcases in this run (up to 10):`,
                ...available,
                ``,
                `Accepted identity strategies:`,
                `  1. Only tag:       "@tc-1=passed"`,
                `  2. File + tag:     "checkout.case.feature::@tc-1=passed"`,
                `  3. Scenario name:  "Pago con tarjeta=passed"`,
            ],
        });
        process.exit(1);
    }

    if (matchingKeys.length > 1) {
        const ambiguous = matchingKeys.map(k => `  - ${k}`);
        notify.push({
            type: 'error',
            title: `Multiple testcases matched '${casePart}' in testrun '${target}'.`,
            detail: [
                `Matches:`,
                ...ambiguous,
                ``,
                `Please specify the feature file to disambiguate:`,
                `  e.g. ${TITLE_CLI} suite ${subCommand} "<file>::${casePart}=${newStatus}" -target="${target}"`,
            ],
        });
        process.exit(1);
    }

    const targetId = matchingKeys[0];
    const commentId = commentIds[targetId];
    const oldStatus = foundRun.attributes?.testcaseStatuses?.[targetId] || 'pending';

    const ctx = await createCommandContext({ dir, verbose, lock: false });
    if (!ctx) process.exit(1);

    // Build comment body
    const tcResource = stateObj.getResources('testcase').find((r: any) => r.identity === targetId);
    const tcTitle = tcResource?.attributes?.title || targetId;
    const [baseRule, scenarioName] = targetId.split('::');
    const originFile = require('path').basename(baseRule || '');
    const safeScenario = scenarioName ? scenarioName.replace('@', '') : '';

    const commentBody = `**Origin:** ${originFile}\n<table border="1" width="100%">\n    <tr>\n        <th colspan="3">Feature Name</th>\n    </tr>\n    <tr>\n        <td>${safeScenario}</td>\n        <td>${tcTitle}</td>\n        <td>${newStatus}</td>\n    </tr>\n    <tr>\n        <td colspan="3"><br/></td>\n    </tr>\n</table>`;

    await ctx.adapter.updateIssueComment(commentId, commentBody);
    console.log(`  -> Updated status comment for ${targetId} to '${newStatus}'`);

    if (!foundRun.attributes.testcaseStatuses) foundRun.attributes.testcaseStatuses = {};
    foundRun.attributes.testcaseStatuses[targetId] = newStatus;
    await stateObj.save();

    console.log(`\n  ${yellow('~')} resource "${foundRun.type || 'testrun'}" "${foundRun.identity}" {`);
    console.log(`      ${yellow('~')} testcaseStatuses {`);
    console.log(`          ${yellow('~')} "${targetId}": "${oldStatus}" -> "${newStatus}"`);
    console.log(`        }`);
    console.log(`    }\n`);

    // Sync .run.feature locally
    if (runScenario?.uri) {
        try {
            GherkinEditor.updateScenarioStatus(absoluteRunPath, baseRule, scenarioName, newStatus);
            console.log(`  -> Synced status to local file: ${runScenario.uri}`);

            const config = new Config(dir);
            const freshParser = new Parser(searchDir, variables);
            const freshData = { identity: config.getIdentity('testrun'), fields: config.getFields('testrun') };
            const freshRuns = freshParser.filter(freshParser.content(), freshData, 'testrun');
            const freshRunScenario = freshRuns?.find((r: any) =>
                r.uri === runScenario.uri || r.custom?.identity === foundRun.identity
            );
            const payload = resource.evaluate(foundRun.type || 'testrun', freshRunScenario || runScenario, { state: stateObj, testDirectory }) as any;
            await ctx.adapter.updateIssue(foundRun.attributes.issueNumber, payload);
            console.log(`  -> Synced status to main issue body #${foundRun.attributes.issueNumber}`);
        } catch (e: any) {
            console.log(`  -> Failed to update local file or issue body: ${e.message}`);
        }
    }

    console.log(green(bold(`Status successfully updated!`)));
}

// ---------------------------------------------------------------------------
// Main Dispatcher
// ---------------------------------------------------------------------------

export interface SuiteCmdOptions {
    dir: string;
    subCommand: string;
    subArgs: string[];
    scope?: IScope;
    title?: string;
    rules?: string[];
    target?: string;
    testDirectory?: string;
    statePath?: string;
    backupPath?: string;
    variables?: VariableParser;
    verbose?: boolean;
}

export const suiteCmd = async (options: SuiteCmdOptions) => {
    const {
        dir, subCommand, subArgs, scope, title, rules,
        target, testDirectory, statePath, backupPath, variables, verbose
    } = options;

    const cmd = (subCommand || '').toLowerCase();

    if (cmd === 'init' || cmd === 'new' || cmd === 'feature' || cmd === 'add') {
        if (!scope) {
            notify.push({
                type: 'error',
                title: `Usage: ${TITLE_CLI} suite init -scope=<testrun|testplan> [-title=<title>] [-rule=<rule>]`,
                detail: [`Note: 'suite init' applies to testrun or testplan scope.`],
            });
            process.exit(1);
        }
        await runAdd({ dir, scope, title, rules });
        return;
    }

    if (cmd === 'fill' || cmd === 'autocomplete') {
        if (!target) {
            notify.push({
                type: 'error',
                title: `Usage: ${TITLE_CLI} suite fill -target=<path|relative|@tr-N>`,
                detail: [
                    `This command is exclusive to testrun scope.`,
                    `It expands empty Rule blocks using the source .case.feature file.`,
                ],
            });
            process.exit(1);
        }
        await runAutocomplete({ dir, target, testDirectory, variables });
        return;
    }

    if (cmd === 'link' || cmd === 'mark' || cmd === 'state') {
        if (!target) {
            notify.push({
                type: 'error',
                title: `Usage: ${TITLE_CLI} suite ${cmd} "<identifier>=<status>" -target=<path|relative|@tr-N>`,
                detail: [
                    `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
                    ``,
                    `Identity strategies:`,
                    `  1. Only tag:       "@tc-1=passed"`,
                    `  2. File + tag:     "cuenta/inicio-sesion.feature@tc-1=passed"`,
                    `  3. Scenario name:  "Pago con tarjeta=passed"`,
                    ``,
                    `Examples:`,
                    `  ${TITLE_CLI} suite ${cmd} "@tc-1=passed" -target="@tr-2"`,
                    `  ${TITLE_CLI} suite ${cmd} "cuenta/inicio-sesion.feature@tc-1=passed" -target="@tr-2"`,
                    `  ${TITLE_CLI} suite ${cmd} "github_testcase.agencia/cuenta.feature::@tc-3=failed" -target="20260607.run.feature"`,
                ],
            });
            process.exit(1);
        }
        await runState({
            dir,
            target,
            subCommand: cmd,
            tcArg: subArgs.length > 0 ? subArgs[0] : undefined,
            statePath,
            backupPath,
            testDirectory,
            variables,
            verbose,
        });
        return;
    }

    notify.push({
        type: 'error',
        title: `Unknown suite subcommand: '${subCommand}'`,
        detail: [`Available subcommands: init, fill, link (or mark)`],
    });
    process.exit(1);
};

// Backwards-compatible aliases
export const toolCmd = suiteCmd;
export type ToolCmdOptions = SuiteCmdOptions;
