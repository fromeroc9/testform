import { join, resolve, basename, relative } from 'path';
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
import { askStatus, askSelect, askInput, isInteractive } from '../core/prompt';
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

async function promptTargetSuite(
    dir: string,
    allowedScopes: IScope[] = ['testrun', 'testplan'],
    testDirectory?: string,
    variables?: VariableParser
): Promise<string> {
    const searchDir = testDirectory ? join(dir, testDirectory) : dir;
    const parser = new Parser(searchDir, variables);
    const documents = parser.content() || [];

    const choices: { label: string; value: string }[] = [];

    for (const scope of allowedScopes) {
        const raw = documents.filter(s => matchesScope(s, scope));
        const config = new Config(dir);
        const data = { identity: config.getIdentity(scope), fields: config.getFields(scope) };
        const filtered = parser.filter(raw, data, scope) || [];

        for (const s of filtered) {
            const tag = s.custom?.identity || '';
            const tagPart = tag ? ` (${tag})` : '';
            const titlePart = s.feature?.name ? ` - "${s.feature.name}"` : '';
            choices.push({
                label: `[${scope}] ${s.uri}${tagPart}${titlePart}`,
                value: tag || s.uri,
            });
        }
    }

    if (choices.length === 0) {
        notify.push({
            type: 'error',
            title: `No ${allowedScopes.join(' or ')} files found in workspace.`,
            detail: [`Use \`testform suite init\` to create one first.`],
        });
        process.exit(1);
    }

    return askSelect('Selecciona la suite de destino (-target):', choices);
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
    let newStatus = 'pending';
    let rawIdentifier = tcArg.trim();

    if (eqIdx !== -1) {
        newStatus = tcArg.slice(eqIdx + 1).trim();
        rawIdentifier = tcArg.slice(0, eqIdx).trim();

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
    } else if (subCommand === 'mark') {
        notify.push({
            type: 'error',
            title: `Invalid format: '${tcArg}'`,
            detail: [
                `Expected format: '<identifier>=<status>'`,
                `Examples:`,
                `  ${TITLE_CLI} suite mark "@tc-1=passed" -target="@tr-2"`,
                `  ${TITLE_CLI} suite mark "cuenta/inicio-sesion.feature@tc-1=passed" -target="@tr-2"`,
                ``,
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
            notify.push({
                type: 'error',
                title: `Usage: ${TITLE_CLI} suite link "<identifier>=<status>" -target=<path|relative|@tr-N>`,
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
                    `  ${TITLE_CLI} suite link "checkout.case.feature::@tc-1=passed" -target="@tr-42"`,
                    `  # Link into testplan:`,
                    `  ${TITLE_CLI} suite link "sprint42.run.feature" -target="@tp-1"`,
                ],
            });
            process.exit(1);
        }
    }

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

        if (runToLink && (runToLink.includes('::') || runToLink.includes('=') || runToLink.startsWith('@tc'))) {
            notify.push({
                type: 'error',
                title: `Cannot link explicit testcase scenarios into a testplan.`,
                detail: [
                    `Testplans only link entire testrun suites (Rule: <file.run.feature>).`,
                    `Example: ${TITLE_CLI} suite link "sprint42.run.feature" -target="${target}"`,
                    `         ${TITLE_CLI} suite link "@tr-1" -target="${target}"`,
                ],
            });
            process.exit(1);
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
                    notify.push({
                        type: 'error',
                        title: `No testrun files found to link into testplan '${target}'.`,
                        detail: [`Create a testrun first with \`${TITLE_CLI} suite init -scope=testrun\`.`],
                    });
                    process.exit(1);
                }

                runToLink = await askSelect(`Selecciona el testrun para enlazar en '${basename(suitePath)}':`, choices);
            } else {
                notify.push({
                    type: 'error',
                    title: `Please specify the testrun to link into testplan '${target}'.`,
                    detail: [
                        `Usage: ${TITLE_CLI} suite link "<testrunFile|@tr-N>" -target="${target}"`,
                        `Example: ${TITLE_CLI} suite link "sprint42.run.feature" -target="${target}"`,
                    ],
                });
                process.exit(1);
            }
        }

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
                        value: `${basename(c.uri)}::${c.custom?.identity || c.name}`
                    };
                });
                const chosenCase = await askSelect('Selecciona el testcase a enlazar:', choices);
                const chosenStatus = await askStatus('pending');
                tcArg = `${chosenCase}=${chosenStatus}`;
            }
        } else {
            notify.push({
                type: 'error',
                title: `Please provide the testcase or rule argument to link into '${target}'.`,
                detail: [
                    `Usage:`,
                    `  Implicit link:  ${TITLE_CLI} suite link "checkout.case.feature" -target="${target}"`,
                    `  Explicit link:  ${TITLE_CLI} suite link "checkout.case.feature::@tc-1" -target="${target}"`,
                    `                  ${TITLE_CLI} suite link "@tc-1" -target="${target}"`,
                    `                  ${TITLE_CLI} suite link "@tc-1=passed" -target="${target}"`,
                ],
            });
            process.exit(1);
        }
    }

    // Determine if implicit (whole file) or explicit (scenario)
    const stripped = tcArg.replace(/^([a-zA-Z0-9_-]+_)?testcase\./, '');
    const isExplicitCandidate = stripped.includes('::') || stripped.includes('@') || stripped.includes('=');

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
    const { featurePart, casePart, newStatus } = parseTcArg(tcArg, 'link');

    const config = new Config(dir);
    const caseData = { identity: config.getIdentity('testcase'), fields: config.getFields('testcase') };
    const allFiltered = parser.filter(caseDocs, caseData, 'testcase') || [];

    const matches = allFiltered.filter(s => {
        if (featurePart) {
            const normF = featurePart.replace(/\.feature$/i, '');
            const matchFile = (
                s.uri === featurePart ||
                s.uri.endsWith(featurePart) ||
                basename(s.uri).replace(/\.feature$/i, '') === normF
            );
            if (!matchFile) return false;
        }

        const normCase = casePart.trim().toLowerCase();
        const sId = (s.custom?.identity || '').trim().toLowerCase();
        const sName = (s.name || '').trim().toLowerCase();

        if (sId === normCase || sId.replace(/^@/, '') === normCase.replace(/^@/, '')) return true;
        if (sName === normCase) return true;
        return false;
    });

    if (matches.length === 0) {
        notify.push({
            type: 'error',
            title: `Testcase '${casePart}' not found in workspace to link.`,
            detail: [`Make sure the .case.feature file and scenario exist in your test directory.`],
        });
        process.exit(1);
    }

    if (matches.length > 1) {
        const amb = matches.map(m => `  - ${basename(m.uri)}::${m.custom?.identity || m.name}`);
        notify.push({
            type: 'error',
            title: `Multiple testcases matched '${casePart}'.`,
            detail: [
                `Please specify the file name to disambiguate:`,
                ...amb
            ],
        });
        process.exit(1);
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
        if (!tcArg.includes('=') && (subCommand === 'mark' || subCommand === 'state')) {
            if (isInteractive()) {
                const promptedStatus = await askStatus();
                ({ featurePart, casePart, newStatus, rawIdentifier } = parseTcArg(`${tcArg}=${promptedStatus}`, subCommand));
            } else {
                ({ featurePart, casePart, newStatus, rawIdentifier } = parseTcArg(tcArg, subCommand));
            }
        } else {
            ({ featurePart, casePart, newStatus, rawIdentifier } = parseTcArg(tcArg, subCommand));
        }
    } else {
        // Interactive: list available testcases and prompt
        const commentIds: Record<string, any> = foundRun.attributes?.testcaseCommentIds || {};
        const keys = Object.keys(commentIds);
        if (keys.length === 0) {
            notify.push({ type: 'error', title: `No testcases found in testrun '${target}'. Run \`testform apply\` first.`, detail: [] });
            process.exit(1);
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

            const [kFile = '', kId = ''] = selectedKey.split('::');
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
    const [baseRule, scenarioName] = targetId.split('::');

    // Verify that the scenario is actually expanded in the local .run.feature file.
    // If the rule is implicit, require the user to run `suite fill` first.
    if (runScenario?.uri) {
        const localContent = readFileSync(absoluteRunPath, 'utf-8');
        const builder = new AstBuilder(IdGenerator.uuid());
        const gherkinParser = new GherkinRawParser(builder, new GherkinClassicTokenMatcher());
        const localDoc = gherkinParser.parse(localContent);
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
            const locationStr = ruleLine
                ? `on ${relFile} line ${ruleLine}, in rule "${baseRule}":`
                : `on ${relFile}, in rule "${baseRule}":`;
            const snippetLine = ruleLine
                ? `${String(ruleLine).padStart(4, ' ')}:   Rule: ${matchedRuleNode?.rule?.name || baseRule}`
                : '';

            notify.push({
                type: 'error',
                title: 'Cannot mark status on implicit rule',
                detail: [
                    locationStr,
                    snippetLine,
                    '',
                    `Scenario "${scenarioName}" belongs to the implicit Rule "${baseRule}".`,
                    `Testform requires explicit Scenario blocks in order to track and record execution outcomes.`,
                    '',
                    `To expand this rule into explicit scenarios with initial pending status, run:`,
                    `  ${TITLE_CLI} suite fill -target="${target}"`,
                ].filter((l): l is string => l !== undefined),
            });
            process.exit(1);
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

    let cmd = (subCommand || '').toLowerCase();
    let currentScope = scope;
    let currentTitle = title;
    let currentTarget = target;

    if (!cmd) {
        if (isInteractive()) {
            cmd = await askSelect('¿Qué operación de suite deseas realizar?', [
                { label: 'init  - Crear un nuevo archivo de suite (.run.feature o .plan.feature)', value: 'init' },
                { label: 'fill  - Autocompletar reglas vacías de un testrun con sus casos', value: 'fill' },
                { label: 'link  - Enlazar casos o runs en la suite (escribe Gherkin implícita/explícitamente)', value: 'link' },
                { label: 'mark  - Registrar estado de ejecución de un testcase y sincronizar', value: 'mark' },
            ]);
        } else {
            notify.push({
                type: 'error',
                title: `Usage: ${TITLE_CLI} suite <init|fill|link|mark> [args...]`,
                detail: [`Available subcommands: init, fill, link, mark`],
            });
            process.exit(1);
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
                notify.push({
                    type: 'error',
                    title: `Usage: ${TITLE_CLI} suite init -scope=<testrun|testplan> [-title=<title>] [-rule=<rule>]`,
                    detail: [`Note: 'suite init' applies to testrun or testplan scope.`],
                });
                process.exit(1);
            }
        }
        await runAdd({ dir, scope: currentScope, title: currentTitle, rules });
        return;
    }

    if (cmd === 'fill' || cmd === 'expand' || cmd === 'autocomplete') {
        if (!currentTarget) {
            if (isInteractive()) {
                currentTarget = await promptTargetSuite(dir, ['testrun'], testDirectory, variables);
            } else {
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
        }
        await runAutocomplete({ dir, target: currentTarget, testDirectory, variables });
        return;
    }

    if (cmd === 'link') {
        if (!currentTarget && isInteractive()) {
            currentTarget = await promptTargetSuite(dir, ['testrun', 'testplan'], testDirectory, variables);
        }
        await runLink({
            dir,
            target: currentTarget,
            linkArg: subArgs.length > 0 ? subArgs[0] : undefined,
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
                notify.push({
                    type: 'error',
                    title: `Usage: ${TITLE_CLI} suite mark "<identifier>=<status>" -target=<path|relative|@tr-N>`,
                    detail: [
                        `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
                        ``,
                        `Identity strategies:`,
                        `  1. Only tag:       "@tc-1=passed"`,
                        `  2. File + tag:     "cuenta/inicio-sesion.feature@tc-1=passed"`,
                        `  3. Scenario name:  "Pago con tarjeta=passed"`,
                        ``,
                        `Examples:`,
                        `  ${TITLE_CLI} suite mark "@tc-1=passed" -target="@tr-2"`,
                        `  ${TITLE_CLI} suite mark "cuenta/inicio-sesion.feature@tc-1=passed" -target="@tr-2"`,
                        `  ${TITLE_CLI} suite mark "github_testcase.agencia/cuenta.feature::@tc-3=failed" -target="20260607.run.feature"`,
                    ],
                });
                process.exit(1);
            }
        }
        await runState({
            dir,
            target: currentTarget,
            subCommand: 'mark',
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
        detail: [`Available subcommands: init, fill, link, mark`],
    });
    process.exit(1);
};

// Backwards-compatible aliases
export const toolCmd = suiteCmd;
export type ToolCmdOptions = SuiteCmdOptions;
