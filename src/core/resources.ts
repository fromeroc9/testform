import { existsSync, readdirSync } from 'fs';
import { resolve, extname, basename } from 'path';
import { pathToFileURL } from 'url';
import { TITLE_APP, TITLE_CLI } from '../core/const';
import { logger as notify } from '../core/logger';
import { bold, green, red, yellow, dim } from 'chalk';
import {
    ParserScenario, PlanAction, PlanChange,
    ResourceField, ResourceTemplate, ResourceFormat
} from '../core/types';
import { formatIdentityDisplay, formatResourceAddress, formatHclValue, calculateRollupVerdict } from '../core/utils';
import { arraysEqual } from '../core/sync';
import { buildGitHubTestplanBody, buildGitHubTestrunBody, buildGitHubBugBody } from '../providers/github/templates';

function deriveFieldsFromTemplate(template: ResourceTemplate): ResourceField[] {
    const fields: ResourceField[] = [];
    if (template.api) {
        for (const [k, v] of Object.entries(template.api)) {
            if (k === 'issue') {
                if (typeof v === 'function') {
                    fields.push(
                        { name: 'title', value: (s: any, ctx: any) => v(s, ctx)?.title },
                        { name: 'body', value: (s: any, ctx: any) => v(s, ctx)?.body },
                        { name: 'labels', value: (s: any, ctx: any) => v(s, ctx)?.labels },
                        { name: 'assignees', value: (s: any, ctx: any) => v(s, ctx)?.assignees },
                        { name: 'milestone', value: (s: any, ctx: any) => v(s, ctx)?.milestone }
                    );
                } else if (typeof v === 'object' && v !== null) {
                    for (const [subK, subV] of Object.entries(v)) {
                        fields.push({
                            name: subK,
                            value: typeof subV === 'function' ? subV : () => subV
                        });
                    }
                }
            } else if (k === 'project') {
                fields.push({
                    name: 'custom_fields',
                    value: (s: any, ctx: any) => {
                        const proj = typeof v === 'function' ? v(s, ctx) : v;
                        return proj?.fields || {};
                    }
                });
            } else if (typeof v === 'function') {
                fields.push({ name: k, value: v });
            } else {
                fields.push({ name: k, value: () => v });
            }
        }
    }
    if (template.state) {
        for (const [k, v] of Object.entries(template.state)) {
            fields.push({
                name: k,
                value: typeof v === 'function' ? v : () => v
            });
        }
    }
    return fields;
}

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

    public findTemplate(type: string): ResourceTemplate | undefined {
        const templates = this.resolve();
        let template = templates.find(t => t.type === type);
        if (!template && type.includes('_')) {
            const canonical = type.split('_').slice(1).join('_');
            template = templates.find(t => t.type === canonical || t.type.endsWith(`_${canonical}`));
        }
        if (!template) {
            template = templates.find(t => t.type.endsWith(`_${type}`));
        }
        return template;
    }

    private get(type: string): ResourceTemplate {
        const template = this.findTemplate(type);
        if (!template) {
            const templates = this.resolve();
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

    public getRegisteredTypes(): string[] {
        const types = new Set<string>();
        for (const t of this.resolve()) {
            types.add(t.type);
            if (t.type.includes('_')) {
                types.add(t.type.split('_').slice(1).join('_'));
            }
        }
        return Array.from(types);
    }

    registry(template: ResourceTemplate, type: 'system' | 'user' = 'system'): void {
        if (!template.fields || template.fields.length === 0) {
            template.fields = deriveFieldsFromTemplate(template);
        }

        if (type === 'system') {
            this.builtinTemplates[template.type] = template;
            return;
        }

        if (type === 'user') {
            const existing = this.findTemplate(template.type);
            if (existing) {
                const baseFields = existing.fields || [];
                const fieldMap = new Map(baseFields.map(f => [f.name, f]));
                for (const f of template.fields || []) {
                    fieldMap.set(f.name, f);
                }
                const merged: ResourceTemplate = {
                    ...existing,
                    ...template,
                    fields: Array.from(fieldMap.values())
                };
                this.userTemplates[template.type] = merged;
                if (existing.type !== template.type) {
                    this.userTemplates[existing.type] = merged;
                }
            } else {
                this.userTemplates[template.type] = template;
            }
            return;
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

        // 2. Array of template definitions
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

    evaluateApi(type: string, scenario: ParserScenario, context?: any): Record<string, any> {
        const template = this.get(type);
        const fieldsEvaluated = this.evaluate(type, scenario, context);

        if (template.api) {
            const result: Record<string, any> = {};
            for (const [apiKey, apiDef] of Object.entries(template.api)) {
                if (typeof apiDef === 'function') {
                    result[apiKey] = apiDef(scenario, context);
                } else if (apiDef && typeof apiDef === 'object') {
                    const subResult: Record<string, any> = {};
                    for (const [subKey, subVal] of Object.entries(apiDef)) {
                        subResult[subKey] = typeof subVal === 'function' ? subVal(scenario, context) : subVal;
                    }
                    result[apiKey] = subResult;
                } else {
                    result[apiKey] = apiDef;
                }
            }

            // Sync user overridden fields into api
            if (template.fields) {
                for (const field of template.fields) {
                    if (result.issue && Object.prototype.hasOwnProperty.call(result.issue, field.name)) {
                        result.issue[field.name] = fieldsEvaluated[field.name];
                    }
                    if (field.name === 'custom_fields' && result.project) {
                        result.project.fields = fieldsEvaluated[field.name];
                    }
                }
            }
            return result;
        }

        // Backward compatibility for legacy templates using only `fields`
        const issueFields: Record<string, any> = {};
        const projectFields: Record<string, any> = {};
        for (const [k, v] of Object.entries(fieldsEvaluated)) {
            if (k === 'custom_fields') {
                projectFields.fields = v;
            } else if (['title', 'body', 'labels', 'assignees', 'milestone'].includes(k)) {
                issueFields[k] = v;
            } else {
                issueFields[k] = v;
            }
        }
        return {
            issue: issueFields,
            project: projectFields,
            ...fieldsEvaluated
        };
    }

    evaluateState(type: string, scenario: ParserScenario, context?: any): Record<string, any> {
        const template = this.get(type);
        if (template.state) {
            const result: Record<string, any> = {};
            for (const [key, val] of Object.entries(template.state)) {
                result[key] = typeof val === 'function' ? val(scenario, context) : val;
            }
            return result;
        }

        // Backward compatibility: extract internal state fields from legacy fields if any
        if (template.fields) {
            const stateFields: Record<string, any> = {};
            for (const field of template.fields) {
                if (['status', 'testcases', 'testcaseTraces', 'testcaseEvidence', 'metadata', 'severity', 'priority', 'testruns', 'trace', 'evidence'].includes(field.name)) {
                    stateFields[field.name] = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
                }
            }
            return stateFields;
        }

        return {};
    }

    evaluate(type: string, scenario: ParserScenario, context?: any): Record<string, any> {
        const template = this.get(type);
        const result: Record<string, any> = {};
        for (const field of template.fields || []) {
            if (field.knownAfterApply) continue;
            result[field.name] = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
        }
        return result;
    }

    hasFieldChanges(type: string, scenario: ParserScenario, oldAttributes: Record<string, any>, context?: any): boolean {
        const newAttributes = this.evaluate(type, scenario, context);
        for (const [k, raw] of Object.entries(newAttributes)) {
            const oldRaw = oldAttributes ? oldAttributes[k] : undefined;

            if (raw === undefined && oldRaw === undefined) continue;
            if (k === 'milestone' && !raw && !oldRaw) continue;

            if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                const safeOldRaw = oldRaw && typeof oldRaw === 'object' && !Array.isArray(oldRaw) ? oldRaw : {};
                const allKeys = new Set([...Object.keys(safeOldRaw), ...Object.keys(raw)]);
                for (const subK of allKeys) {
                    const oldV = safeOldRaw[subK];
                    const newV = raw[subK];
                    if (oldV === undefined && newV === undefined) continue;
                    if (k === 'custom_fields') {
                        const cleanOld = String(oldV ?? '').replace(/^@/, '').toLowerCase().trim();
                        const cleanNew = String(newV ?? '').replace(/^@/, '').toLowerCase().trim();
                        if (cleanOld !== cleanNew) {
                            return true;
                        }
                    } else if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
                        return true;
                    }
                }
            } else if (Array.isArray(raw)) {
                const safeOldRaw = Array.isArray(oldRaw) ? oldRaw : (oldRaw ? [oldRaw] : []);
                if (!arraysEqual(raw, safeOldRaw)) return true;
            } else {
                const normRaw = String(raw ?? '').replace(/\r\n/g, '\n').trim();
                const normOldRaw = String(oldRaw ?? '').replace(/\r\n/g, '\n').trim();
                if (normRaw !== normOldRaw) {
                    return true;
                }
            }
        }
        return false;
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
        for (const field of template.fields || []) {
            const raw = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
            const oldRaw = oldAttributes ? oldAttributes[field.name] : undefined;
            if (raw === undefined && oldRaw === undefined) continue;
            if (field.name === 'milestone' && !raw && !oldRaw) continue;
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
                        } else {
                            let isKeyChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);
                            if (field.name === 'custom_fields') {
                                const cleanOld = String(oldVal ?? '').replace(/^@/, '').toLowerCase().trim();
                                const cleanNew = String(newVal ?? '').replace(/^@/, '').toLowerCase().trim();
                                isKeyChanged = cleanOld !== cleanNew;
                            }
                            if (isKeyChanged) {
                                const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                                const formattedNewVal = formatHclValue(newVal, 2).trimStart();
                                diffLines.push(`          ${yellow('~')} ${kStr}: ${formattedOldVal} -> ${formattedNewVal}`);
                                fieldChanged = true;
                            } else {
                                const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                                diffLines.push(`            ${kStr}: ${formattedOldVal}`);
                            }
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
                    const safeOldRaw = Array.isArray(oldRaw) ? oldRaw : (oldRaw ? [oldRaw] : []);
                    fieldChanged = !arraysEqual(raw, safeOldRaw);
                } else {
                    fieldChanged = true;
                }
            } else if (typeof raw === 'string' && raw.includes('\n')) {
                const formattedLines = formatHclValue(raw, 2).split('\n');
                valueStr = formattedLines.map((line: string, idx: number) => idx === 0 ? line.trimStart() : line).join('\n');
                if (action === 'change') {
                    const normRaw = raw.replace(/\r\n/g, '\n').trim();
                    const normOld = String(oldRaw ?? '').replace(/\r\n/g, '\n').trim();
                    fieldChanged = normRaw !== normOld;
                } else {
                    fieldChanged = true;
                }
            } else {
                const normRaw = String(raw ?? '').replace(/\r\n/g, '\n').trim();
                const normOld = String(oldRaw ?? '').replace(/\r\n/g, '\n').trim();
                if (action === 'change' && normRaw !== normOld && oldRaw !== undefined) {
                    valueStr = `"${oldRaw}" -> "${raw}"`;
                    fieldChanged = true;
                } else {
                    valueStr = `"${raw}"`;
                    if (action === 'change') {
                        fieldChanged = normRaw !== normOld;
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
            const address = formatResourceAddress(change.resourceType, change.identity);
            const actionText =
                change.action === 'add'
                    ? bold(green(`# ${address} will be created`))
                    : change.action === 'change'
                        ? bold(yellow(`# ${address} will be updated in-place`))
                        : change.action === 'replace'
                            ? bold(red(`# ${address} must be replaced`))
                            : bold(red(`# ${address} will be destroyed`));

            output.push(`  ${actionText}`);

            // For destroy, add explanation comment
            if (change.action === 'destroy') {
                output.push(`  # (because ${address} is not in configuration)`);
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

// ─── Built-in Resource Helpers ────────────────────────────────────────────────

function extractLabels(s: any, extraTag?: string): string[] {
    const idTag = s.custom?.identity?.startsWith('@') ? s.custom.identity.substring(1) : s.custom?.identity;
    const base: string[] = extraTag ? [...(s.tags || []), extraTag].map(String) : (s.tags || []).map(String);
    const cleaned = base.map((t: string) => t.startsWith('@') ? t.substring(1) : t).filter((t: string) => t !== idTag);
    return Array.from(new Set(cleaned));
}

function extractAssignees(s: any): string[] {
    return (s.custom?.fields?.assignees || '').split(',').map((a: string) => a.trim().replace(/^@/, '')).filter(Boolean);
}

function extractCustomFields(rawFields: Record<string, any> = {}, excludeKeys: string[] = []): Record<string, any> {
    const fields = { ...rawFields };
    for (const k of excludeKeys) {
        delete fields[k];
    }
    return fields;
}

function extractTestcaseStatusMap(s: any): Record<string, string> {
    const groupScenarios = s.custom?.groupScenarios || [];
    const map: Record<string, string> = {};
    for (const gs of groupScenarios) {
        if (gs.rule?.name && gs.name) {
            const key = `${gs.rule.name}.${gs.name}`.replace(/\\/g, '/');
            map[key] = gs.custom?.fields?.status || 'pending';
        } else if (gs.name) {
            const key = gs.name.replace(/\\/g, '/');
            map[key] = gs.custom?.fields?.status || 'pending';
        }
    }
    return map;
}

function extractTestcaseTraceMap(s: any): Record<string, string> {
    const groupScenarios = s.custom?.groupScenarios || [];
    const map: Record<string, string> = {};
    for (const gs of groupScenarios) {
        const trace = gs.custom?.fields?.trace || gs.custom?.fields?.error;
        if (trace) {
            const key = (gs.rule?.name && gs.name) ? `${gs.rule.name}.${gs.name}`.replace(/\\/g, '/') : (gs.name || '').replace(/\\/g, '/');
            if (key) map[key] = trace;
        }
    }
    return map;
}

function extractTestcaseEvidenceMap(s: any): Record<string, any> {
    const groupScenarios = s.custom?.groupScenarios || [];
    const map: Record<string, any> = {};
    for (const gs of groupScenarios) {
        const ev = gs.custom?.fields?.evidence;
        if (ev) {
            const key = (gs.rule?.name && gs.name) ? `${gs.rule.name}.${gs.name}`.replace(/\\/g, '/') : (gs.name || '').replace(/\\/g, '/');
            if (key) map[key] = Array.isArray(ev) ? ev : [ev];
        }
    }
    return map;
}

function calculatePlanRollup(s: any, context?: any): string {
    const trList = s.custom?.testruns || [];
    const state = context?.state;
    if (!state || trList.length === 0) return 'pending';
    const statuses: string[] = [];
    for (const tr of trList) {
        const normTr = String(tr).replace(/\\/g, '/');
        const trExt = context?.config?.getScopeExtension?.('testrun') || '.run.feature';
        const trBase = normTr.endsWith('.feature') ? normTr : (normTr.endsWith(trExt) ? normTr : normTr + trExt);
        const trFileName = basename(trBase);
        const found = state.getResources('github_testrun').find((r: any) => {
            const normId = (r.identity || '').replace(/\\/g, '/');
            const lastDot = normId.lastIndexOf('.');
            const base = lastDot !== -1 ? normId.slice(0, lastDot) : normId;
            return base.endsWith(normTr) || normId.endsWith(normTr) || base.endsWith(trFileName) || base === normTr;
        });
        statuses.push(found?.attributes?.status || 'pending');
    }
    return calculateRollupVerdict(statuses);
}

function extractPlanTestrunsMap(s: any, context?: any): Record<string, string> {
    const trList = s.custom?.testruns || [];
    const map: Record<string, string> = {};
    const state = context?.state;
    for (const tr of trList) {
        const normTr = String(tr).replace(/\\/g, '/');
        let status = 'pending';
        if (state) {
            const trExt = context?.config?.getScopeExtension?.('testrun') || '.run.feature';
            const trBase = normTr.endsWith('.feature') ? normTr : (normTr.endsWith(trExt) ? normTr : normTr + trExt);
            const trFileName = basename(trBase);
            const found = state.getResources('github_testrun').find((r: any) => {
                const normId = (r.identity || '').replace(/\\/g, '/');
                const lastDot = normId.lastIndexOf('.');
                const base = lastDot !== -1 ? normId.slice(0, lastDot) : normId;
                return base.endsWith(normTr) || normId.endsWith(normTr) || base.endsWith(trFileName) || base === normTr;
            });
            if (found?.attributes?.status) {
                status = found.attributes.status;
            }
        }
        map[normTr] = status;
    }
    return map;
}

// ─── Resource Registration ───────────────────────────────────────────────────

export const resource = new Resource();
export const registerResource = (template: ResourceTemplate) => resource.registry(template, 'user');

resource.registry({
    type: 'github_testcase',
    api: {
        issue: (s: any) => ({
            title: s.name,
            body: '```gherkin\n' + (s.steps || []).map((sp: any) => `${sp.keyword}${sp.text}`).join('\n') + '\n```',
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
        }),
        project: (s: any) => ({
            fields: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status'])
        })
    },
    state: {
        status: (s: any) => s.custom?.fields?.status || 'pending',
        metadata: (s: any) => s.custom?.metadata || {}
    }
});

resource.registry({
    type: 'github_testrun',
    api: {
        issue: (s: any, context?: any) => ({
            title: s.feature?.name || '',
            body: buildGitHubTestrunBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
        }),
        project: (s: any) => ({
            fields: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status'])
        })
    },
    state: {
        status: (s: any) => {
            const groupScenarios = s.custom?.groupScenarios || [];
            const statuses = groupScenarios.map((gs: any) => gs.custom?.fields?.status || 'pending');
            return calculateRollupVerdict(statuses);
        },
        testcases: (s: any) => extractTestcaseStatusMap(s),
        testcaseTraces: (s: any) => extractTestcaseTraceMap(s),
        testcaseEvidence: (s: any) => extractTestcaseEvidenceMap(s),
        metadata: (s: any) => s.custom?.metadata || {}
    }
});

resource.registry({
    type: 'github_testplan',
    api: {
        issue: (s: any, context?: any) => ({
            title: s.feature?.name || '',
            body: buildGitHubTestplanBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
        }),
        project: (s: any) => ({
            fields: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status'])
        })
    },
    state: {
        status: (s: any, context?: any) => calculatePlanRollup(s, context),
        testruns: (s: any, context?: any) => extractPlanTestrunsMap(s, context),
        metadata: (s: any) => s.custom?.metadata || {}
    }
});

resource.registry({
    type: 'github_bug',
    api: {
        issue: (s: any) => ({
            title: s.name || s.feature?.name || '',
            body: buildGitHubBugBody(s),
            labels: extractLabels(s, 'bug'),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
        }),
        project: (s: any) => ({
            fields: extractCustomFields(s.custom?.fields, [
                'labels', 'assignees', 'milestone', 'status', 'severity', 'priority',
                'trace', 'error', 'evidence', 'target', 'testcase', 'testrun'
            ])
        })
    },
    state: {
        status: (s: any) => s.custom?.fields?.status || 'failed',
        severity: (s: any) => s.custom?.fields?.severity || undefined,
        priority: (s: any) => s.custom?.fields?.priority || undefined,
        trace: (s: any) => s.custom?.fields?.trace || s.custom?.fields?.error || undefined,
        evidence: (s: any) => {
            const ev = s.custom?.fields?.evidence;
            return Array.isArray(ev) ? ev : (ev ? [ev] : []);
        },
        testcase: (s: any) => s.custom?.fields?.target || s.custom?.fields?.testcase || undefined,
        testrun: (s: any) => s.feature?.name || s.custom?.fields?.testrun || undefined,
        metadata: (s: any) => s.custom?.metadata || {}
    }
});
