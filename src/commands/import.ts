import { IConfig, IScope } from "../types";
import { resolve, normalize, join } from 'path';
import { Config } from "../core/config";
import { State } from "../core/state";
import { GitHubAdapter } from "../adapters/github";
import { Parser } from "../core/parser";
import { resource } from "../adapters/resources";
import { bold, green, red, yellow } from "chalk";
import { hashScenario } from "./plan";
import fs from "fs";
import { Logger } from "../logger";

import { FILE_CONFIG, SCOPE_CONFIG, SCOPE_RESOURCE_MAP } from "../const";

export interface ImportCmdOptions {
    dir?: string;
    scope: IScope;
    identityArg: string;
    issueNumber: string;
    lock?: boolean;
    lockTimeout?: string;
    statePath?: string;
    backupPath?: string;
}

export const importCmd = async (options: ImportCmdOptions) => {
    const {
        dir = '.',
        scope,
        identityArg,
        issueNumber,
        lock = true,
        lockTimeout = '0s',
        statePath,
        backupPath
    } = options;
    const logger = new Logger();
    console.log(bold(`Importing ${scope} ${identityArg} from issue #${issueNumber}...`));

    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();
    await stateObj.acquireLock(lock, lockTimeout);

    try {
        const state = stateObj;

        const basePath = resolve(dir);
        const configPath = normalize(join(basePath, FILE_CONFIG));
        
        if (!configPath.startsWith(basePath)) {
            console.error(red(`Invalid configuration path.`));
            process.exit(1);
        }

        if (!fs.existsSync(configPath)) {
            console.error(red(`Configuration file ${FILE_CONFIG} not found in directory.`));
            process.exit(1);
        }
        const config: IConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const github = new GitHubAdapter(config.github!);

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

        const matchesScope = (s: any, scopeName: IScope) => {
            if (!Object.prototype.hasOwnProperty.call(SCOPE_CONFIG, scopeName)) return false;
            const cfg = SCOPE_CONFIG[scopeName as keyof typeof SCOPE_CONFIG];
            return s.feature?.tags?.includes(cfg.tag) || s.uri.endsWith(cfg.ext);
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
                : `${s.uri}::${rawId}`;

            // Exact match or ends with the arg (e.g. test1.run.feature or tc1.case.feature::@[1])
            return fullId === identityArg || fullId.endsWith(identityArg) || identityArg.endsWith(fullId);
        });

        if (matchedScenario) {
            const rawId = matchedScenario.custom?.identity;
            identity = (scope === 'testrun' || scope === 'testplan')
                ? (rawId || identityArg)
                : `${matchedScenario.uri}::${rawId}`;
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
            customFields = await github.getProjectItemFields(issue.node_id);
        }

        // Auto-reconstruct code if not matched
        if (!matchedScenario && scope === 'testcase' && identity.includes('::')) {
            const [rawFilePath, tag] = identity.split('::');
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

                    if (def.type === 'tags') {
                        // For tags, check if the remote value (e.g. '@high' or 'high') is already in global tags
                        const cleanRemoteTag = remoteVal.startsWith('@') ? remoteVal : `@${remoteVal}`;
                        if (!globalTags.includes(cleanRemoteTag) && !globalTags.includes(cleanRemoteTag.substring(1))) {
                            tagsToAppend.push(cleanRemoteTag);
                        }
                    } else if (def.type === 'keywords') {
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
                labels: issue.labels || [],
                assignees: issue.assignees || [],
                milestone: issue.milestone || '',
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
