"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graphCmd = void 0;
const chalk_1 = require("chalk");
const parser_1 = require("../core/parser");
const graphCmd = async (options = {}) => {
    const { dir = '.', scope = 'testcase', drawCycles = false } = options;
    const parser = new parser_1.Parser(dir);
    const scenarios = parser.content();
    const testcases = scenarios.filter(s => !s.uri.endsWith('.run.feature') && !s.uri.endsWith('.plan.feature'));
    const testrunsAll = scenarios.filter(s => s.uri.endsWith('.run.feature'));
    const testplansAll = scenarios.filter(s => s.uri.endsWith('.plan.feature'));
    // Group testplans by URI
    const testplansMap = new Map();
    for (const p of testplansAll) {
        if (!testplansMap.has(p.uri)) {
            testplansMap.set(p.uri, { name: p.feature?.name || 'Unnamed Plan', testruns: [] });
        }
        if (p.rule?.name)
            testplansMap.get(p.uri).testruns.push(p.rule.name);
    }
    const testplans = Array.from(testplansMap.values());
    // Group testruns by URI
    const testrunsMap = new Map();
    for (const r of testrunsAll) {
        if (!testrunsMap.has(r.uri)) {
            testrunsMap.set(r.uri, { name: r.feature?.name || 'Unnamed Run', testcases: [], identity: r.custom?.identity || r.feature?.name || '', uri: r.uri });
        }
        if (r.rule?.name)
            testrunsMap.get(r.uri).testcases.push(r.rule.name);
        else if (r.name)
            testrunsMap.get(r.uri).testcases.push(`${r.feature?.name}::${r.name}`);
    }
    const testruns = Array.from(testrunsMap.values());
    if (testplans.length === 0 && testruns.length === 0 && testcases.length === 0) {
        console.log('No test configurations found.');
        return;
    }
    console.log((0, chalk_1.bold)('Test Infrastructure Graph\n'));
    const link = (str) => drawCycles ? (0, chalk_1.magenta)(str) : str;
    function findTcs(tcId) {
        let scenarioName = '*';
        let ruleName = tcId;
        if (tcId.includes('::')) {
            const parts = tcId.split('::');
            scenarioName = parts.pop() || '*';
            ruleName = parts.join('::');
        }
        const matches = testcases.filter(r => {
            const matchesFile = r.uri.endsWith(ruleName) || r.uri.includes(ruleName);
            const matchesScenario = scenarioName === '*' || r.name === scenarioName || r.name.includes(scenarioName);
            return matchesFile && matchesScenario;
        });
        // Detect duplicates
        const uris = Array.from(new Set(matches.map(tc => tc.uri)));
        if (uris.length > 1) {
            if (scenarioName !== '*') {
                const { logger } = require('../logger');
                logger.error(`Ambiguous reference for Scenario '${scenarioName}' under Rule '${ruleName}'. It matches multiple files:\n` + uris.map(u => `  - ${u}`).join('\n') + `\nPlease specify the full file path in your Rule to disambiguate.`);
            }
            else {
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
            console.log(`📦 ${(0, chalk_1.cyan)((0, chalk_1.bold)(planName))} ${(0, chalk_1.dim)(`(testplan)`)}`);
            const trIds = plan.testruns;
            for (const [i, trId] of trIds.entries()) {
                const isLastRun = i === trIds.length - 1;
                const runPrefix = isLastRun ? '└── ' : '├── ';
                const run = testruns.find(r => r.identity === trId || r.name === trId || r.name.endsWith(trId) || trId.endsWith(r.name) || r.uri.endsWith(trId));
                if (run) {
                    const runName = run.name;
                    console.log(`   ${link(runPrefix)}📂 ${(0, chalk_1.green)(runName)} ${(0, chalk_1.dim)(`(testrun)`)}`);
                    if (scope === 'testcase') {
                        const tcIds = run.testcases;
                        for (let j = 0; j < tcIds.length; j++) {
                            const tcId = tcIds.at(j);
                            const isLastTc = j === tcIds.length - 1;
                            const tcPrefix = isLastRun ? '    ' : '│   ';
                            const tcConnector = isLastTc ? '└── ' : '├── ';
                            const tcs = findTcs(tcId);
                            if (tcs.length > 0) {
                                for (let k = 0; k < tcs.length; k++) {
                                    const tc = tcs.at(k);
                                    const tcIsLast = isLastTc && k === tcs.length - 1;
                                    const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                                    console.log(`   ${tcPrefix}${link(tcFinalConnector)}📄 ${tc.name} ${(0, chalk_1.dim)(`(testcase)`)}`);
                                }
                            }
                            else {
                                console.log(`   ${tcPrefix}${link(tcConnector)}📄 ${(0, chalk_1.dim)(tcId + ' (Not found)')}`);
                            }
                        }
                    }
                }
                else {
                    console.log(`   ${link(runPrefix)}📂 ${(0, chalk_1.dim)(trId + ' (Not found)')}`);
                }
            }
            console.log('');
        }
        if (scope === 'testcase') {
            // Identify orphaned testruns
            const referencedRuns = new Set(testplans.flatMap(p => p.testruns || []));
            const orphanedRuns = testruns.filter(r => {
                return !Array.from(referencedRuns).some(ref => r.identity === ref || r.name === ref || r.uri.endsWith(ref) || ref.endsWith(r.name));
            });
            if (orphanedRuns.length > 0) {
                console.log((0, chalk_1.bold)('Orphaned Test Runs (Not linked to any testplan)\n'));
                for (const run of orphanedRuns) {
                    const runName = run.name;
                    console.log(`📂 ${(0, chalk_1.green)(runName)} ${(0, chalk_1.dim)(`(testrun)`)}`);
                    const tcIds = run.testcases;
                    for (let j = 0; j < tcIds.length; j++) {
                        const tcId = tcIds.at(j);
                        const isLastTc = j === tcIds.length - 1;
                        const tcConnector = isLastTc ? '└── ' : '├── ';
                        console.log(`   ${link(tcConnector)}📄 ${tcId}`);
                    }
                    console.log('');
                }
            }
        }
    }
    else if (scope === 'testrun') {
        // Print Test Runs at root
        for (const run of testruns) {
            const runName = run.name;
            console.log(`📂 ${(0, chalk_1.green)((0, chalk_1.bold)(runName))} ${(0, chalk_1.dim)(`(testrun)`)}`);
            const tcIds = run.testcases;
            for (let j = 0; j < tcIds.length; j++) {
                const tcId = tcIds.at(j);
                const isLastTc = j === tcIds.length - 1;
                const tcConnector = isLastTc ? '└── ' : '├── ';
                const tcs = findTcs(tcId);
                if (tcs.length > 0) {
                    for (let k = 0; k < tcs.length; k++) {
                        const tc = tcs.at(k);
                        const tcIsLast = isLastTc && k === tcs.length - 1;
                        const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                        console.log(`   ${link(tcFinalConnector)}📄 ${tc.name} ${(0, chalk_1.dim)(`(testcase)`)}`);
                    }
                }
                else {
                    console.log(`   ${link(tcConnector)}📄 ${(0, chalk_1.dim)(tcId + ' (Not found)')}`);
                }
            }
            console.log('');
        }
    }
};
exports.graphCmd = graphCmd;
