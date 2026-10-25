import { join, resolve, basename, relative, dirname } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { bold, green, yellow, red } from 'chalk';
import { generateCmd } from './generate';
import { GherkinEditor, findNextIdentity } from '../core/editor';
import { Parser } from '../core/parser';
import { Config } from '../core/config';
import { State } from '../core/state';
import { logger as notify } from '../core/logger';
import { Diag } from '../core/diagnostics';
import { createCommandContext } from '../core/context';
import { resource } from '../core/resources';
import { VariableParser } from '../core/variables';
import { IScope } from '../core/types';
import { TITLE_CLI, SCOPE_CONFIG, TESTCASE_STATUSES } from '../core/const';
import { askStatus, askSelect, askInput, isInteractive } from '../core/prompt';
import {
    matchesScope,
    matchesFeatureFile,
    resolveTargetScenario,
    promptTargetSuite,
    parseSpec,
    matchesScenarioSpec,
    matchesStateKey,
} from '../core/selector';

// ─── Standardized CLI Strategy Documentation Constants ───────────────────────

export const TARGET_STRATEGIES_DETAIL = [
    `Target strategies (-target):`,
    `  1. Identity Tag (@tr-N / @tp-N):`,
    `     Unique identifier across the workspace. Only valid for testrun and testplan`,
    `     (testcase @tc-N tags can repeat across different files and cannot be used as target).`,
    `     Example: -target="@tr-1" or -target="@tp-2"`,
    ``,
    `  2. Canonical Address:`,
    `     Immutable full address binding the feature file and its identity tag.`,
    `     Example: -target="tests/runs/20261024.run.feature.@tr-1"`,
    ``,
    `  3. Scoped File Path:`,
    `     File path resolved against -test-directory.`,
    `     - With -test-directory="tests/runs":  -target="20261024.run.feature"`,
    `     - Without -test-directory:          -target="tests/runs/20261024.run.feature"`,
];

export const IDENTIFIER_STRATEGIES_DETAIL = [
    `Identifier strategies (<identifier>=<status>):`,
    `  1. Identity Tag:       "@tc-1=passed" (caution: if @tc-1 repeats across files, use strategy 2)`,
    `  2. Canonical / File:   "checkout.case.feature.@tc-1=passed" (disambiguates across files)`,
    `  3. Scenario Name:      "Pago con tarjeta=passed"`,
];

/**
 * Parses bracketed tag expressions:
 *   - "checkout.case.feature.[@smoke]" -> { filePattern: "checkout.case.feature", tags: ["@smoke"] }
 *   - "[@smoke]" -> { filePattern: undefined, tags: ["@smoke"] }
 *   - "checkout.case.feature.[@smoke,@critical]" -> { filePattern: "checkout.case.feature", tags: ["@smoke", "@critical"] }
 */
export function parseTagAddress(address: string): { filePattern?: string; tags: string[] } {
    const trimmed = address.trim();
    const bracketMatch = trimmed.match(/^(?:(.*)(?:\.|\b))?\[([^\]]+)\]$/);
    if (!bracketMatch) {
        throw new Error(`Invalid tag address format: "${address}". Expected format like "[@smoke]" or "checkout.case.feature.[@smoke]".`);
    }

    let filePattern = bracketMatch[1]?.trim() || undefined;
    if (filePattern?.endsWith('.')) {
        filePattern = filePattern.slice(0, -1).trim();
    }
    const rawTags = bracketMatch[2].split(',').map(t => t.trim()).filter(Boolean);
    const tags = rawTags.map(t => t.startsWith('@') ? t : `@${t}`);

    return { filePattern, tags };
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
        Diag.error({
            title: `\`testform suite init\` does not support scope 'testcase'.`,
            detail: [`Use \`${TITLE_CLI} generate\` for testcase files, or specify -scope=testrun or -scope=testplan.`],
        }).abort();
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
    const doc = GherkinEditor.parseRawDocument(absoluteRunPath);

    if (!doc.feature) {
        Diag.structureError({ file: target, message: `No Feature block found in '${target}'.` }).abort();
        return;
    }

    const ruleChildren = (doc.feature.children || []).filter((c: any) => c.rule);

    if (ruleChildren.length === 0) {
        Diag.structureError({ file: target, message: `No Rule blocks found in '${target}'.` }).abort();
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

        // Build testcases list: "ruleName.scenarioIdentity"
        const config = new Config(dir);
        const caseData = { identity: config.getIdentity('testcase'), fields: config.getFields('testcase') };
        const filteredCases = caseParser.filter(caseScenarios, caseData, 'testcase') || [];

        const testcases = filteredCases.map((s: any) => {
            const id = s.custom?.identity || s.name;
            return `${ruleName}.${id}`;
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
// suite link / mark  (replaces apply -set-status)
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// suite link  (implicit & explicit linking for testrun & testplan)
// ---------------------------------------------------------------------------

async function runLink(options: {
    dir: string;
    target?: string;
    linkArg?: string;
    testDirectory?: string;
    statePath?: string;
    backupPath?: string;
    variables?: VariableParser;
    verbose?: boolean;
}) {
    const { dir, testDirectory, variables, statePath, backupPath, verbose = false } = options;
    let target = options.target;

    if (!target) {
        if (isInteractive()) {
            target = await promptTargetSuite(dir, ['testrun', 'testplan'], testDirectory, variables);
        } else {
            Diag.usage({
                syntax: `${TITLE_CLI} suite link "<identifier>=<status>" -target=<path|relative|@tr-N>`,
                detail: [
                    `Specify -target to indicate which suite to link into.`,
                    `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
                    ``,
                    `Identity strategies:`,
                    `  1. Only tag:       "@tc-1=passed"`,
                    `  2. File + tag:     "cuenta/inicio-sesion.feature@tc-1=passed"`,
                    `  3. Scenario name:  "Pago con tarjeta=passed"`,
                    ``,
                    `Examples:`,
                    `  # Link into testrun (implicit):`,
                    `  ${TITLE_CLI} suite link "checkout.case.feature" -target="@tr-42"`,
                    `  # Link into testrun (explicit):`,
                    `  ${TITLE_CLI} suite link "@tc-1" -target="@tr-42"`,
                    `  ${TITLE_CLI} suite link "checkout.case.feature.@tc-1=passed" -target="@tr-42"`,
                    `  # Link into testplan:`,
                    `  ${TITLE_CLI} suite link "sprint42.run.feature" -target="@tp-1"`,
                ],
            }).abort();
            return;
        }
    }
    if (!target) return;

    const searchDir = testDirectory ? join(dir, testDirectory) : dir;
    const parser = new Parser(searchDir, variables);
    const documents = parser.content() || [];

    // Determine target scope (testrun or testplan)
    let targetScope: IScope = 'testrun';
    if (target.endsWith('.plan.feature') || target.includes('plan') || target.startsWith('@tp')) {
        targetScope = 'testplan';
    } else {
        const testruns = documents.filter(s => matchesScope(s, 'testrun'));
        const matchedInRun = testruns.some(s => s.uri === target || s.uri.endsWith(target) || s.custom?.identity === target);
        if (!matchedInRun) {
            const testplans = documents.filter(s => matchesScope(s, 'testplan'));
            if (testplans.some(s => s.uri === target || s.uri.endsWith(target) || s.custom?.identity === target)) {
                targetScope = 'testplan';
            }
        }
    }

    const { absolutePath: suitePath } = await resolveTargetScenario(target, dir, targetScope, testDirectory, variables);

    // ─── Scope: testplan ─────────────────────────────────────────────────────
    if (targetScope === 'testplan') {
        let runToLink = options.linkArg;

        if (runToLink && (runToLink.includes('=') || runToLink.startsWith('@tc'))) {
            Diag.error({
                title: `Cannot link explicit testcase scenarios into a testplan.`,
                detail: [
                    `Testplans only link entire testrun suites (Rule: <file.run.feature>).`,
                    `Example: ${TITLE_CLI} suite link "sprint42.run.feature" -target="${target}"`,
                    `         ${TITLE_CLI} suite link "@tr-1" -target="${target}"`,
                ],
            }).abort();
        }

        if (!runToLink) {
            if (isInteractive()) {
                const runDocs = documents.filter(s => matchesScope(s, 'testrun'));
                const config = new Config(dir);
                const data = { identity: config.getIdentity('testrun'), fields: config.getFields('testrun') };
                const filteredRuns = parser.filter(runDocs, data, 'testrun') || [];

                const choices = filteredRuns.map(r => ({
                    label: `${basename(r.uri)} ${r.custom?.identity ? `(${r.custom.identity})` : ''} - "${r.feature?.name || ''}"`,
                    value: basename(r.uri)
                }));

                if (choices.length === 0) {
                    Diag.error({
                        title: `No testrun files found to link into testplan '${target}'.`,
                        detail: [`Create a testrun first with \`${TITLE_CLI} suite init -scope=testrun\`.`],
                    }).abort();
                }

                runToLink = await askSelect(`Selecciona el testrun para enlazar en '${basename(suitePath)}':`, choices);
            } else {
                Diag.usage({
                    syntax: `${TITLE_CLI} suite link "<testrunFile|@tr-N>" -target="${target}"`,
                    detail: [
                        `Please specify the testrun to link into testplan '${target}'.`,
                        `Example: ${TITLE_CLI} suite link "sprint42.run.feature" -target="${target}"`,
                    ],
                }).abort();
                return;
            }
        }

        if (!runToLink) return;

        let resolvedRunRule = runToLink;
        if (runToLink.startsWith('@') || !runToLink.includes('.feature')) {
            const runDocs = documents.filter(s => matchesScope(s, 'testrun'));
            const matched = runDocs.find(s => s.custom?.identity === runToLink || s.uri.includes(runToLink));
            if (matched) {
                resolvedRunRule = basename(matched.uri);
            }
        }

        const { addedRule } = GherkinEditor.linkRuleOrScenario(suitePath, resolvedRunRule);
        if (addedRule) {
            console.log(green(bold(`\n✓ Successfully linked Rule '${resolvedRunRule}' into testplan '${basename(suitePath)}'`)));
        } else {
            console.log(yellow(`\n~ Rule '${resolvedRunRule}' is already present in testplan '${basename(suitePath)}'`));
        }
        return;
    }

    // ─── Scope: testrun ──────────────────────────────────────────────────────
    let tcArg = options.linkArg;

    if (!tcArg) {
        if (isInteractive()) {
            const linkMode = await askSelect('¿Cómo deseas enlazar a este testrun?', [
                { label: 'Enlace Implícito - Enlazar todo un archivo .case.feature mediante Rule', value: 'implicit' },
                { label: 'Enlace Explícito - Enlazar un escenario específico con status', value: 'explicit' }
            ]);

            const caseDocs = documents.filter(s => matchesScope(s, 'testcase'));
            const config = new Config(dir);
            const data = { identity: config.getIdentity('testcase'), fields: config.getFields('testcase') };
            const filteredCases = parser.filter(caseDocs, data, 'testcase') || [];

            if (linkMode === 'implicit') {
                const uniqueFiles = Array.from(new Set(filteredCases.map(s => basename(s.uri))));
                const choices = uniqueFiles.map(f => ({ label: f, value: f }));
                const chosenFile = await askSelect('Selecciona el archivo .case.feature a enlazar:', choices);
                tcArg = chosenFile;
            } else {
                const uniqueFiles = Array.from(new Set(filteredCases.map(s => basename(s.uri))));
                let chosenFile = '';
                if (uniqueFiles.length > 1) {
                    const fileChoices = uniqueFiles.map(f => ({ label: f, value: f }));
                    chosenFile = await askSelect('Selecciona el archivo .case.feature del escenario:', fileChoices);
                } else if (uniqueFiles.length === 1) {
                    chosenFile = uniqueFiles[0];
                }

                const scenariosInFile = filteredCases.filter(c => !chosenFile || basename(c.uri) === chosenFile);
                const choices = scenariosInFile.map(c => {
                    const tag = c.custom?.identity ? `[${c.custom.identity}] ` : '';
                    return {
                        label: `${tag}${c.name}`,
                        value: `${basename(c.uri)}.${c.custom?.identity || c.name}`
                    };
                });
                const chosenCase = await askSelect('Selecciona el testcase a enlazar:', choices);
                const chosenStatus = await askStatus('pending');
                tcArg = `${chosenCase}=${chosenStatus}`;
            }
        } else {
            Diag.usage({
                syntax: `${TITLE_CLI} suite link "<identifier>=<status>" -target="${target}"`,
                detail: [
                    `Please provide the testcase or rule argument to link into '${target}'.`,
                    `Usage:`,
                    `  Implicit link:  ${TITLE_CLI} suite link "checkout.case.feature" -target="${target}"`,
                    `  Explicit link:  ${TITLE_CLI} suite link "checkout.case.feature.@tc-1" -target="${target}"`,
                    `                  ${TITLE_CLI} suite link "@tc-1" -target="${target}"`,
                    `                  ${TITLE_CLI} suite link "@tc-1=passed" -target="${target}"`,
                ],
            }).abort();
            return;
        }
    }

    if (!tcArg) return;

    const stripped = tcArg.replace(/=(passed|failed|skipped|pending)$/i, '').trim();

    // Determine if implicit (whole file) or explicit (scenario)
    const isExplicitCandidate = stripped.includes('@') || stripped.includes('=') || stripped.includes('.case.feature.') || stripped.includes('.run.feature.');

    const caseDocs = documents.filter(s => matchesScope(s, 'testcase'));
    const caseFiles = Array.from(new Set(caseDocs.map(s => s.uri)));

    const matchingWholeFile = !isExplicitCandidate ? caseFiles.find(f =>
        f === stripped ||
        basename(f) === stripped ||
        basename(f).replace(/\.feature$/i, '') === stripped.replace(/\.feature$/i, '') ||
        basename(f).replace(/\.case\.feature$/i, '') === stripped.replace(/\.case\.feature$/i, '')
    ) : undefined;

    if (matchingWholeFile) {
        // IMPLICIT LINK
        const ruleName = basename(matchingWholeFile);
        const { addedRule } = GherkinEditor.linkRuleOrScenario(suitePath, ruleName);
        if (addedRule) {
            console.log(green(bold(`\n✓ Successfully linked Rule '${ruleName}' implicitly into testrun '${basename(suitePath)}'`)));
        } else {
            console.log(yellow(`\n~ Rule '${ruleName}' is already present in testrun '${basename(suitePath)}'`));
        }
        return;
    }

    // EXPLICIT LINK
    const { featurePart, casePart, newStatus } = parseSpec(tcArg, { command: 'link' });

    const config = new Config(dir);
    const caseData = { identity: config.getIdentity('testcase'), fields: config.getFields('testcase') };
    const allFiltered = parser.filter(caseDocs, caseData, 'testcase') || [];

    const matches = allFiltered.filter(s => matchesScenarioSpec(s, { featurePart, casePart }));

    if (matches.length === 0) {
        Diag.error({
            title: `Testcase '${casePart}' not found in workspace to link.`,
            detail: [`Make sure the .case.feature file and scenario exist in your test directory.`],
        }).abort();
    }

    if (matches.length > 1) {
        const amb = matches.map(m => `${basename(m.uri)}.${m.custom?.identity || m.name}`);
        Diag.ambiguousTestcase({
            identifier: casePart,
            target: 'workspace',
            matches: amb,
        }).abort();
    }

    const matchedTc = matches[0];
    const ruleName = basename(matchedTc.uri);
    const scenarioName = matchedTc.custom?.identity || matchedTc.name;

    const { addedRule, addedScenario, updatedScenario } = GherkinEditor.linkRuleOrScenario(
        suitePath,
        ruleName,
        scenarioName,
        newStatus
    );

    if (addedScenario) {
        console.log(green(bold(`\n✓ Linked Scenario '${scenarioName}' under '${ruleName}' with status '${newStatus}' into '${basename(suitePath)}'`)));
    } else if (updatedScenario) {
        console.log(green(bold(`\n✓ Updated Scenario '${scenarioName}' status to '${newStatus}' in '${basename(suitePath)}'`)));
    } else if (addedRule) {
        console.log(green(bold(`\n✓ Linked Rule '${ruleName}' into '${basename(suitePath)}'`)));
    }
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
    } else if (rawIdentity.startsWith(runScenario.uri) || rawIdentity === runScenario.uri) {
        identity = rawIdentity;
    } else {
        identity = `${runScenario.uri}.${rawIdentity}`;
    }

    // Find testrun resource in state
    const runs = stateObj.getResources('testrun');
    const foundRun = runs.find((r: any) => r.identity === identity);

    if (!foundRun) {
        Diag.error({
            title: `Testrun not found in state for target '${target}' (Identity: ${identity}).`,
            detail: [`Try running \`${TITLE_CLI} refresh -scope testrun\` to sync state.`],
        }).abort();
        return;
    }

    // Resolve tc argument or prompt interactively
    let featurePart: string = '';
    let casePart: string = '';
    let newStatus: string = '';
    let rawIdentifier: string = '';

    const allTestcases = stateObj.getResources('testcase');

    if (tcArg) {
        if (!tcArg.includes('=') && (subCommand === 'mark' || subCommand === 'state')) {
            if (isInteractive()) {
                const promptedStatus = await askStatus();
                ({ featurePart, casePart, newStatus, rawIdentifier } = parseSpec(`${tcArg}=${promptedStatus}`, { command: 'mark' }));
            } else {
                ({ featurePart, casePart, newStatus, rawIdentifier } = parseSpec(tcArg, { command: 'mark' }));
            }
        } else {
            ({ featurePart, casePart, newStatus, rawIdentifier } = parseSpec(tcArg, { command: 'mark' }));
        }
    } else {
        // Interactive: list available testcases and prompt
        const commentIds: Record<string, any> = foundRun.attributes?.testcaseCommentIds || {};
        const keys = Object.keys(commentIds);
        if (keys.length === 0) {
            Diag.error({ title: `No testcases found in testrun '${target}'. Run \`testform apply\` first.`, detail: [] }).abort();
            return;
        }

        if (isInteractive()) {
            const choices = keys.map(k => {
                const status = foundRun.attributes?.testcaseStatuses?.[k] || 'pending';
                const tcRes = allTestcases.find((r: any) => r.identity === k);
                const titlePart = tcRes?.attributes?.title ? ` - "${tcRes.attributes.title}"` : '';
                return {
                    label: `${k}${titlePart} [${status}]`,
                    value: k
                };
            });

            const selectedKey = await askSelect(`Testcases disponibles en '${foundRun.identity}':`, choices);
            const selectedStatus = await askStatus();

            const lastDot = selectedKey.lastIndexOf('.');
            const kFile = lastDot !== -1 ? selectedKey.slice(0, lastDot) : selectedKey;
            const kId = lastDot !== -1 ? selectedKey.slice(lastDot + 1) : '';
            featurePart = kFile;
            casePart = kId;
            newStatus = selectedStatus;
            rawIdentifier = selectedKey;
        } else {
            console.log(bold(`\nAvailable testcases in '${foundRun.identity}':`));
            keys.forEach((k, i) => {
                const status = foundRun.attributes?.testcaseStatuses?.[k] || 'pending';
                const tcRes = allTestcases.find((r: any) => r.identity === k);
                const titlePart = tcRes?.attributes?.title ? ` - "${tcRes.attributes.title}"` : '';
                console.log(`  ${i + 1}. ${k}${titlePart} [${status}]`);
            });
            console.log(`\n${bold('Available statuses:')} ${TESTCASE_STATUSES.join(', ')}\n`);
            Diag.usage({
                syntax: `${TITLE_CLI} suite ${subCommand} "<identifier>=<status>" -target="${target}"`,
                detail: [
                    `Please provide the testcase argument.`,
                    `Strategies:`,
                    `  1. Only tag:       "@tc-1=passed"`,
                    `  2. File + tag:     "checkout.case.feature.@tc-1=passed"`,
                    `  3. Scenario name:  "Pago con tarjeta=passed"`,
                ],
            }).abort();
            return;
        }
    }

    // Find the matching comment ID key in state using the 3 identity strategies
    const commentIds: Record<string, any> = foundRun.attributes?.testcaseCommentIds || {};

    const matchingKeys = Object.keys(commentIds).filter(k => {
        const tcRes = allTestcases.find((r: any) => r.identity === k);
        return matchesStateKey(k, tcRes?.attributes?.title, { featurePart, casePart, rawIdentifier });
    });

    if (matchingKeys.length === 0) {
        Diag.testcaseNotFound({
            identifier: rawIdentifier,
            target,
            available: Object.keys(commentIds),
        }).abort();
    }

    if (matchingKeys.length > 1) {
        Diag.ambiguousTestcase({
            identifier: casePart,
            target,
            matches: matchingKeys,
            command: subCommand,
            status: newStatus,
        }).abort();
    }

    const targetId = matchingKeys[0];
    const commentId = commentIds[targetId];
    const oldStatus = foundRun.attributes?.testcaseStatuses?.[targetId] || 'pending';
    const lastTargetDot = targetId.lastIndexOf('.');
    const baseRule = lastTargetDot !== -1 ? targetId.slice(0, lastTargetDot) : targetId;
    const scenarioName = lastTargetDot !== -1 ? targetId.slice(lastTargetDot + 1) : '';

    // Verify that the scenario is actually expanded in the local .run.feature file.
    // If the rule is implicit, require the user to run `suite fill` first.
    if (runScenario?.uri) {
        const localDoc = GherkinEditor.parseRawDocument(absoluteRunPath);
        const ruleChildren = (localDoc.feature?.children || []).filter((c: any) => c.rule);

        const normBase = baseRule.replace(/\.feature$/i, '');
        const matchedRuleNode = ruleChildren.find((c: any) => {
            const rName = (c.rule?.name || '').replace(/\.feature$/i, '');
            return rName === normBase || rName.endsWith('/' + normBase) || normBase.endsWith('/' + rName) ||
                   rName.endsWith(normBase) || normBase.endsWith(rName);
        });

        const isExpanded = matchedRuleNode?.rule?.children?.some((sc: any) => {
            const sName = sc.scenario?.name || '';
            const normCase = scenarioName ? scenarioName.trim().toLowerCase() : '';
            const sNorm = sName.trim().toLowerCase();
            return sNorm === normCase || sNorm.replace(/^@/, '') === normCase.replace(/^@/, '');
        });

        if (!isExpanded) {
            const ruleLine = matchedRuleNode?.rule?.location?.line;
            const relFile = relative(dir, absoluteRunPath) || basename(absoluteRunPath);

            Diag.implicitRule({
                file: relFile,
                line: ruleLine,
                rule: baseRule,
                scenario: scenarioName,
                target,
            }).abort();
        }
    }

    const ctx = await createCommandContext({ dir, verbose, lock: false });
    if (!ctx) process.exit(1);

    // Build comment body
    const tcResource = stateObj.getResources('testcase').find((r: any) => r.identity === targetId);
    const tcTitle = tcResource?.attributes?.title || targetId;
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
// suite tags  (generates .run.feature based on bracketed tag address)
// ---------------------------------------------------------------------------

async function runTagsSuite(options: {
    dir: string;
    tagExpression: string;
    title?: string;
    testDirectory?: string;
    variables?: VariableParser;
}) {
    const { dir, tagExpression, title, testDirectory, variables } = options;
    const searchDir = testDirectory ? join(dir, testDirectory) : dir;
    const config = new Config(dir);

    let parsedAddress: { filePattern?: string; tags: string[] };
    try {
        parsedAddress = parseTagAddress(tagExpression);
    } catch {
        Diag.error({
            title: `Invalid tag address format: '${tagExpression}'`,
            detail: [
                `Expected bracket address format:`,
                `  1. File specific:  "checkout.case.feature.[@smoke]"`,
                `  2. Workspace-wide: "[@smoke]" or "[@smoke,@critical]"`,
            ]
        }).abort();
        return;
    }

    const { filePattern, tags } = parsedAddress;

    // Load all testcases
    const parser = new Parser(searchDir, variables);
    const documents = parser.content() || [];
    const allCases = documents.filter(s => matchesScope(s, 'testcase'));

    // Filter by filePattern if provided
    let candidateCases = allCases;
    if (filePattern) {
        candidateCases = candidateCases.filter(s => matchesFeatureFile(s.uri, filePattern));
        if (candidateCases.length === 0) {
            Diag.error({
                title: `No testcase files matched '${filePattern}'.`,
                detail: [`Available files:`, ...Array.from(new Set(allCases.map(s => `  - ${s.uri}`))).slice(0, 10)]
            }).abort();
            return;
        }
    }

    // Filter scenarios that contain ANY of the requested tags
    const matchedScenarios = candidateCases.filter(s => {
        const scenarioTags = [...(s.tags || []), ...(s.feature?.tags || [])].map(String);
        return scenarioTags.some(t => tags.includes(t));
    });

    if (matchedScenarios.length === 0) {
        Diag.error({
            title: `No testcase scenarios found matching tag(s) [${tags.join(', ')}].`,
            detail: [
                filePattern ? `Searched within: ${filePattern}` : `Searched across all testcase files in workspace.`,
                `Total testcases evaluated: ${candidateCases.length}`
            ]
        }).abort();
        return;
    }

    // Group scenarios by source feature file URI
    const grouped = new Map<string, typeof matchedScenarios>();
    for (const s of matchedScenarios) {
        const fileKey = s.uri;
        if (!grouped.has(fileKey)) {
            grouped.set(fileKey, []);
        }
        grouped.get(fileKey)!.push(s);
    }

    // Determine filename and directory using convention
    const convention = config.getConvention('testrun');
    const scopeConf = config.getScopeConf('testrun');
    const identityPattern = config.getIdentity('testrun');
    const outDir = convention?.directory || scopeConf?.directory || 'tests/runs';
    const fileTpl = convention?.filename || `{YYYYMMDD}_{HHmmss}.run.feature`;

    const now = new Date();
    const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
    const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const timestamp = now.getTime().toString();
    const cleanTagSlug = tags.map(t => t.replace('@', '')).join('_').toLowerCase();

    let generatedTitle = title || `Suite ${tags.join(' ')}`;
    let slug = cleanTagSlug;
    if (filePattern) {
        const baseName = basename(filePattern).replace(/\.feature$/i, '').replace(/\.case$/i, '');
        slug = `${baseName}_${cleanTagSlug}`;
    }

    let filename = fileTpl
        .replace(/{YYYYMMDD}/g, YYYYMMDD)
        .replace(/{HHmmss}/g, HHmmss)
        .replace(/{timestamp}/g, timestamp)
        .replace(/{slug}/g, slug);

    filename = filename.replace(/^[_\-]+/, '').replace(/[_\-]+(\.)/g, '$1');

    const shortHash = Math.random().toString(16).substring(2, 8);
    if (filename.endsWith('.feature')) {
        if (filename.endsWith('.run.feature')) {
            filename = filename.replace('.run.feature', `_${shortHash}.run.feature`);
        } else {
            filename = filename.replace('.feature', `_${shortHash}.feature`);
        }
    } else {
        if (filename.endsWith('.run')) {
            filename = filename.replace('.run', `_${shortHash}.run.feature`);
        } else {
            filename += `_${shortHash}.run.feature`;
        }
    }

    const fullPath = join(dir, outDir, filename);
    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
    }

    const nextIdentityTag = identityPattern ? findNextIdentity(dir, identityPattern) : null;

    let content = `@testrun`;
    if (nextIdentityTag) {
        content += ` ${nextIdentityTag}`;
    }
    content += `\nFeature: ${generatedTitle}\n\n`;

    let totalCases = 0;
    for (const [fileUri, scenarios] of grouped.entries()) {
        const ruleName = basename(fileUri);
        content += `  Rule: ${ruleName}\n`;
        for (const sc of scenarios) {
            const scName = sc.name || 'Unnamed Scenario';
            content += `    Scenario: ${scName}\n`;
            content += `      * mark status = pending\n\n`;
            totalCases++;
        }
    }

    writeFileSync(fullPath, content.trim() + '\n', 'utf-8');

    console.log(green(bold(`\nGenerated testrun suite file: ${fullPath}`)));
    console.log(`  ${green('✓')} Included ${totalCases} scenario(s) matching tag(s) ${tags.join(', ')} across ${grouped.size} file(s).`);
}

// ---------------------------------------------------------------------------
// Main Dispatcher
// ---------------------------------------------------------------------------

export interface SuiteCmdOptions {
    dir: string;
    subCommand?: string;
    subArgs: string[];
    scope?: IScope;
    title?: string;
    rules?: string[];
    target?: string;
    tags?: string;
    fill?: boolean;
    link?: string;
    mark?: string;
    testDirectory?: string;
    statePath?: string;
    backupPath?: string;
    variables?: VariableParser;
    verbose?: boolean;
}

export const suiteCmd = async (options: SuiteCmdOptions) => {
    const {
        dir, subCommand, subArgs, scope, title, rules,
        target, tags, fill, link, mark, testDirectory, statePath, backupPath, variables, verbose
    } = options;

    let cmd = (subCommand || '').toLowerCase();
    const effectiveArgs = [...subArgs];

    if (fill) {
        cmd = 'fill';
    } else if (link) {
        cmd = 'link';
        if (effectiveArgs.length === 0) effectiveArgs.push(link);
    } else if (mark) {
        cmd = 'mark';
        if (effectiveArgs.length === 0) effectiveArgs.push(mark);
    } else if (tags) {
        cmd = 'tags';
    }

    let currentScope = scope;
    let currentTitle = title;
    let currentTarget = target;

    // Check if tags flag or bracketed address was directly passed
    const rawTagAddress = tags || (cmd.includes('[') && cmd.endsWith(']') ? cmd : (effectiveArgs.length > 0 && effectiveArgs[0].includes('[') ? effectiveArgs[0] : undefined));

    if (cmd === 'tags' || (rawTagAddress && (!cmd || cmd === 'tags' || cmd === 'init' || cmd === 'run'))) {
        const targetExpr = rawTagAddress || (effectiveArgs.length > 0 ? effectiveArgs[0] : undefined);
        if (!targetExpr) {
            Diag.usage({
                syntax: `${TITLE_CLI} suite tags "<address>" [-title=<title>]`,
                detail: [
                    `Generates a new testrun suite (.run.feature) by extracting scenarios with matching tags.`,
                    ``,
                    `Address strategies:`,
                    `  1. File-specific tag:  "checkout.case.feature.[@smoke]"  (only scenarios with @smoke from this file)`,
                    `  2. Workspace-wide tag: "[@smoke]"                       (all scenarios with @smoke from any file)`,
                    `  3. Multiple tags:      "[@smoke,@critical]"             (scenarios matching any of the specified tags)`,
                    ``,
                    `Examples:`,
                    `  ${TITLE_CLI} suite -tags="[@smoke]"`,
                    `  ${TITLE_CLI} suite -tags="checkout.case.feature.[@smoke]"`,
                    `  ${TITLE_CLI} suite tags "[@smoke]" -title="Smoke Regression"`,
                ],
            }).abort();
            return;
        }

        await runTagsSuite({
            dir,
            tagExpression: targetExpr,
            title: currentTitle,
            testDirectory,
            variables
        });
        return;
    }

    if (!cmd) {
        if (isInteractive()) {
            cmd = await askSelect('¿Qué operación de suite deseas realizar?', [
                { label: 'init  - Crear un nuevo archivo de suite (.run.feature o .plan.feature)', value: 'init' },
                { label: 'tags  - Generar un testrun a partir de tags con corchetes (ej: [@smoke])', value: 'tags' },
                { label: 'fill  - Autocompletar reglas vacías de un testrun con sus casos', value: 'fill' },
                { label: 'link  - Enlazar casos o runs en la suite (escribe Gherkin implícita/explícitamente)', value: 'link' },
                { label: 'mark  - Registrar estado de ejecución de un testcase y sincronizar', value: 'mark' },
            ]);
        } else {
            Diag.usage({
                syntax: `${TITLE_CLI} suite [subcommand] [options]`,
                detail: [
                    `Subcommand:`,
                    `  init                       Create a new suite file (.run.feature or .plan.feature)`,
                    ``,
                    `Options:`,
                    `  -fill                      Autocomplete empty testrun rules with their testcases`,
                    `  -link="<id>=<status>"      Link a testcase or testrun into a suite`,
                    `  -mark="<id>=<status>"      Record execution status (* mark status = <status>) in a testrun`,
                    `  -tags="<address>"          Generate a testrun suite from bracketed tag addresses (e.g. "[@smoke]")`,
                    ``,
                    `Other Options:`,
                    `  -target=<resource>         Required for -fill, -link, -mark. Identifies the suite file:`,
                    `                             • Identity tag: @tr-1, @tp-1 (unique for testrun and testplan)`,
                    `                             • Canonical address: tests/runs/smoke.run.feature.@tr-1`,
                    `                             • Scoped file path: smoke.run.feature (scoped to -test-directory)`,
                    `  -test-directory=<dir>      Optional. Limits the search scope for .case.feature files and shortens target paths.`,
                    `  -scope=<testrun|testplan>  Optional (global). Scope of the suite to generate.`,
                    `  -title=<title>             Optional. Human-readable title of the suite.`,
                    `  -rule=<rule>               Optional. Source .case.feature file(s) to include as Rule blocks.`,
                ],
            }).abort();
        }
    }

    if (cmd === 'init' || cmd === 'new' || cmd === 'feature' || cmd === 'add') {
        if (!currentScope) {
            if (isInteractive()) {
                currentScope = (await askSelect('Selecciona el scope para la suite:', [
                    { label: 'testrun  - Suite de ejecución (.run.feature)', value: 'testrun' },
                    { label: 'testplan - Suite de planificación (.plan.feature)', value: 'testplan' }
                ])) as IScope;
                if (!currentTitle) {
                    currentTitle = await askInput('Ingresa el título de la suite');
                }
            } else {
                Diag.usage({
                    syntax: `${TITLE_CLI} suite init -scope=<testrun|testplan> [-title=<title>] [-rule=<rule>] [-tags=<expression>]`,
                    detail: [
                        `Note: 'suite init' applies to testrun or testplan scope.`,
                        ``,
                        `Options:`,
                        `  -scope=<testrun|testplan>  Scope of the suite to generate`,
                        `  -title=<title>             Human-readable title for the suite feature`,
                        `  -rule=<rule>               Rule file name(s) to include (repeatable)`,
                        `  -tags=<expression>         Generate a testrun filtered by tag address (e.g. "[@smoke]" or "file.case.feature.[@smoke]")`,
                    ],
                }).abort();
                return;
            }
        }
        if (!currentScope) return;
        await runAdd({ dir, scope: currentScope, title: currentTitle, rules });
        return;
    }

    if (cmd === 'fill' || cmd === 'expand' || cmd === 'autocomplete') {
        if (!currentTarget) {
            if (isInteractive()) {
                currentTarget = await promptTargetSuite(dir, ['testrun'], testDirectory, variables);
            } else {
                Diag.usage({
                    syntax: `${TITLE_CLI} suite fill -target=<target>`,
                    detail: [
                        `This command is exclusive to testrun scope.`,
                        `It expands empty Rule blocks using the source .case.feature scenarios.`,
                        ``,
                        ...TARGET_STRATEGIES_DETAIL,
                    ],
                }).abort();
                return;
            }
        }
        if (!currentTarget) return;
        await runAutocomplete({ dir, target: currentTarget, testDirectory, variables });
        return;
    }

    if (cmd === 'link') {
        if (!currentTarget && isInteractive()) {
            currentTarget = await promptTargetSuite(dir, ['testrun', 'testplan'], testDirectory, variables);
        }
        if (!currentTarget) {
            Diag.usage({
                syntax: `${TITLE_CLI} suite link "<identifier>=<status>" -target=<target>`,
                detail: [
                    `Links a testcase or testrun into the target suite file.`,
                    ``,
                    ...IDENTIFIER_STRATEGIES_DETAIL,
                    ``,
                    ...TARGET_STRATEGIES_DETAIL,
                ],
            }).abort();
            return;
        }
        await runLink({
            dir,
            target: currentTarget,
            linkArg: effectiveArgs.length > 0 ? effectiveArgs[0] : undefined,
            statePath,
            backupPath,
            testDirectory,
            variables,
            verbose,
        });
        return;
    }

    if (cmd === 'mark' || cmd === 'state') {
        if (!currentTarget) {
            if (isInteractive()) {
                currentTarget = await promptTargetSuite(dir, ['testrun'], testDirectory, variables);
            } else {
                Diag.usage({
                    syntax: `${TITLE_CLI} suite mark "<identifier>=<status>" -target=<target>`,
                    detail: [
                        `Updates the execution status (* mark status = <status>) of a testcase in a testrun.`,
                        `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
                        ``,
                        ...IDENTIFIER_STRATEGIES_DETAIL,
                        ``,
                        ...TARGET_STRATEGIES_DETAIL,
                    ],
                }).abort();
                return;
            }
        }
        if (!currentTarget) return;
        await runState({
            dir,
            target: currentTarget,
            subCommand: 'mark',
            tcArg: effectiveArgs.length > 0 ? effectiveArgs[0] : undefined,
            statePath,
            backupPath,
            testDirectory,
            variables,
            verbose,
        });
        return;
    }

    Diag.unknownSubcommand({
        command: 'suite',
        subcommand: subCommand || '',
        available: ['init', 'fill', 'link', 'mark', 'tags'],
    }).abort();
};

// Backwards-compatible aliases
export const toolCmd = suiteCmd;
export type ToolCmdOptions = SuiteCmdOptions;
