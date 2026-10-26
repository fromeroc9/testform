import { existsSync, readdirSync } from 'fs';
import { resolve, extname } from 'path';
import { pathToFileURL } from 'url';
import { TITLE_APP, TITLE_CLI } from '../core/const';
import { logger as notify } from '../core/logger';
import { bold, green, red, yellow, dim } from 'chalk';
import {
    ParserScenario, PlanAction, PlanChange,
    ResourceField, ResourceTemplate, ResourceFormat
} from '../core/types';
import { formatIdentityDisplay, formatHclValue } from '../core/utils';

class Resource {
    private builtinTemplates: Record<string, ResourceTemplate> = Object.create(null);
    private userTemplates: Record<string, ResourceTemplate> = Object.create(null);

    private resolve(): ResourceTemplate[] {
        const merged: Record<string, ResourceTemplate> = {
            ...this.builtinTemplates,
            ...this.userTemplates,
        };
        return Object.values(merged);
    }

    private get(type: string): ResourceTemplate {
        const templates = this.resolve();
        let template = templates.find(t => t.type === type);
        if (!template && type.includes('_')) {
            const canonical = type.split('_').slice(1).join('_');
            template = templates.find(t => t.type === canonical || t.type.endsWith(`_${canonical}`));
        }
        if (!template) {
            template = templates.find(t => t.type.endsWith(`_${type}`));
        }
        if (!template) {
            notify.push({
                type: 'error',
                title: `Unknown resource type: "${type}"`,
                detail: [
                    `No template is registered for resource type "${type}".`,
                    `Available types: ${templates.map(t => t.type).join(', ') || '(none)'}`,
                ],
                close: true,
            });
        }
        return template!;
    }

    registry(template: ResourceTemplate, type: 'system' | 'user' = 'system'): void {
        if (type === 'system') {
            this.builtinTemplates[template.type] = template;
        }

        if (type === 'user') {
            const existing = this.builtinTemplates[template.type] || this.userTemplates[template.type];
            if (existing) {
                // Merge fields by name: user fields override existing fields, other fields are preserved
                const fieldMap = new Map(existing.fields.map(f => [f.name, f]));
                if (template.fields) {
                    for (const field of template.fields) {
                        fieldMap.set(field.name, field);
                    }
                }
                this.userTemplates[template.type] = {
                    ...existing,
                    ...template,
                    fields: Array.from(fieldMap.values()),
                    comments: template.comments !== undefined ? template.comments : existing.comments,
                };
            } else {
                this.userTemplates[template.type] = template;
            }
        }
    }

    async loadCustomResources(dir: string): Promise<void> {
        const candidateDirs = [
            resolve(dir, '.testform', 'resources'),
            resolve(dir, 'resources'),
        ];

        // Modules support: .testform/modules/*/resources and .testform/modules/*/.testform/resources
        const modulesDir = resolve(dir, '.testform', 'modules');
        if (existsSync(modulesDir)) {
            try {
                const entries = readdirSync(modulesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        candidateDirs.push(resolve(modulesDir, entry.name, 'resources'));
                        candidateDirs.push(resolve(modulesDir, entry.name, '.testform', 'resources'));
                    }
                }
            } catch {
                // Ignore unreadable modules dir
            }
        }

        const validExts = ['.js', '.mjs', '.cjs', '.ts'];
        for (const cDir of candidateDirs) {
            if (!existsSync(cDir)) continue;
            try {
                const files = readdirSync(cDir, { withFileTypes: true });
                for (const file of files) {
                    if (file.isFile()) {
                        const ext = extname(file.name).toLowerCase();
                        if (validExts.includes(ext)) {
                            const fullPath = resolve(cDir, file.name);
                            await this.loadResourceFile(fullPath);
                        }
                    }
                }
            } catch {
                // Ignore read errors
            }
        }
    }

    private async loadResourceFile(filePath: string): Promise<void> {
        let loadedModule: any;
        try {
            loadedModule = await import(pathToFileURL(filePath).href);
        } catch {
            try {
                loadedModule = require(filePath);
            } catch {
                return;
            }
        }

        const exported = loadedModule?.default || loadedModule;
        if (!exported) return;

        // 1. Direct template definition: { type, fields, comments }
        if (exported.type && Array.isArray(exported.fields)) {
            this.registry(exported, 'user');
            return;
        }

        // 2. Array of template definitions: [{ type, ... }, { type, ... }]
        if (Array.isArray(exported)) {
            for (const item of exported) {
                if (item?.type && Array.isArray(item.fields)) {
                    this.registry(item, 'user');
                }
            }
            return;
        }

        // 3. Factory function: (context) => void
        if (typeof exported === 'function') {
            try {
                exported({
                    registerResource: (t: ResourceTemplate) => this.registry(t, 'user'),
                    resource: this
                });
            } catch {
                // Ignore factory error
            }
        }
    }

    evaluate(type: string, scenario: ParserScenario, context?: any): Record<string, any> {
        const template = this.get(type);
        const result: Record<string, any> = {};
        for (const field of template.fields) {
            if (field.knownAfterApply) continue;
            result[field.name] = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
        }
        return result;
    }

    evaluateComments(type: string, scenario: ParserScenario, context?: any): { identity: string; status: string; body: string; title: string }[] {
        const template = this.get(type);
        if (template.comments) {
            return template.comments(scenario, context);
        }
        return [];
    }

    private getSymbol(type: PlanAction) {
        const symbol = {
            add: green('+'),
            change: yellow('~'),
            destroy: red('-'),
            replace: `${red('-')}/${green('+')}`,
        }[type]
        return symbol
    }

    private getSymbols(changes: PlanChange[]) {
        const actions = new Set(changes.map((c) => c.action));

        const symbols: Record<string, string> = {
            add: `${green('+')} create`,
            change: `${yellow('~')} update in-place`,
            destroy: `${red('-')} destroy`,
            replace: `${red('-')}/${green('+')} destroy and then create replacement`,
        };

        const result = [];
        if (actions.has('add')) result.push(symbols.add);
        if (actions.has('change')) result.push(symbols.change);
        if (actions.has('destroy')) result.push(symbols.destroy);
        if (actions.has('replace')) result.push(symbols.replace);

        return result.map(s => `  ${s}`).join('\n');
    }

    private format(change: PlanChange, context?: any) {
        const { action, scenario, resourceType, identity, oldAttributes } = change;


        const lines: string[] = [];
        const template = this.get(resourceType);
        const sym = this.getSymbol(action);
        const pad = (name: string) => name.padEnd(16);

        lines.push(`  ${sym} resource "${resourceType}" "${formatIdentityDisplay(identity)}" {`);
        for (const field of template.fields) {
            const raw = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
            const oldRaw = oldAttributes ? oldAttributes[field.name] : undefined;
            let valueStr = '';
            let fieldChanged = false;

            if (field.knownAfterApply) {
                valueStr = '(known after apply)';
                fieldChanged = true;
            } else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                let safeOldRaw = oldRaw;
                if (!safeOldRaw || typeof safeOldRaw !== 'object' || Array.isArray(safeOldRaw)) {
                    safeOldRaw = action === 'destroy' ? oldRaw : {};
                }
                const isDiffAction = action === 'change' || action === 'add' || action === 'replace';

                if (isDiffAction && safeOldRaw && typeof safeOldRaw === 'object' && !Array.isArray(safeOldRaw)) {
                    const allKeys = Array.from(new Set([...Object.keys(safeOldRaw), ...Object.keys(raw)])).sort();
                    const diffLines: string[] = [];
                    diffLines.push('{');
                    for (const k of allKeys) {
                        const oldVal = safeOldRaw[k];
                        const newVal = raw[k];
                        const kStr = `"${k}"`;

                        if (action === 'add') {
                            const formattedNewVal = formatHclValue(newVal, 2).trimStart();
                            diffLines.push(`          ${green('+')} ${kStr}: ${formattedNewVal}`);
                            fieldChanged = true;
                        } else if (oldVal === undefined) {
                            const formattedNewVal = formatHclValue(newVal, 2).trimStart();
                            diffLines.push(`          ${green('+')} ${kStr}: ${formattedNewVal}`);
                            fieldChanged = true;
                        } else if (newVal === undefined) {
                            const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                            diffLines.push(`          ${red('-')} ${kStr}: ${formattedOldVal}`);
                            fieldChanged = true;
                        } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                            const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                            const formattedNewVal = formatHclValue(newVal, 2).trimStart();
                            diffLines.push(`          ${yellow('~')} ${kStr}: ${formattedOldVal} -> ${formattedNewVal}`);
                            fieldChanged = true;
                        } else {
                            const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                            diffLines.push(`            ${kStr}: ${formattedOldVal}`);
                        }
                    }
                    diffLines.push('        }');
                    valueStr = diffLines.join('\n');
                } else {
                    const formattedLines = formatHclValue(raw, 2).split('\n');
                    valueStr = formattedLines.map((line: string, idx: number) => idx === 0 ? line.trimStart() : line).join('\n');
                    fieldChanged = true;
                }
            } else if (Array.isArray(raw)) {
                const formattedLines = formatHclValue(raw, 2).split('\n');
                valueStr = formattedLines.map((line: string, idx: number) => idx === 0 ? line.trimStart() : line).join('\n');
                if (action === 'change') {
                    fieldChanged = JSON.stringify(raw) !== JSON.stringify(oldRaw);
                } else {
                    fieldChanged = true;
                }
            } else if (typeof raw === 'string' && raw.includes('\n')) {
                const formattedLines = formatHclValue(raw, 2).split('\n');
                valueStr = formattedLines.map((line: string, idx: number) => idx === 0 ? line.trimStart() : line).join('\n');
                if (action === 'change') {
                    fieldChanged = raw !== oldRaw;
                } else {
                    fieldChanged = true;
                }
            } else {
                if (action === 'change' && raw !== oldRaw && oldRaw !== undefined) {
                    valueStr = `"${oldRaw}" -> "${raw}"`;
                    fieldChanged = true;
                } else {
                    valueStr = `"${raw}"`;
                    if (action === 'change') {
                        fieldChanged = raw !== oldRaw;
                    } else {
                        fieldChanged = true;
                    }
                }
            }

            if (action === 'add' || action === 'replace') {
                lines.push(`      ${sym} ${pad(field.name)}= ${valueStr}`);
            } else if (action === 'change') {
                if (field.knownAfterApply) {
                    lines.push(`        ${pad(field.name)}= ${valueStr}`);
                } else if (fieldChanged) {
                    lines.push(`      ${sym} ${pad(field.name)}= ${valueStr}`);
                } else {
                    lines.push(`        ${pad(field.name)}= ${valueStr}`);
                }
            } else if (action === 'destroy') {
                lines.push(`      ${sym} ${pad(field.name)}= ${valueStr} -> null`);
            }
        }
        lines.push('    }');
        return lines.join('\n');
    }

    summary(changes: PlanChange[], isPlanOnly: boolean = true, context?: any) {
        const output: string[] = [];

        if (changes.length === 0) {
            output.push('No changes. Your test matches the configuration.');

            if (!isPlanOnly) {
                output.push('');
                output.push(`${TITLE_APP} has compared your real test against your configuration and found no differences, so no`);
                output.push('changes are needed.');
                output.push('');
                output.push(green('Apply complete! Resources: 0 added, 0 changed, 0 destroyed.'));
            }

            console.log(output.join('\n'));
            return;
        }

        // Header
        output.push(`${TITLE_APP} used the selected providers to generate the following execution plan. Resource actions are indicated with the`);
        output.push('following symbols:');
        output.push(this.getSymbols(changes));
        output.push('');
        // Changes grouped by type
        output.push(`${TITLE_APP} will perform the following actions:`);


        output.push('');

        for (const change of changes) {
            const shortIdentity = formatIdentityDisplay(change.identity);
            const actionText =
                change.action === 'add'
                    ? bold(green(`# [${change.scenario.feature?.name || 'Unknown'}].${change.resourceType}.${shortIdentity} will be created`))
                    : change.action === 'change'
                        ? bold(yellow(`# ${change.resourceType}.${shortIdentity} will be updated in-place`))
                        : change.action === 'replace'
                            ? bold(red(`# ${change.resourceType}.${shortIdentity} must be replaced`))
                            : bold(red(`# ${change.resourceType}.${shortIdentity} will be destroyed`));

            output.push(`  ${actionText}`);

            // For destroy, add explanation comment
            if (change.action === 'destroy') {
                output.push(`  # (because ${change.resourceType}.${shortIdentity} is not in configuration)`);
            }

            output.push(this.format(change, context));
            output.push('');
        }

        // Summary
        const toAdd = changes.filter((c) => c.action === 'add').length;
        const toChange = changes.filter((c) => c.action === 'change').length;
        const toDestroy = changes.filter((c) => c.action === 'destroy').length;
        const toReplace = changes.filter((c) => c.action === 'replace').length;

        output.push(`${bold('Plan:')} ${toAdd + toReplace} to add, ${toChange} to change, ${toDestroy + toReplace} to destroy.`);
        output.push('');

        // Note
        if (isPlanOnly) {
            // Separator
            output.push(dim('─'.repeat(108)));
            output.push('');

            if (!context?.outPath) {
                output.push(`Note: You didn't use the -out option to save this plan, so ${TITLE_APP} can't guarantee to take exactly these`);
                output.push(`actions if you run "${TITLE_CLI} apply" now.`);
            }
        }

        console.log(output.join('\n'));
    }
}

export const resource = new Resource();
export const registerResource = (template: ResourceTemplate) => resource.registry(template, 'user');

resource.registry({
    type: 'github_testcase',
    fields: [
        { name: 'title', value: (s) => s.name },
        { name: 'body', value: (s) => '```gherkin\n' + s.steps.map((sp: any) => `${sp.keyword}${sp.text}`).join('\n') + '\n```' },
        { name: 'labels', value: (s) => {
            const idTag = s.custom?.identity?.startsWith('@') ? s.custom.identity.substring(1) : s.custom?.identity;
            return [...new Set([...(s.tags || [])].map(String).map(t => t.startsWith('@') ? t.substring(1) : t).filter(t => t !== idTag))];
        } },
        { name: 'assignees', value: (s) => (s.custom?.fields?.assignees || '').split(',').map((a: string) => a.trim()).filter(Boolean) },
        { name: 'milestone', value: (s) => s.custom?.fields?.milestone || '' },
        {
            name: 'custom_fields', value: (s) => {
                const fields = { ...(s.custom?.fields || {}) };
                delete fields['labels'];
                delete fields['assignees'];
                delete fields['milestone'];
                delete fields['status'];
                return fields;
            }
        }
    ]
});

resource.registry({
    type: 'github_testrun',
    fields: [
        { name: 'title', value: (s) => s.feature?.name || '' },
        {
            name: 'body', value: (s, context) => {
                let body = s.feature.description || '### 🚀 Test Run Execution\n\nThis issue serves as the central hub for tracking the execution of this Test Run. All associated test cases are linked below as tasks.\n\n**Instructions:**\n- Execution results for each test case will be recorded dynamically as comments on this issue.\n- Click on individual test case links to view their details or attach evidence.';

                const testcases = s.custom?.testcases || [];
                if (testcases.length > 0 && context?.state) {
                    const state = context.state;

                    const runIdentity = s.custom?.identity && s.custom.identity !== s.uri ? `${s.uri}.${s.custom.identity}` : s.uri;
                    const existingRun = state.getResources('github_testrun').find((r: any) => r.identity === runIdentity);
                    const existingStatuses = existingRun?.attributes?.testcaseStatuses || {};

                    const sortedTestcases = [...testcases].sort((a: string, b: string) => {
                        const aName = a.split('.').pop()?.replace('@', '') || '';
                        const bName = b.split('.').pop()?.replace('@', '') || '';
                        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
                    });

                    const allValidResources: any[] = [];
                    const notFoundTCs: string[] = [];

                    for (const tc of sortedTestcases) {
                        const parts = tc.split('.');
                        const scenarioName = parts.pop();
                        const ruleName = parts.join('.');
                        const baseRule = ruleName.replace('.case.feature', '').replace('.feature', '');

                        const tcResources = state.getResources('github_testcase').filter((r: any) =>
                            r.identity.includes(baseRule) && (scenarioName === '*' || r.identity.endsWith(`.${scenarioName}`))
                        );

                        const distinctFiles = new Set(tcResources.map((r: any) => {
                            const lastDot = r.identity.lastIndexOf('.');
                            return lastDot !== -1 ? r.identity.slice(0, lastDot) : r.identity;
                        }));
                        let validResources = tcResources;

                        if (distinctFiles.size > 1) {
                            if (context?.testDirectory) {
                                const normalizedTestDir = context.testDirectory.replace(/^\.\//, '');
                                validResources = tcResources.filter((r: any) => r.identity.startsWith(normalizedTestDir));
                                const distinctValid = new Set(validResources.map((r: any) => {
                                    const lastDot = r.identity.lastIndexOf('.');
                                    return lastDot !== -1 ? r.identity.slice(0, lastDot) : r.identity;
                                }));
                                if (distinctValid.size > 1) {
                                    throw new Error(`Multiple testcases found for rule "${ruleName}". Please specify a more exact path or use -test-directory to limit the scope.`);
                                }
                            } else {
                                throw new Error(`Multiple testcases found for rule "${ruleName}". Please specify a more exact path or use -test-directory to limit the scope.`);
                            }
                        }

                        if (validResources.length > 0) {
                            allValidResources.push(...validResources);
                        } else {
                            notFoundTCs.push(tc);
                        }
                    }

                    const uniqueResourcesMap = new Map();
                    for (const r of allValidResources) {
                        if (!uniqueResourcesMap.has(r.identity)) {
                            uniqueResourcesMap.set(r.identity, r);
                        }
                    }
                    const uniqueResources = Array.from(uniqueResourcesMap.values());

                    uniqueResources.sort((a: any, b: any) => {
                        const aName = a.identity.split('.').pop()?.replace('@', '') || '';
                        const bName = b.identity.split('.').pop()?.replace('@', '') || '';
                        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
                    });

                    const groupedByOrigin = new Map<string, any[]>();
                    for (const tcResource of uniqueResources) {
                        const lastDot = tcResource.identity.lastIndexOf('.');
                        const baseRule = lastDot !== -1 ? tcResource.identity.slice(0, lastDot) : tcResource.identity;
                        const originFile = require('path').basename(baseRule || '');
                        if (!groupedByOrigin.has(originFile)) {
                            groupedByOrigin.set(originFile, []);
                        }
                        groupedByOrigin.get(originFile)!.push(tcResource);
                    }

                    for (const [origin, resources] of groupedByOrigin.entries()) {
                        body += `\n\n**Origin:** ${origin}\n`;
                        for (const tcResource of resources) {
                            const tcIdentity = tcResource.identity;
                            const safeName = tcIdentity.split('.').pop()?.replace('@', '') || '';

                            let groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                                if (!gs.rule || !gs.name) return false;
                                const gsBaseRule = gs.rule.name.replace('.case.feature', '').replace('.feature', '');
                                return tcIdentity.includes(gsBaseRule) && tcIdentity.endsWith(`.${gs.name}`);
                            });

                            if (!groupScenario) {
                                groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                                    if (!gs.rule || !gs.name) return false;
                                    const gsBaseRule = gs.rule.name.replace('.case.feature', '').replace('.feature', '');
                                    return tcIdentity.includes(gsBaseRule) && gs.name === '*';
                                });
                            }

                            const localStatus = groupScenario?.custom?.fields?.status || existingStatuses[tcIdentity] || 'pending';
                            const checkbox = localStatus === 'passed' ? '[x]' : '[ ]';

                            if (tcResource?.attributes?.issueNumber) {
                                body += `- ${checkbox} ${safeName}: #${tcResource.attributes.issueNumber}\n`;
                            } else {
                                body += `- ${checkbox} ${safeName}: (known after apply) - ${tcIdentity}\n`;
                            }
                        }
                    }

                    if (notFoundTCs.length > 0) {
                        body += `\n\n**Not Found in State**\n`;
                        for (const tc of notFoundTCs) {
                            const safeName = tc.split('.').pop()?.replace('@', '') || '';
                            body += `- [ ] ${safeName}: (not found in state) - ${tc}\n`;
                        }
                    }
                }
                return body.trim();
            }
        },
        { name: 'labels', value: (s) => {
            const idTag = s.custom?.identity?.startsWith('@') ? s.custom.identity.substring(1) : s.custom?.identity;
            return [...new Set([...(s.tags || [])].map(String).map(t => t.startsWith('@') ? t.substring(1) : t).filter(t => t !== idTag))];
        } },
        { name: 'assignees', value: (s) => (s.custom?.fields?.assignees || '').split(',').map((a: string) => a.trim()).filter(Boolean) },
        { name: 'milestone', value: (s) => s.custom?.fields?.milestone || '' },
        {
            name: 'custom_fields', value: (s) => {
                const fields = { ...(s.custom?.fields || {}) };
                delete fields['labels'];
                delete fields['assignees'];
                delete fields['milestone'];
                delete fields['status'];
                return fields;
            }
        }
    ],
    comments: (s, context) => {
        const { evaluateGitHubTestrunComments } = require('../providers/github/templates');
        return evaluateGitHubTestrunComments(s, context);
    }
});

resource.registry({
    type: 'github_testplan',
    fields: [
        { name: 'title', value: (s) => s.feature?.name || '' },
        {
            name: 'body', value: (s, context) => {
                const { buildGitHubTestplanBody } = require('../providers/github/templates');
                return buildGitHubTestplanBody(s, context);
            }
        },
        { name: 'labels', value: (s) => {
            const idTag = s.custom?.identity?.startsWith('@') ? s.custom.identity.substring(1) : s.custom?.identity;
            return [...new Set([...(s.tags || [])].map(String).map(t => t.startsWith('@') ? t.substring(1) : t).filter(t => t !== idTag))];
        } },
        { name: 'assignees', value: (s) => (s.custom?.fields?.assignees || '').split(',').map((a: string) => a.trim()).filter(Boolean) },
        { name: 'milestone', value: (s) => s.custom?.fields?.milestone || '' },
        {
            name: 'custom_fields', value: (s) => {
                const fields = { ...(s.custom?.fields || {}) };
                delete fields['labels'];
                delete fields['assignees'];
                delete fields['milestone'];
                delete fields['status'];
                return fields;
            }
        },
        { name: 'testruns', value: (s) => s.custom?.testruns || [] }
    ]
});
