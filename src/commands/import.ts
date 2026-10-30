import { IConfig, IScope } from '../core/types';
import { resolve, normalize, join, basename } from 'path';
import { Config } from '../core/config';
import { State } from '../core/state';
import { GitHubProvider, GitHubAdapter } from '../providers/github';
import { LocalProvider, LocalAdapter } from '../providers/local';
import { IProvider, IProviderAdapter } from '../providers/interface';
import { Parser } from '../core/parser';
import { resource } from '../core/resources';
import { bold, green, red, yellow } from "chalk";
import { hashScenario } from "./plan";
import fs from "fs";
import { Logger } from '../core/logger';
import { Diag } from '../core/diagnostics';
import { findNextIdentity } from '../core/editor';

import { FILE_CONFIG, SCOPE_CONFIG, SCOPE_RESOURCE_MAP, TITLE_CLI } from '../core/const';
import { matchesScope, detectScopeFromTarget } from '../core/selector';

interface ImportCmdOptions {
    dir?: string;
    scope?: IScope;
    identityArg?: string;
    issueNumber?: string;
    results?: string;
    autoCreateBugs?: boolean;
    lock?: boolean;
    lockTimeout?: string;
    statePath?: string;
    backupPath?: string;
}

async function runImportResults(options: {
    dir: string;
    results: string;
    autoCreateBugs?: boolean;
}) {
    const { dir, results, autoCreateBugs } = options;
    const fullResultsPath = resolve(dir, results);

    if (!fs.existsSync(fullResultsPath)) {
        Diag.error({
            title: `Execution results file not found: ${results}`,
            detail: [`Verify the file path provided in -results="${results}".`]
        }).abort();
        return;
    }

    let parsedResults: any[];
    try {
        const raw = fs.readFileSync(fullResultsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        parsedResults = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e: any) {
        Diag.error({
            title: `Failed to parse results file: ${results}`,
            detail: [`The file does not contain valid JSON: ${e.message}`]
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
        trace?: string;
        evidence: string[];
    }

    const scenarioResults: ScenarioResult[] = [];

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

                // Process embeddings
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
                        } catch {
                            // ignore write error
                        }
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

    if (scenarioResults.length === 0) {
        console.log(yellow(`\nNo scenario execution elements found in ${results}.`));
        return;
    }

    // Determine Run Identity and Filename
    const now = new Date();
    const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
    const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const trTag = findNextIdentity(dir, configClass.getIdentity('testrun')) || configClass.getFallbackIdentityTag('testrun');
    const runExt = configClass.getScopeExtension('testrun');
    const runFileName = `${YYYYMMDD}_${HHmmss}_imported${runExt}`;
    const runFilePath = join(absRunsDir, runFileName);

    const trHeaderTag = (SCOPE_CONFIG as any)['testrun']?.tag || '@testrun';
    let runContent = `${trHeaderTag} ${trTag}\nFeature: Results from ${basename(results)}\n\n`;

    for (const sc of scenarioResults) {
        runContent += `  Scenario: ${sc.target}\n`;
        runContent += `    * mark status = ${sc.status}\n`;
        if (sc.trace) {
            const firstLine = sc.trace.split('\n')[0].replace(/\r/g, '').trim();
            runContent += `    * mark trace = ${firstLine}\n`;
        }
        if (sc.evidence.length > 0) {
            if (sc.evidence.length === 1) {
                runContent += `    * mark evidence = ${sc.evidence[0]}\n`;
            } else {
                runContent += `    * mark evidence = ${JSON.stringify(sc.evidence)}\n`;
            }
        }
        runContent += `\n`;
    }

    fs.writeFileSync(runFilePath, runContent.trim() + '\n', 'utf-8');
    console.log(green(bold(`\n✓ Successfully generated testrun suite: ${runFilePath}`)));
    console.log(`  Imported ${scenarioResults.length} test scenario result(s).`);

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

            const bugExt = configClass.getScopeExtension('bug');
            const bugFileName = `${YYYYMMDD}_${HHmmss}_bugs${bugExt}`;
            const bugFilePath = join(absBugsDir, bugFileName);

            const bgHeaderTag = (SCOPE_CONFIG as any)['bug']?.tag || '@bug';
            let bugContent = `${bgHeaderTag}\nFeature: Bugs from ${basename(runFilePath)}\n\n`;

            for (const fail of failedScenarios) {
                const nextBgTag = findNextIdentity(dir, configClass.getIdentity('bug')) || configClass.getFallbackIdentityTag('bug');
                bugContent += `  ${nextBgTag}\n`;
                bugContent += `  Scenario: Bug in ${fail.name}\n`;
                bugContent += `    * mark target = ${fail.target}\n`;
                bugContent += `    * mark status = failed\n`;
                bugContent += `    * mark severity = high\n`;
                if (fail.trace) {
                    const firstLine = fail.trace.split('\n')[0].replace(/\r/g, '').trim();
                    bugContent += `    * mark trace = ${firstLine}\n`;
                }
                if (fail.evidence.length > 0) {
                    if (fail.evidence.length === 1) {
                        bugContent += `    * mark evidence = ${fail.evidence[0]}\n`;
                    } else {
                        bugContent += `    * mark evidence = ${JSON.stringify(fail.evidence)}\n`;
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
        await runImportResults({ dir, results, autoCreateBugs });
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
    const logger = new Logger();
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

            // Exact match or ends with the arg (e.g. test1.run.feature or tc1.case.feature.tc-01)
            return fullId === identityArg || fullId.endsWith(identityArg) || identityArg.endsWith(fullId);
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

        // Fetch from GitHub
        console.log(`Fetching issue #${issueNum} from GitHub...`);
        const issue = await github.getIssue(issueNum);

        if (!issue) {
            console.error(red(`Issue #${issueNum} not found in GitHub repository.`));
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
            customFields = github.getProjectItemFields ? await github.getProjectItemFields(issue.node_id) : {};
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
                    const bodyLines = gherkinBody.split('\n').map(l => `    ${l}`).join('\n') + `\n`;

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

        const payload = matchedScenario ? resource.evaluate(resourceType, matchedScenario, { state: stateObj }) : null;
        const p = payload as any;

        // Save to state
        state.upsertResource({
            type: resourceType,
            identity,
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
        console.log(`State updated for ${bold(`${resourceType}.${identity}`)} -> Issue #${issueNum}`);
        console.log(`Run 'plan' to see if any local changes need to be applied.`);
    } finally {
        await stateObj.save();
        await stateObj.releaseLock();
    }
};
