import { bold, cyan, dim, green, magenta } from 'chalk';
import { Parser } from '../core/parser';
import { IScope, ParserScenario } from '../core/types';
import { VariableParser } from '../core/variables';
import { DependencyResolver } from '../core/dependencies';
import { normalizeAddress, addressesMatch } from '../core/utils';

interface GraphCmdOptions {
    dir?: string;
    scope?: IScope;
    drawCycles?: boolean;
    variables?: VariableParser;
}

export const graphCmd = async (options: GraphCmdOptions = {}) => {
    const {
        dir = '.',
        scope = 'testcase',
        drawCycles = false
    } = options;
    const vars = options.variables || new VariableParser(undefined, undefined, dir);
    const parser = new Parser(dir, vars);
    const scenarios = parser.content();
    const depResolver = new DependencyResolver(dir);

    const testcases = scenarios.filter(s => !s.uri.endsWith('.run.feature') && !s.uri.endsWith('.plan.feature'));
    const testrunsAll = scenarios.filter(s => s.uri.endsWith('.run.feature'));
    const testplansAll = scenarios.filter(s => s.uri.endsWith('.plan.feature'));

    // Group testplans by URI
    const testplansMap = new Map<string, { name: string, testruns: string[] }>();
    for (const p of testplansAll) {
        if (!testplansMap.has(p.uri)) {
            testplansMap.set(p.uri, { name: p.feature?.name || 'Unnamed Plan', testruns: [] });
        }
        if (p.rule?.name) testplansMap.get(p.uri)!.testruns.push(p.rule.name);
    }
    const testplans = Array.from(testplansMap.values());

    // Group testruns by URI
    const testrunsMap = new Map<string, { name: string, testcases: string[], identity: string, uri: string }>();
    for (const r of testrunsAll) {
        if (!testrunsMap.has(r.uri)) {
            testrunsMap.set(r.uri, { name: r.feature?.name || 'Unnamed Run', testcases: [], identity: r.custom?.identity || r.feature?.name || '', uri: r.uri });
        }
        if (r.rule?.name) testrunsMap.get(r.uri)!.testcases.push(r.rule.name);
        else if (r.name) testrunsMap.get(r.uri)!.testcases.push(`${r.feature?.name}.${r.name}`);
    }
    const testruns = Array.from(testrunsMap.values());

    if (testplans.length === 0 && testruns.length === 0 && testcases.length === 0) {
        console.log('No test configurations found.');
        return;
    }

    console.log(bold('Test Infrastructure Graph\n'));

    const link = (str: string) => drawCycles ? magenta(str) : str;

    function findTcs(tcId: string) {
        let scenarioName = '*';
        let ruleName = tcId;
        if (tcId.includes('.feature.')) {
            const idx = tcId.indexOf('.feature.');
            ruleName = tcId.substring(0, idx + 8);
            scenarioName = tcId.substring(idx + 9);
        } else if (tcId.endsWith('.feature')) {
            ruleName = tcId;
            scenarioName = '*';
        } else if (tcId.includes('.')) {
            const parts = tcId.split('.');
            scenarioName = parts.pop() || '*';
            ruleName = parts.join('.');
        }
        const matches = testcases.filter(r => {
            const matchesFile = !ruleName || r.uri.endsWith(ruleName) || r.uri.includes(ruleName);
            const matchesScenario = scenarioName === '*' || r.name === scenarioName || r.name.includes(scenarioName) || r.custom?.identity === scenarioName;
            return matchesFile && matchesScenario;
        });

        // Detect duplicates
        const uris = Array.from(new Set(matches.map(tc => tc.uri)));
        if (uris.length > 1) {
            if (scenarioName !== '*') {
                const { logger } = require('../logger');
                logger.error(`Ambiguous reference for Scenario '${scenarioName}' under Rule '${ruleName}'. It matches multiple files:\n` + uris.map(u => `  - ${u}`).join('\n') + `\nPlease specify the full file path in your Rule to disambiguate.`);
            } else {
                const { logger } = require('../logger');
                logger.warn(`Rule '${ruleName}' matches multiple feature files. Processing all of them:\n` + uris.map(u => `  - ${u}`).join('\n') + `\nIf this was unintentional, specify the full file path.`);
            }
        }
        return matches;
    }

    if (scope === 'testplan' || scope === 'testcase') {
        // Print Test Plans at root
        for (const plan of testplans) {
            const planName = plan.name;
            console.log(`📦 ${cyan(bold(planName))} ${dim(`(testplan)`)}`);

            const trIds = plan.testruns;
            for (const [i, trId] of trIds.entries()) {
                const isLastRun = i === trIds.length - 1;
                const runPrefix = isLastRun ? '└── ' : '├── ';

                const normTrId = normalizeAddress(trId);
                const run = testruns.find(r => 
                    addressesMatch(r.identity, trId) || 
                    r.name === trId || 
                    r.name.endsWith(trId) || 
                    trId.endsWith(r.name) || 
                    normalizeAddress(r.uri).endsWith(normTrId)
                );

                if (run) {
                    const runName = run.name;
                    console.log(`   ${link(runPrefix)}📂 ${green(runName)} ${dim(`(testrun)`)}`);

                    if (scope === 'testcase') {
                        const tcIds = run.testcases;
                        for (let j = 0; j < tcIds.length; j++) {
                            const tcId = tcIds.at(j)!;
                            const isLastTc = j === tcIds.length - 1;
                            const tcPrefix = isLastRun ? '    ' : '│   ';
                            const tcConnector = isLastTc ? '└── ' : '├── ';

                            const tcs = findTcs(tcId);

                            if (tcs.length > 0) {
                                for (let k = 0; k < tcs.length; k++) {
                                    const tc = tcs.at(k)!;
                                    const tcIsLast = isLastTc && k === tcs.length - 1;
                                    const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                                    console.log(`   ${tcPrefix}${link(tcFinalConnector)}📄 ${tc.name} ${dim(`(testcase)`)}`);

                                    const tcTags = tc.tags ? tc.tags.map(t => typeof t === 'string' ? t : (t as any).name) : [];
                                    const deps = depResolver.getDependencies(tc.custom?.identity || `${tc.uri}.${tc.name}`, tcTags);
                                    if (deps.length > 0) {
                                        const depPrefix = tcIsLast ? '       ' : '│      ';
                                        console.log(`   ${tcPrefix}${depPrefix}└── 🔗 ${cyan('depends_on:')} ${dim(deps.join(', '))}`);
                                    }
                                }
                            } else {
                                console.log(`   ${tcPrefix}${link(tcConnector)}📄 ${dim(tcId + ' (Not found)')}`);
                            }
                        }
                    }
                } else {
                    console.log(`   ${link(runPrefix)}📂 ${dim(trId + ' (Not found)')}`);
                }
            }
            console.log('');
        }

        if (scope === 'testcase') {
            // Identify orphaned testruns
            const referencedRuns = new Set(testplans.flatMap(p => p.testruns || []));
            const orphanedRuns = testruns.filter(r => {
                return !Array.from(referencedRuns).some(ref => 
                    addressesMatch(r.identity, ref) || 
                    r.name === ref || 
                    normalizeAddress(r.uri).endsWith(normalizeAddress(ref)) || 
                    ref.endsWith(r.name)
                );
            });

            if (orphanedRuns.length > 0) {
                console.log(bold('Orphaned Test Runs (Not linked to any testplan)\n'));
                for (const run of orphanedRuns) {
                    const runName = run.name;
                    console.log(`📂 ${green(runName)} ${dim(`(testrun)`)}`);
                    const tcIds = run.testcases;
                    for (let j = 0; j < tcIds.length; j++) {
                        const tcId = tcIds.at(j)!;
                        const isLastTc = j === tcIds.length - 1;
                        const tcConnector = isLastTc ? '└── ' : '├── ';

                        const tcs = findTcs(tcId);
                        if (tcs.length > 0) {
                            for (let k = 0; k < tcs.length; k++) {
                                const tc = tcs.at(k)!;
                                const tcIsLast = isLastTc && k === tcs.length - 1;
                                const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                                console.log(`   ${link(tcFinalConnector)}📄 ${tc.name} ${dim(`(testcase)`)}`);

                                const tcTags = tc.tags ? tc.tags.map(t => typeof t === 'string' ? t : (t as any).name) : [];
                                const deps = depResolver.getDependencies(tc.custom?.identity || `${tc.uri}.${tc.name}`, tcTags);
                                if (deps.length > 0) {
                                    const depPrefix = tcIsLast ? '       ' : '│      ';
                                    console.log(`   ${depPrefix}└── 🔗 ${cyan('depends_on:')} ${dim(deps.join(', '))}`);
                                }
                            }
                        } else {
                            console.log(`   ${link(tcConnector)}📄 ${tcId}`);
                        }
                    }
                    console.log('');
                }
            }
        }
    } else if (scope === 'testrun') {
        // Print Test Runs at root
        for (const run of testruns) {
            const runName = run.name;
            console.log(`📂 ${green(bold(runName))} ${dim(`(testrun)`)}`);
            const tcIds = run.testcases;
            for (let j = 0; j < tcIds.length; j++) {
                const tcId = tcIds.at(j)!;
                const isLastTc = j === tcIds.length - 1;
                const tcConnector = isLastTc ? '└── ' : '├── ';

                const tcs = findTcs(tcId);

                if (tcs.length > 0) {
                    for (let k = 0; k < tcs.length; k++) {
                        const tc = tcs.at(k)!;
                        const tcIsLast = isLastTc && k === tcs.length - 1;
                        const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                        console.log(`   ${link(tcFinalConnector)}📄 ${tc.name} ${dim(`(testcase)`)}`);
                    }
                } else {
                    console.log(`   ${link(tcConnector)}📄 ${dim(tcId + ' (Not found)')}`);
                }
            }
            console.log('');
        }
    }
};
