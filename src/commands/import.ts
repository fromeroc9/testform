import { XMLParser } from 'fast-xml-parser';
import { IConfig, IScope } from '../core/types';
import { resolve, normalize, join, basename, dirname, isAbsolute } from 'path';
import { Config } from '../core/config';
import { State } from '../core/state';
import { GitHubAdapter } from '../providers/github';
import { LocalAdapter } from '../providers/local';
import { IProviderAdapter } from '../providers/interface';
import { Parser } from '../core/parser';
import { resource } from '../core/resources';
import { bold, green, red, yellow } from "chalk";
import { hashScenario } from "./plan";
import fs from "fs";
import { Diag } from '../core/diagnostics';
import { findNextIdentity } from '../core/editor';

import { SCOPE_CONFIG, SCOPE_RESOURCE_MAP, TITLE_CLI } from '../core/const';
import { matchesScope, detectScopeFromTarget, matchesTarget, computeResourceIdentity } from '../core/selector';

interface ImportCmdOptions {
    dir?: string;
    scope?: IScope;
    identityArg?: string;
    issueNumber?: string;
    results?: string;
    target?: string;
    out?: string;
    autoCreateBugs?: boolean;
    lock?: boolean;
    lockTimeout?: string;
    statePath?: string;
    backupPath?: string;
}

async function runImportResults(options: {
    dir: string;
    results: string;
    target?: string;
    out?: string;
    autoCreateBugs?: boolean;
}) {
    const { dir, results, target, out, autoCreateBugs } = options;
    const fullResultsPath = resolve(dir, results);

    if (!fs.existsSync(fullResultsPath)) {
        Diag.error({
            title: `Execution results file not found: ${results}`,
            detail: [`Verify the file path provided in -results="${results}".`]
        }).abort();
        return;
    }

    const configClass = new Config(dir, false);
    const runsConvention = configClass.getConvention('testrun');
    const runsDir = runsConvention?.directory || 'tests/runs';
    const absRunsDir = join(dir, runsDir);
    if (!fs.existsSync(absRunsDir)) {
        fs.mkdirSync(absRunsDir, { recursive: true });
    }

    const evidenceDir = join(dir, 'evidence');
    if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
    }

    interface ScenarioResult {
        target: string;
        name: string;
        status: string;
        duration?: string;
        trace?: string;
        evidence: string[];
    }

    const scenarioResults: ScenarioResult[] = [];
    const raw = fs.readFileSync(fullResultsPath, 'utf-8');
    const trimmed = raw.trim();

    const isXml = results.toLowerCase().endsWith('.xml') || trimmed.startsWith('<');

    if (isXml) {
        // ─── 1. JUnit XML Parser ────────────────────────────────────────────
        try {
            const xmlParser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: '@_',
                textNodeName: '#text',
                isArray: (name) => ['testsuite', 'testcase', 'failure', 'error', 'skipped'].includes(name)
            });
            const parsed = xmlParser.parse(trimmed);

            let testsuites: any[] = [];
            if (parsed.testsuites) {
                if (Array.isArray(parsed.testsuites.testsuite)) {
                    testsuites = parsed.testsuites.testsuite;
                } else if (parsed.testsuites.testsuite) {
                    testsuites = [parsed.testsuites.testsuite];
                }
            } else if (parsed.testsuite) {
                testsuites = Array.isArray(parsed.testsuite) ? parsed.testsuite : [parsed.testsuite];
            }

            for (const suite of testsuites) {
                const testcases = Array.isArray(suite.testcase)
                    ? suite.testcase
                    : (suite.testcase ? [suite.testcase] : []);

                const suiteName = (suite['@_name'] || '').replace(/\\/g, '/');

                for (const tc of testcases) {
                    const name = tc['@_name'] || 'Unnamed Test';
                    const classname = (tc['@_classname'] || suiteName || '').replace(/\\/g, '/');
                    const time = tc['@_time'] ? `${tc['@_time']}s` : undefined;

                    // Extract identity tag from name or classname
                    const combined = `${classname} ${name}`;
                    const tcTagMatch = combined.match(/@tc-[a-zA-Z0-9_-]+/i);
                    const tcTag = tcTagMatch ? tcTagMatch[0] : configClass.findIdentityTag(name.split(' '), 'testcase');

                    let target = '';
                    if (classname && tcTag) {
                        target = `${classname}.${tcTag}`;
                    } else if (tcTag) {
                        target = tcTag;
                    } else if (classname && name) {
                        target = `${classname}.${name}`;
                    } else {
                        target = name;
                    }

                    let status = 'passed';
                    let trace: string | undefined;
                    const evidence: string[] = [];

                    if (tc.failure && tc.failure.length > 0) {
                        status = 'failed';
                        const f = tc.failure[0];
                        trace = (typeof f === 'string' ? f : (f['#text'] || f['@_message'] || '')).trim();
                    } else if (tc.error && tc.error.length > 0) {
                        status = 'failed';
                        const err = tc.error[0];
                        trace = (typeof err === 'string' ? err : (err['#text'] || err['@_message'] || '')).trim();
                    } else if (tc.skipped !== undefined) {
                        status = 'skipped';
                    }

                    const sysOut = String(tc['system-out'] || '');
                    const sysErr = String(tc['system-err'] || '');
                    const combinedSys = sysOut + ' ' + sysErr;

                    const attMatches = combinedSys.match(/(?:\[\[ATTACHMENT\|([^\]]+)\]\]|([\w\-\.\/]+\.(?:png|jpg|jpeg|webp)))/g);
                    if (attMatches) {
                        for (const m of attMatches) {
                            const cleanPath = m.replace('[[ATTACHMENT|', '').replace(']]', '').trim();
                            if (cleanPath && !evidence.includes(cleanPath)) {
                                evidence.push(cleanPath);
                            }
                        }
                    }

                    scenarioResults.push({
                        target,
                        name,
                        status,
                        duration: time,
                        trace,
                        evidence
                    });
                }
            }
        } catch (e: any) {
            Diag.error({
                title: `Failed to parse JUnit XML file: ${results}`,
                detail: [`XML parsing error: ${e.message}`]
            }).abort();
            return;
        }
    } else {
        // ─── 2. JSON Parser (Playwright JSON or Cucumber JSON) ───────────────
        let parsed: any;
        try {
            parsed = JSON.parse(trimmed);
        } catch (e: any) {
            Diag.error({
                title: `Failed to parse results file: ${results}`,
                detail: [`The file does not contain valid JSON or XML: ${e.message}`]
            }).abort();
            return;
        }

        if (parsed && parsed.suites && Array.isArray(parsed.suites)) {
            // ─── Playwright JSON ────────────────────────────────────────────
            function walkPlaywrightSuites(suiteList: any[], parentFile: string = '') {
                for (const s of suiteList) {
                    const suiteFile = (s.file || parentFile || '').replace(/\\/g, '/');
                    if (s.specs && Array.isArray(s.specs)) {
                        for (const spec of s.specs) {
                            const specTitle = spec.title || '';
                            const tags: string[] = Array.isArray(spec.tags) ? spec.tags : [];
                            const titleTags = specTitle.match(/@tc-[a-zA-Z0-9_-]+/ig) || [];
                            const allTags = [...tags, ...titleTags];
                            const tcTag = configClass.findIdentityTag(allTags, 'testcase') || (titleTags[0] ? titleTags[0] : undefined);

                            let target = '';
                            if (suiteFile && tcTag) {
                                target = `${suiteFile}.${tcTag}`;
                            } else if (tcTag) {
                                target = tcTag;
                            } else if (suiteFile && specTitle) {
                                target = `${suiteFile}.${specTitle}`;
                            } else {
                                target = specTitle || 'unnamed-scenario';
                            }

                            let status = 'passed';
                            let trace: string | undefined;
                            let duration: string | undefined;
                            const evidence: string[] = [];

                            for (const test of spec.tests || []) {
                                for (const res of test.results || []) {
                                    const rStatus = (res.status || '').toLowerCase();
                                    if (rStatus === 'failed' || rStatus === 'timedout') {
                                        status = 'failed';
                                        if (!trace && res.error) {
                                            trace = (res.error.message || res.error.value || '').trim();
                                        }
                                    } else if (rStatus === 'skipped') {
                                        if (status !== 'failed') status = 'skipped';
                                    }

                                    if (res.duration) {
                                        duration = `${(res.duration / 1000).toFixed(2)}s`;
                                    }

                                    for (const att of res.attachments || []) {
                                        if (att.path) {
                                            evidence.push(att.path.replace(/\\/g, '/'));
                                        }
                                    }
                                }
                            }

                            scenarioResults.push({
                                target,
                                name: specTitle || target,
                                status,
                                duration,
                                trace,
                                evidence
                            });
                        }
                    }
                    if (s.suites && Array.isArray(s.suites)) {
                        walkPlaywrightSuites(s.suites, suiteFile);
                    }
                }
            }
            walkPlaywrightSuites(parsed.suites);
        } else {
            // ─── Cucumber JSON ──────────────────────────────────────────────
            const parsedResults = Array.isArray(parsed) ? parsed : [parsed];

            for (const feature of parsedResults) {
                const featureUri = (feature.uri || feature.id || '').replace(/\\/g, '/');
                const elements = feature.elements || [];

                for (const el of elements) {
                    if (el.type === 'background') continue;

                    const tags: string[] = (el.tags || []).map((t: any) => t.name || '').filter(Boolean);
                    const tcTag = configClass.findIdentityTag(tags, 'testcase');

                    let target = '';
                    if (featureUri && tcTag) {
                        target = `${featureUri}.${tcTag}`;
                    } else if (tcTag) {
                        target = tcTag;
                    } else if (featureUri && el.name) {
                        target = `${featureUri}.${el.name}`;
                    } else {
                        target = el.name || 'unnamed-scenario';
                    }

                    let status = 'passed';
                    let trace: string | undefined;
                    const evidence: string[] = [];

                    for (let stepIdx = 0; stepIdx < (el.steps || []).length; stepIdx++) {
                        const step = el.steps[stepIdx];
                        const sStatus = step.result?.status?.toLowerCase();
                        if (sStatus === 'failed') {
                            status = 'failed';
                            if (!trace && step.result?.error_message) {
                                trace = step.result.error_message.trim();
                            }
                        } else if (sStatus === 'undefined' || sStatus === 'pending') {
                            if (status !== 'failed') status = 'pending';
                        } else if (sStatus === 'skipped') {
                            if (status !== 'failed' && status !== 'pending') status = 'skipped';
                        }

                        for (const emb of step.embeddings || []) {
                            if (emb.data && emb.mime_type && emb.mime_type.startsWith('image/')) {
                                const ext = emb.mime_type.includes('jpeg') || emb.mime_type.includes('jpg') ? 'jpg' : 'png';
                                const rand = Math.random().toString(16).substring(2, 8);
                                const fileName = `ev_${Date.now()}_${rand}.${ext}`;
                                const outFilePath = join(evidenceDir, fileName);
                                try {
                                    const buffer = Buffer.from(emb.data, 'base64');
                                    fs.writeFileSync(outFilePath, buffer);
                                    evidence.push(`evidence/${fileName}`);
                                } catch {}
                            }
                        }
                    }

                    scenarioResults.push({
                        target,
                        name: el.name || target,
                        status,
                        trace,
                        evidence
                    });
                }
            }
        }
    }

    if (scenarioResults.length === 0) {
        console.log(yellow(`\nNo scenario execution elements found in ${results}.`));
        return;
    }

    // Determine Run Target File
    const dest = target || out;
    let runFilePath: string;

    const trTag = findNextIdentity(dir, configClass.getIdentity('testrun')) || configClass.getFallbackIdentityTag('testrun');
    const trHeaderTag = (SCOPE_CONFIG as any)['testrun']?.tag || '@testrun';

    if (dest) {
        runFilePath = isAbsolute(dest) ? dest : resolve(dir, dest);
        const parentDir = dirname(runFilePath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
    } else {
        const now = new Date();
        const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
        const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const runExt = configClass.getScopeExtension('testrun');
        const runFileName = `${YYYYMMDD}_${HHmmss}_imported${runExt}`;
        runFilePath = join(absRunsDir, runFileName);
    }

    // Write or Update Run Feature File
    if (fs.existsSync(runFilePath)) {
        // File already exists -> update matching scenarios or append missing ones
        const existingContent = fs.readFileSync(runFilePath, 'utf-8');
        const lines = existingContent.split('\n');
        const newLines: string[] = [];

        const handledTargets = new Set<string>();
        let inTargetScenario = false;
        let currentSc: ScenarioResult | undefined;
        let statusUpdated = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            if (trimmedLine.startsWith('Scenario:')) {
                inTargetScenario = false;
                currentSc = undefined;
                statusUpdated = false;

                const scTitle = trimmedLine.replace(/^Scenario:\s*/, '').trim();
                const match = scenarioResults.find(r =>
                    scTitle.toLowerCase() === r.target.toLowerCase() ||
                    (r.name && scTitle.toLowerCase() === r.name.toLowerCase()) ||
                    (r.target.includes('@tc-') && scTitle.includes(r.target.match(/@tc-[\w-]+/i)?.[0] || ''))
                );

                if (match) {
                    inTargetScenario = true;
                    currentSc = match;
                    handledTargets.add(match.target);
                }
                newLines.push(line);
                continue;
            }

            if (inTargetScenario && currentSc) {
                if (trimmedLine.startsWith('Scenario:') || trimmedLine.startsWith('Rule:') || (trimmedLine.startsWith('@') && !trimmedLine.includes('set') && !trimmedLine.includes('mark'))) {
                    inTargetScenario = false;
                    currentSc = undefined;
                } else {
                    if (trimmedLine.startsWith('* set status =') || trimmedLine.startsWith('* mark status =')) {
                        newLines.push(`    * set status = ${currentSc.status}`);
                        statusUpdated = true;
                        if (currentSc.duration) {
                            newLines.push(`    * set duration = ${currentSc.duration}`);
                        }
                        if (currentSc.trace) {
                            newLines.push(`    * set trace = ${currentSc.trace.split('\n')[0].trim()}`);
                        }
                        if (currentSc.evidence.length > 0) {
                            const evVal = currentSc.evidence.length === 1 ? currentSc.evidence[0] : JSON.stringify(currentSc.evidence);
                            newLines.push(`    * set evidence = ${evVal}`);
                        }
                        continue;
                    }
                    if (trimmedLine.startsWith('* set trace =') || trimmedLine.startsWith('* set evidence =') || trimmedLine.startsWith('* set duration =') ||
                        trimmedLine.startsWith('* mark trace =') || trimmedLine.startsWith('* mark evidence =')) {
                        continue;
                    }
                }
            }

            newLines.push(line);
        }

        // Append any unhandled scenarios
        const remaining = scenarioResults.filter(r => !handledTargets.has(r.target));
        if (remaining.length > 0) {
            newLines.push('');
            for (const sc of remaining) {
                newLines.push(`  Scenario: ${sc.target}`);
                newLines.push(`    * set status = ${sc.status}`);
                if (sc.duration) {
                    newLines.push(`    * set duration = ${sc.duration}`);
                }
                if (sc.trace) {
                    newLines.push(`    * set trace = ${sc.trace.split('\n')[0].trim()}`);
                }
                if (sc.evidence.length > 0) {
                    const evVal = sc.evidence.length === 1 ? sc.evidence[0] : JSON.stringify(sc.evidence);
                    newLines.push(`    * set evidence = ${evVal}`);
                }
                newLines.push('');
            }
        }

        fs.writeFileSync(runFilePath, newLines.join('\n').trim() + '\n', 'utf-8');
        console.log(green(bold(`\n✓ Successfully updated testrun suite: ${runFilePath}`)));
        console.log(`  Updated/appended ${scenarioResults.length} test scenario result(s).`);
    } else {
        // Create new run file
        let runContent = `${trHeaderTag} ${trTag}\nFeature: Results from ${basename(results)}\n\n`;
        for (const sc of scenarioResults) {
            runContent += `  Scenario: ${sc.target}\n`;
            runContent += `    * set status = ${sc.status}\n`;
            if (sc.duration) {
                runContent += `    * set duration = ${sc.duration}\n`;
            }
            if (sc.trace) {
                const firstLine = sc.trace.split('\n')[0].replace(/\r/g, '').trim();
                runContent += `    * set trace = ${firstLine}\n`;
            }
            if (sc.evidence.length > 0) {
                if (sc.evidence.length === 1) {
                    runContent += `    * set evidence = ${sc.evidence[0]}\n`;
                } else {
                    runContent += `    * set evidence = ${JSON.stringify(sc.evidence)}\n`;
                }
            }
            runContent += `\n`;
        }
        fs.writeFileSync(runFilePath, runContent.trim() + '\n', 'utf-8');
        console.log(green(bold(`\n✓ Successfully generated testrun suite: ${runFilePath}`)));
        console.log(`  Imported ${scenarioResults.length} test scenario result(s).`);
    }

    // Handle auto-create-bugs
    if (autoCreateBugs) {
        const failedScenarios = scenarioResults.filter(s => s.status === 'failed');
        if (failedScenarios.length > 0) {
            const bugsConvention = configClass.getConvention('bug');
            const bugsDir = bugsConvention?.directory || 'tests/bugs';
            const absBugsDir = join(dir, bugsDir);
            if (!fs.existsSync(absBugsDir)) {
                fs.mkdirSync(absBugsDir, { recursive: true });
            }

            const now = new Date();
            const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
            const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');
            const bugExt = configClass.getScopeExtension('bug');
            const bugFileName = `${YYYYMMDD}_${HHmmss}_bugs${bugExt}`;
            const bugFilePath = join(absBugsDir, bugFileName);

            const bgHeaderTag = (SCOPE_CONFIG as any)['bug']?.tag || '@bug';
            let bugContent = `${bgHeaderTag}\nFeature: Bugs from ${basename(runFilePath)}\n\n`;

            for (const fail of failedScenarios) {
                const nextBgTag = findNextIdentity(dir, configClass.getIdentity('bug')) || configClass.getFallbackIdentityTag('bug');
                bugContent += `  ${nextBgTag}\n`;
                bugContent += `  Scenario: Bug in ${fail.name}\n`;
                bugContent += `    * set target = ${fail.target}\n`;
                bugContent += `    * set status = failed\n`;
                bugContent += `    * set severity = high\n`;
                if (fail.trace) {
                    const firstLine = fail.trace.split('\n')[0].replace(/\r/g, '').trim();
                    bugContent += `    * set trace = ${firstLine}\n`;
                }
                if (fail.evidence.length > 0) {
                    if (fail.evidence.length === 1) {
                        bugContent += `    * set evidence = ${fail.evidence[0]}\n`;
                    } else {
                        bugContent += `    * set evidence = ${JSON.stringify(fail.evidence)}\n`;
                    }
                }
                bugContent += `\n`;
            }

            fs.writeFileSync(bugFilePath, bugContent.trim() + '\n', 'utf-8');
            console.log(green(bold(`✓ Successfully generated bug specification: ${bugFilePath}`)));
            console.log(`  Created ${failedScenarios.length} bug scenario(s) from failed tests.`);
        } else {
            console.log(green(`\n✓ No failed tests encountered. No bug specifications created.`));
        }
    }
}
export const importCmd = async (options: ImportCmdOptions) => {
    const {
        dir = '.',
        scope: rawScope,
        identityArg,
        issueNumber,
        results,
        autoCreateBugs,
        lock = true,
        lockTimeout = '0s',
        statePath,
        backupPath
    } = options;

    if (results) {
        await runImportResults({ dir, results, target: options.target || options.out, autoCreateBugs });
        return;
    }

    if (!identityArg || !issueNumber) {
        Diag.usage({
            syntax: `${TITLE_CLI} import <address> <issueNumber> | -results="cucumber.json"`,
            detail: [
                `Associate an existing remote issue with a local scenario, or import execution results.`,
                `Examples:`,
                `  ${TITLE_CLI} import Magento/cart.case.feature.@tc-01 42`,
                `  ${TITLE_CLI} import -results="cucumber.json"`,
                `  ${TITLE_CLI} import -results="cucumber.json" -auto-create-bugs`
            ]
        }).abort();
        return;
    }

    const scope: IScope = rawScope || detectScopeFromTarget(identityArg) || 'testcase';
    console.log(bold(`Importing ${scope} ${identityArg} from issue #${issueNumber}...`));

    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);

    try {
        const state = stateObj;

        const basePath = resolve(dir);
        const configClass = new Config(dir, false);
        const config: IConfig = configClass.getConfig();
        let github: IProviderAdapter;
        if (configClass.getAdapterType() === 'local') {
            github = new LocalAdapter(dir);
        } else {
            github = new GitHubAdapter(configClass.getGitHub()!);
        }

        // Validate issueNumber
        const issueNum = parseInt(issueNumber, 10);
        if (isNaN(issueNum)) {
            console.error(red(`Invalid issue number: ${issueNumber}`));
            process.exit(1);
        }

        // If short identity, scan scenarios to find the matching one
        let identity = identityArg;

        const conf = new Config(dir);
        const data = {
            identity: conf.getIdentity(scope),
            fields: conf.getFields(scope),
        };

        // Read all scenarios using parser
        const parser = new Parser(dir);
        const documents = parser.content();
        const rawScenarios = documents.filter(s => matchesScope(s, scope));
        let filtered = parser.filter(rawScenarios, data, scope) || [];



        // Attempt to resolve identity
        const matchedScenario = filtered.find(s => {
            const rawId = s.custom?.identity;
            if (!rawId) return false;

            const fullId = (scope === 'testrun' || scope === 'testplan')
                ? rawId
                : `${s.uri}.${rawId}`;

            // Exact match, ends with, or matches via target selector
            return fullId === identityArg || fullId.endsWith(identityArg) || identityArg.endsWith(fullId) ||
                matchesTarget(fullId, identityArg, scope) || matchesTarget(rawId, identityArg, scope);
        });

        if (matchedScenario) {
            const rawId = matchedScenario.custom?.identity;
            identity = (scope === 'testrun' || scope === 'testplan')
                ? (rawId || identityArg)
                : `${matchedScenario.uri}.${rawId}`;
            console.log(`Resolved short identity to full identity: ${identity}`);
        } else {
            console.log(yellow(`Warning: Could not find matching local scenario for identity: ${identityArg}`));
            console.log(yellow(`Import will proceed with the exact identity provided, but it might not map to any local file.`));
        }

        // Fetch from Provider
        console.log(`Fetching issue #${issueNum} from remote provider...`);
        const providerResources = (github as any).resources || (github as any).apis;
        const resHandler = providerResources?.[scope] || providerResources?.issue || (providerResources ? Object.values(providerResources)[0] : null);
        const issue = resHandler?.read
            ? await resHandler.read(issueNum)
            : (resHandler?.get ? await resHandler.get(issueNum) : (typeof (github as any).getIssue === 'function' ? await (github as any).getIssue(issueNum) : null));

        if (!issue) {
            console.error(red(`Issue #${issueNum} not found in GitHub repository or remote provider.`));
            process.exit(1);
        }

        if (issue.state === 'closed') {
            console.log(yellow(`Warning: Issue #${issueNum} is currently closed.`));
        }

        if (!Object.prototype.hasOwnProperty.call(SCOPE_RESOURCE_MAP, scope)) {
            console.error(red(`Invalid scope: ${scope}`));
            process.exit(1);
        }
        const resourceType = SCOPE_RESOURCE_MAP[scope];
        const remoteId = github.formatRemoteId(issueNum);

        // Fetch custom fields
        let customFields: Record<string, string> = {};
        if (issue.node_id) {
            customFields = (github as any).getProjectItemFields ? await (github as any).getProjectItemFields(issue.node_id) : {};
        }

        // Auto-reconstruct code if not matched
        if (!matchedScenario && scope === 'testcase' && identity.includes('.')) {
            const lastDot = identity.lastIndexOf('.');
            const rawFilePath = identity.slice(0, lastDot);
            const tag = identity.slice(lastDot + 1);
            const filePath = normalize(resolve(basePath, rawFilePath));
            
            if (!filePath.startsWith(basePath)) {
                console.error(red(`Invalid file path in identity.`));
                process.exit(1);
            }

            if (fs.existsSync(filePath)) {
                // Find sibling to get global context
                const sibling = rawScenarios.find(s => s.uri === filePath);
                const globalTags = sibling?.feature?.tags || [];

                const bgFields = new Map<string, string>();
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const bgMatch = fileContent.match(/Background:([\s\S]*?)(?=\n\s*@|\n\s*Scenario:|$)/);
                if (bgMatch) {
                    const bgText = bgMatch[1];
                    for (const line of bgText.split('\n')) {
                        const match = line.match(/^\s*(?:\*|Given|When|Then|And)\s+field\s+([A-Za-z0-9_.\- ]+?)\s*=\s*(.+)$/i);
                        if (match) {
                            bgFields.set(match[1].trim().toLowerCase(), match[2].trim());
                        }
                    }
                }

                const fieldDefs = conf.getFields(scope) || [];
                const tagsToAppend: string[] = [];
                const keywordsToAppend: string[] = [];

                // Process Labels
                const issueLabels = issue.labels || [];
                const labelsDef = fieldDefs.find(f => f.name === 'labels');
                const defaultLabel = labelsDef?.default ? String(labelsDef.default) : '';

                for (const l of issueLabels) {
                    if (globalTags.includes(l) || globalTags.includes(`@${l}`)) continue;
                    if (l === defaultLabel) continue;
                    tagsToAppend.push(`@${l}`);
                }

                // Process Custom Fields
                for (const def of fieldDefs) {
                    if (def.name === 'labels' || def.name === 'assignees' || def.name === 'milestone') continue;

                    const remoteKeyMatch = Object.keys(customFields).find(k => k.toLowerCase() === def.name.toLowerCase());
                    const remoteVal = remoteKeyMatch ? customFields[remoteKeyMatch] : '';
                    if (!remoteVal) continue; // Not set in remote

                    const defDefault = def.default ? String(def.default) : '';

                    // Case-insensitive comparisons
                    const isDefault = remoteVal.toLowerCase() === defDefault.toLowerCase();
                    const bgVal = bgFields.get(def.name.toLowerCase());
                    const isBg = bgVal && bgVal.toLowerCase() === remoteVal.toLowerCase();

                    if (isDefault || isBg) continue;

                    if (def.source === 'tag') {
                        // For tags, check if the remote value (e.g. '@high' or 'high') is already in global tags
                        const cleanRemoteTag = remoteVal.startsWith('@') ? remoteVal : `@${remoteVal}`;
                        if (!globalTags.includes(cleanRemoteTag) && !globalTags.includes(cleanRemoteTag.substring(1))) {
                            tagsToAppend.push(cleanRemoteTag);
                        }
                    } else if (def.source === 'step') {
                        keywordsToAppend.push(`* field ${def.name} = ${remoteVal}`);
                    }
                }

                let gherkinBody = issue.body || '';
                const match = gherkinBody.match(/```gherkin\n([\s\S]*?)```/);
                if (match) {
                    gherkinBody = match[1].trim();
                } else {
                    gherkinBody = gherkinBody.trim();
                }

                if (gherkinBody) {
                    const tagLine = tagsToAppend.length > 0 ? `  ${tag} ${tagsToAppend.join(' ')}\n` : `  ${tag}\n`;
                    const keywordLines = keywordsToAppend.length > 0 ? keywordsToAppend.map(k => `    ${k}\n`).join('') : '';
                    const bodyLines = gherkinBody.split('\n').map((l: string) => `    ${l}`).join('\n') + `\n`;

                    const scenarioContent = `\n\n${tagLine}  Scenario: ${issue.title}\n${keywordLines}${bodyLines}`;
                    fs.appendFileSync(filePath, scenarioContent);
                    console.log(green(`\nAutomatically reconstructed scenario code in ${filePath}`));
                }
            }
        }

        // Calculate local hash if a matching scenario was found, otherwise empty hash
        let localHash = '';
        if (matchedScenario) {
            localHash = hashScenario(matchedScenario);
        }

        
        const scaffoldDir = conf.getConvention(scope)?.directory;
        let address = identity;
        let relPath = '';
        let tag = '';
        let namespace: string | undefined;
        let physicalAddress = '';

        if (matchedScenario) {
            const idInfo = computeResourceIdentity(matchedScenario, scope, scaffoldDir);
            if (idInfo) {
                address = idInfo.address;
                relPath = idInfo.path;
                tag = idInfo.tag || '';
                namespace = idInfo.namespace;
                physicalAddress = idInfo.physicalAddress;
            }
        } else {
            tag = identity.includes('@') ? identity.slice(identity.lastIndexOf('@')) : '';
            relPath = identity.includes('@') ? identity.slice(0, identity.lastIndexOf('@')).replace(/\.$/, '') : identity;
            physicalAddress = tag ? `${relPath}.${tag}` : relPath;
        }

        // Save to state
        state.upsertResource({
            type: resourceType,
            address,
            path: relPath,
            tag,
            physicalAddress,
            ...(namespace ? { namespace } : {}),
            attributes: {
                title: issue.title,
                body: issue.body || '',
                labels: issue.labels?.filter((l: any) => l.name).map((l: any) => l.name) ?? [],
                assignees: issue.assignees || [],
                milestone: issue.milestone || undefined,
                custom_fields: customFields,
                remoteId,
                issueNumber: issue.number,
                localHash
            },
            lastApplied: new Date().toISOString()
        });
        state.save();

        console.log(green(`\nImport successful!`));
        console.log(`State updated for ${bold(`${resourceType}.${address}`)} -> Issue #${issueNum}`);
        console.log(`Run 'plan' to see if any local changes need to be applied.`);
    } finally {
        await stateObj.save();
        await stateObj.releaseLock();
    }
};
