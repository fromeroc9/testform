import { existsSync, readdirSync } from 'fs';
import { resolve, extname, basename } from 'path';
import { pathToFileURL } from 'url';
import { TITLE_APP, TITLE_CLI } from '../core/const';
import { logger as notify } from '../core/logger';
import { bold, green, red, yellow, dim } from 'chalk';
import {
    ParserScenario, PlanAction, PlanChange,
    ResourceField, ResourceTemplate
} from '../core/types';
import { formatIdentityDisplay, formatResourceAddress, formatHclValue, calculateRollupVerdict } from '../core/utils';
import { arraysEqual } from '../core/sync';
import { normalizeScenarioAddress, matchesTestrunSelector, extractNamespaceFromTag } from '../core/selector';

function deriveFieldsFromTemplate(template: ResourceTemplate): ResourceField[] {
    const fields: ResourceField[] = [];
    if (template.attributes) {
        if (typeof template.attributes === 'function') {
            try {
                const sample = template.attributes({ name: '', steps: [], tags: [], custom: {} } as any, {});
                if (sample && typeof sample === 'object') {
                    for (const k of Object.keys(sample)) {
                        fields.push({
                            name: k,
                            value: (s: any, ctx: any) => {
                                const evaluated = typeof template.attributes === 'function' ? template.attributes(s, ctx) : {};
                                return evaluated?.[k];
                            }
                        });
                    }
                }
            } catch {
                // Ignore inspection error
            }
        } else if (typeof template.attributes === 'object' && template.attributes !== null) {
            for (const [k, v] of Object.entries(template.attributes)) {
                fields.push({
                    name: k,
                    value: typeof v === 'function' ? v : () => v
                });
            }
        }
    }
    if (template.api) {
        for (const [k, v] of Object.entries(template.api)) {
            if (typeof v === 'function') {
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

        // 1. Direct template definition: { type, fields, attributes, comments }
        if (exported.type && (Array.isArray(exported.fields) || exported.attributes || exported.api)) {
            this.registry(exported, 'user');
            return;
        }

        // 2. Array of template definitions
        if (Array.isArray(exported)) {
            for (const item of exported) {
                if (item?.type && (Array.isArray(item.fields) || item.attributes || item.api)) {
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

    /**
     * Evaluates canonical attributes defined on the resource template.
     * Attributes map directly to the provider's resource handler payload.
     */
    evaluateAttributes(type: string, scenario: ParserScenario, context?: any): Record<string, any> {
        const template = this.get(type);
        if (template.attributes) {
            if (typeof template.attributes === 'function') {
                return template.attributes(scenario, context) || {};
            }
            if (typeof template.attributes === 'object' && template.attributes !== null) {
                const result: Record<string, any> = {};
                for (const [k, v] of Object.entries(template.attributes)) {
                    result[k] = typeof v === 'function' ? v(scenario, context) : v;
                }
                return result;
            }
        }

        // Backward compatibility: derive attributes from legacy api definition
        const apiData = this.evaluateApi(type, scenario, context);
        if (apiData) {
            const result: Record<string, any> = {};
            if (apiData.issue && typeof apiData.issue === 'object') {
                Object.assign(result, apiData.issue);
            }
            if (apiData.project && typeof apiData.project === 'object') {
                result.custom_fields = apiData.project.fields || {};
            }
            for (const [k, v] of Object.entries(apiData)) {
                if (k !== 'issue' && k !== 'project') {
                    result[k] = v;
                }
            }
            return result;
        }

        return this.evaluate(type, scenario, context);
    }

    /**
     * Retrieves optional lifecycle hooks defined on the resource template.
     */
    getLifecycle(type: string): import('./types').ResourceLifecycleHooks | undefined {
        const template = this.findTemplate(type);
        return template?.lifecycle;
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
                if (['status', 'testcases', 'testcaseTraces', 'testcaseEvidence', 'metadata', 'severity', 'priority', 'testruns', 'trace', 'evidence', 'attach'].includes(field.name)) {
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
        if (template.attributes) {
            if (typeof template.attributes === 'function') {
                const attrs = template.attributes(scenario, context);
                if (attrs && typeof attrs === 'object') {
                    Object.assign(result, attrs);
                }
            } else if (typeof template.attributes === 'object' && template.attributes !== null) {
                for (const [k, v] of Object.entries(template.attributes)) {
                    result[k] = typeof v === 'function' ? v(scenario, context) : v;
                }
            }
        }
        for (const field of template.fields || []) {
            if (field.knownAfterApply) continue;
            result[field.name] = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
        }
        return result;
    }

    hasFieldChanges(type: string, scenario: ParserScenario, oldAttributes: Record<string, any>, context?: any): boolean {
        const ignoreChanges = new Set<string>((context?.ignoreChanges || []).map((f: string) => f.toLowerCase()));
        const newAttributes = this.evaluate(type, scenario, context);
        for (const [k, raw] of Object.entries(newAttributes)) {
            const kLower = k.toLowerCase();
            if (ignoreChanges.has(kLower)) continue;
            if ((kLower === 'labels' || kLower === 'tags') && (ignoreChanges.has('labels') || ignoreChanges.has('tags'))) continue;
            if ((kLower === 'steps' || kLower === 'body') && (ignoreChanges.has('steps') || ignoreChanges.has('body'))) continue;
            if (kLower === 'title' && (ignoreChanges.has('title') || ignoreChanges.has('name'))) continue;
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
                    if (k === 'custom_fields' || k === 'metadata') {
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
        const { action, scenario, resourceType, address, oldAttributes } = change;


        const lines: string[] = [];
        const template = this.get(resourceType);
        const sym = this.getSymbol(action);
        const pad = (name: string) => name.padEnd(16);

        lines.push(`  ${sym} resource "${resourceType}" "${formatIdentityDisplay(address)}" {`);
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
                    const allKeys = Array.from(new Set([...Object.keys(safeOldRaw), ...Object.keys(raw)])).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b));
                    const maxKeyLen = allKeys.reduce((max, k) => Math.max(max, ('"' + k + '"').length), 0);
                    const diffLines: string[] = [];
                    diffLines.push('{');
                    for (const k of allKeys) {
                        const oldVal = safeOldRaw[k];
                        const newVal = raw[k];
                        const kStr = `"${k}"`.padEnd(maxKeyLen);

                        if (action === 'add') {
                            const formattedNewVal = formatHclValue(newVal, 2).trimStart();
                            diffLines.push(`          ${green('+')} ${kStr} = ${formattedNewVal}`);
                            fieldChanged = true;
                        } else if (oldVal === undefined) {
                            const formattedNewVal = formatHclValue(newVal, 2).trimStart();
                            diffLines.push(`          ${green('+')} ${kStr} = ${formattedNewVal}`);
                            fieldChanged = true;
                        } else if (newVal === undefined) {
                            const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                            diffLines.push(`          ${red('-')} ${kStr} = ${formattedOldVal}`);
                            fieldChanged = true;
                        } else {
                            let isKeyChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);
                            if (field.name === 'custom_fields' || field.name === 'metadata') {
                                const cleanOld = String(oldVal ?? '').replace(/^@/, '').toLowerCase().trim();
                                const cleanNew = String(newVal ?? '').replace(/^@/, '').toLowerCase().trim();
                                isKeyChanged = cleanOld !== cleanNew;
                            }
                            if (isKeyChanged) {
                                const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                                const formattedNewVal = formatHclValue(newVal, 2).trimStart();
                                diffLines.push(`          ${yellow('~')} ${kStr} = ${formattedOldVal} -> ${formattedNewVal}`);
                                fieldChanged = true;
                            } else {
                                const formattedOldVal = formatHclValue(oldVal, 2).trimStart();
                                diffLines.push(`            ${kStr} = ${formattedOldVal}`);
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

    formatFeature(change: PlanChange, context?: any): string {
        const { action, scenario, resourceType, address, tag, oldAttributes } = change;
        const sym = this.getSymbol(action);
        const symPrefix = action === 'replace' ? `  ${sym} ` : `  ${sym}   `;
        const stepPrefix = action === 'replace' ? `  ${sym}   ` : `  ${sym}     `;
        const lines: string[] = [];

        // Check if this is a testrun
        if (resourceType.endsWith('testrun')) {
            const featureTitle = scenario?.feature?.name || oldAttributes?.title || 'Test Run';
            lines.push(`${symPrefix}Feature: ${featureTitle}`);
            const groupScenarios = scenario?.custom?.groupScenarios || [];
            if (groupScenarios.length > 0) {
                let currentRule = '';
                for (const gs of groupScenarios) {
                    const ruleName = gs.rule?.name || '';
                    if (ruleName && ruleName !== currentRule) {
                        currentRule = ruleName;
                        lines.push(`${stepPrefix}Rule: ${ruleName}`);
                    }
                    if (gs.name) {
                        const indent = ruleName ? `  ` : ``;
                        lines.push(`${stepPrefix}${indent}Scenario: ${gs.name}`);
                        const status = gs.custom?.fields?.status || 'pending';
                        lines.push(`${stepPrefix}${indent}  * set status = ${status}`);
                    }
                }
            }
            return lines.join('\n');
        }

        // Check if this is a testplan
        if (resourceType.endsWith('testplan')) {
            const featureTitle = scenario?.feature?.name || oldAttributes?.title || 'Test Plan';
            lines.push(`${symPrefix}Feature: ${featureTitle}`);
            const testruns = scenario?.custom?.testruns || [];
            for (const tr of testruns) {
                lines.push(`${stepPrefix}Rule: ${tr}`);
            }
            return lines.join('\n');
        }

        // Standard testcase / scenario format
        // 1. Tags
        let tags: string[] = [];
        if (scenario?.custom?.rawTags && scenario.custom.rawTags.length > 0) {
            tags = [...scenario.custom.rawTags];
        } else if (scenario?.tags && scenario.tags.length > 0) {
            tags = scenario.tags.map((t: any) => typeof t === 'string' ? (t.startsWith('@') ? t : `@${t}`) : `@${t.name}`);
        } else if (oldAttributes?.labels && oldAttributes.labels.length > 0) {
            tags = oldAttributes.labels.map((l: string) => l.startsWith('@') ? l : `@${l}`);
        }

        // Ensure the identity tag (e.g. @tc-02) is present in tags
        let idTag = scenario?.custom?.identity || tag;
        if (!idTag && address) {
            const lastPart = address.split('.').pop();
            if (lastPart && (lastPart.startsWith('@') || lastPart.startsWith('tc-') || lastPart.startsWith('tr-') || lastPart.startsWith('tp-') || lastPart.startsWith('bg-'))) {
                idTag = lastPart.startsWith('@') ? lastPart : `@${lastPart}`;
            }
        }
        if (idTag) {
            const cleanId = idTag.startsWith('@') ? idTag : `@${idTag}`;
            if (!tags.some(t => t.toLowerCase() === cleanId.toLowerCase())) {
                tags.unshift(cleanId);
            }
        }

        // Include any custom fields that are formatted as tags or start with '@'
        const customFields = scenario?.custom?.fields || oldAttributes?.custom_fields || {};
        for (const [k, v] of Object.entries(customFields)) {
            if (typeof v === 'string' && v.startsWith('@')) {
                const tagFormat = v;
                if (!tags.some(t => t.toLowerCase() === tagFormat.toLowerCase())) {
                    tags.push(tagFormat);
                }
            }
        }

        if (tags.length > 0) {
            lines.push(`${symPrefix}${tags.join(' ')}`);
        }

        // 2. Scenario Header
        const keyword = scenario?.keyword || 'Scenario';
        const title = scenario?.name || oldAttributes?.title || '';
        if (action === 'change' && oldAttributes?.title && oldAttributes.title !== scenario?.name) {
            lines.push(`${symPrefix}${keyword}: ${oldAttributes.title} -> ${title}`);
        } else {
            lines.push(`${symPrefix}${keyword}: ${title}`);
        }

        // 3. Steps
        const stepLines: string[] = [];

        if (scenario?.custom?.rawSteps && scenario.custom.rawSteps.length > 0) {
            for (const sp of scenario.custom.rawSteps) {
                const kw = sp.keyword ? (sp.keyword.endsWith(' ') ? sp.keyword : `${sp.keyword} `) : '';
                stepLines.push(`${kw}${sp.text}`);
            }
        } else if (scenario?.steps && scenario.steps.length > 0) {
            // First include field steps from custom_fields if any
            for (const [k, v] of Object.entries(customFields)) {
                if (['labels', 'assignees', 'milestone', 'status'].includes(k)) continue;
                if (typeof v === 'string' && v.startsWith('@')) continue; // Already in tags
                if (v !== undefined && v !== null && v !== '') {
                    stepLines.push(`field ${k} = ${v}`);
                }
            }
            for (const sp of scenario.steps) {
                const kw = sp.keyword ? (sp.keyword.endsWith(' ') ? sp.keyword : `${sp.keyword} `) : '';
                stepLines.push(`${kw}${sp.text}`);
            }
        } else if (oldAttributes?.body) {
            // Reconstruct steps from old body
            const bodyStr = String(oldAttributes.body);
            const match = bodyStr.match(/```gherkin\s*([\s\S]*?)\s*```/i);
            const rawGherkin = match ? match[1].trim() : bodyStr.trim();
            if (rawGherkin) {
                for (const line of rawGherkin.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed) {
                        stepLines.push(trimmed);
                    }
                }
            }
        }

        for (const sLine of stepLines) {
            lines.push(`${stepPrefix}${sLine}`);
        }

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

        const scopeOrder: Record<string, number> = {
            testcase: 1,
            testrun: 2,
            testplan: 3,
            bug: 4,
        };
        const sortedChanges = [...changes].sort((a, b) => {
            const orderA = scopeOrder[a.resourceType] || 99;
            const orderB = scopeOrder[b.resourceType] || 99;
            if (orderA !== orderB) return orderA - orderB;
            const addrA = (a.address || '').toLowerCase();
            const addrB = (b.address || '').toLowerCase();
            return addrA.localeCompare(addrB);
        });

        const defaultProvider = context?.provider || context?.state?.provider || (typeof context?.config?.getProviderType === 'function' ? context.config.getProviderType() : undefined) || changes[0]?.provider;

        for (const change of sortedChanges) {
            const changeProvider = change.provider || defaultProvider;
            const address = formatResourceAddress(change.resourceType, change.address, changeProvider);
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

            if (context?.gherkin || context?.feature) {
                output.push(this.formatFeature(change, { ...context, provider: changeProvider }));
            } else {
                output.push(this.format(change, { ...context, provider: changeProvider }));
            }
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

export function isNonLabelTag(tag: string, idTag?: string): boolean {
    const clean = (tag || '').replace(/^@/, '').trim();
    if (!clean) return true;

    // 1. Matches identity tag of current scenario (e.g. tc-01, bg-01)
    if (idTag && clean.toLowerCase() === idTag.toLowerCase()) return true;

    // 2. Namespace tags (@ns(...) or @namespace(...))
    if (extractNamespaceFromTag(tag.startsWith('@') ? tag : `@${tag}`)) return true;

    // 3. Dependency and directive tags:
    // e.g. @depends_on(@tc-01), @depends(...), @target(...), @run(...), @suite(...)
    if (/^depends(?:_on)?(?:\(.*?\))?$/i.test(clean)) return true;
    if (/^(?:target|run|suite|parent|source)(?:\(.*?\))?$/i.test(clean)) return true;

    // 4. Resource identifiers / target reference tags:
    // e.g. @tc-01, @tc-02, @tr-1, @tp-1, @bg-1, @sub-1
    if (/^(?:tc|tr|tp|bg|sub)-[a-zA-Z0-9_-]+$/i.test(clean)) return true;

    return false;
}

export function extractLabels(s: any, extraTag?: string): string[] {
    const idTag = s.custom?.identity?.startsWith('@') ? s.custom.identity.substring(1) : s.custom?.identity;
    const base: string[] = extraTag ? [...(s.tags || []), extraTag].map(String) : (s.tags || []).map(String);
    const cleaned = base
        .filter((t: string) => !isNonLabelTag(t, idTag))
        .map((t: string) => t.startsWith('@') ? t.substring(1) : t);
    return Array.from(new Set(cleaned));
}

export function extractAssignees(s: any): string[] {
    return (s.custom?.fields?.assignees || '').split(',').map((a: string) => a.trim().replace(/^@/, '')).filter(Boolean);
}

/**
 * Unified value getter resolving across execution marks (set), declared fields (fields), and properties.
 * Strictly respects exact case first (so 'status' and 'Status' are distinct), falling back
 * to case-insensitive lookup only if no exact match exists.
 */
export function getScenarioValue(s: any, fieldName: string, defaultValue?: any): any {
    if (!s) return defaultValue;

    // 1. Strict exact-key match in runtime set marks (e.g. * set status = passed)
    if (s.custom?.set && s.custom.set[fieldName] !== undefined && s.custom.set[fieldName] !== '') {
        return s.custom.set[fieldName];
    }

    // 2. Strict exact-key match in declared metadata fields (e.g. * field Status = Done)
    if (s.custom?.fields && s.custom.fields[fieldName] !== undefined && s.custom.fields[fieldName] !== '') {
        return s.custom.fields[fieldName];
    }

    // 3. Strict exact-key match on direct property
    if (s[fieldName] !== undefined) return s[fieldName];
    if (s.feature && s.feature[fieldName] !== undefined) return s.feature[fieldName];

    // 4. Secondary fallback: case-insensitive match only if no exact key existed
    const lowerName = fieldName.toLowerCase();
    if (s.custom?.set) {
        for (const [k, v] of Object.entries(s.custom.set)) {
            if (k.toLowerCase() === lowerName && v !== undefined && v !== null && v !== '') {
                return v;
            }
        }
    }
    if (s.custom?.fields) {
        for (const [k, v] of Object.entries(s.custom.fields)) {
            if (k.toLowerCase() === lowerName && v !== undefined && v !== null && v !== '') {
                return v;
            }
        }
    }

    return defaultValue;
}

export function getScenarioStatus(s: any, defaultValue: string = 'pending'): string {
    return getScenarioValue(s, 'status', defaultValue);
}

export function getScenarioTrace(s: any): string | undefined {
    return getScenarioValue(s, 'trace') || getScenarioValue(s, 'error');
}

export function getScenarioEvidence(s: any): string[] | undefined {
    const ev = getScenarioValue(s, 'attach') ?? getScenarioValue(s, 'evidence');
    if (!ev || (Array.isArray(ev) && ev.length === 0)) return undefined;
    return Array.isArray(ev) ? ev : [ev];
}

/**
 * Extracts custom fields by deleting specified exclusion keys with exact-case matching,
 * preserving distinct fields such as 'Status' vs 'status'.
 */
export function extractCustomFields(rawFields: Record<string, any> = {}, excludeKeys: string[] = []): Record<string, any> {
    const fields = { ...rawFields };
    for (const k of excludeKeys) {
        delete fields[k];
    }
    return fields;
}

export function extractTestcaseStatusMap(s: any): Record<string, string> {
    const groupScenarios = s.custom?.groupScenarios || [];
    const map: Record<string, string> = {};
    for (const gs of groupScenarios) {
        if (gs.name) {
            const key = normalizeScenarioAddress(gs.rule?.name, gs.name);
            map[key] = getScenarioStatus(gs, 'pending');
        }
    }
    return map;
}

export function extractTestcaseTraceMap(s: any): Record<string, string> {
    const groupScenarios = s.custom?.groupScenarios || [];
    const map: Record<string, string> = {};
    for (const gs of groupScenarios) {
        const trace = getScenarioTrace(gs);
        if (trace && gs.name) {
            const key = normalizeScenarioAddress(gs.rule?.name, gs.name);
            if (key) map[key] = trace;
        }
    }
    return map;
}

export function extractTestcaseEvidenceMap(s: any): Record<string, any> {
    const groupScenarios = s.custom?.groupScenarios || [];
    const map: Record<string, any> = {};
    for (const gs of groupScenarios) {
        const ev = getScenarioEvidence(gs);
        if (ev && gs.name) {
            const key = normalizeScenarioAddress(gs.rule?.name, gs.name);
            if (key) map[key] = ev;
        }
    }
    return map;
}

export function calculatePlanRollup(s: any, context?: any): string {
    const trList = s.custom?.testruns || [];
    const state = context?.state;
    if (!state || trList.length === 0) return 'pending';
    const statuses: string[] = [];
    const runResources = state.getResources('testrun') || [];
    for (const tr of trList) {
        const found = runResources.find((r: any) => matchesTestrunSelector(r, String(tr)));
        statuses.push(found?.attributes?.status || 'pending');
    }
    return calculateRollupVerdict(statuses);
}

export function extractPlanTestrunsMap(s: any, context?: any): Record<string, string> {
    const trList = s.custom?.testruns || [];
    const map: Record<string, string> = {};
    const state = context?.state;
    const runResources = state ? state.getResources('testrun') || [] : [];
    for (const tr of trList) {
        const normTr = String(tr).replace(/\\/g, '/');
        let status = 'pending';
        if (state) {
            const found = runResources.find((r: any) => matchesTestrunSelector(r, normTr));
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

function buildGenericTestcaseBody(s: any): string {
    const steps = (s.steps || []).map((sp: any) => `${sp.keyword}${sp.text}`).join('\n');
    return steps ? '```gherkin\n' + steps + '\n```' : '';
}

export const defaultTestcaseTemplate: ResourceTemplate = {
    type: 'testcase',
    attributes: (s: any) => ({
        title: s.name,
        body: buildGenericTestcaseBody(s),
        labels: extractLabels(s),
        assignees: extractAssignees(s),
        milestone: s.custom?.fields?.milestone || undefined,
        state: 'open',
        metadata: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status', 'evidence', 'attach']) || {}
    }),
    state: {}
};

export const defaultTestrunTemplate: ResourceTemplate = {
    type: 'testrun',
    attributes: (s: any, context?: any) => {
        const groupScenarios = s.custom?.groupScenarios || [];
        const statuses = groupScenarios.map((gs: any) => getScenarioStatus(gs, 'pending'));
        const rollupStatus = calculateRollupVerdict(statuses);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach', 'duration', 'trace']) || {};

        return {
            title: s.feature?.name || '',
            body: '',
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: rollupStatus === 'passed' ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {
        status: (s: any) => {
            const groupScenarios = s.custom?.groupScenarios || [];
            const statuses = groupScenarios.map((gs: any) => getScenarioStatus(gs, 'pending'));
            return calculateRollupVerdict(statuses);
        },
        duration: (s: any) => getScenarioValue(s, 'duration'),
        attach: (s: any) => getScenarioEvidence(s),
        trace: (s: any) => getScenarioTrace(s),
        testcases: (s: any) => extractTestcaseStatusMap(s),
        testcaseTraces: (s: any) => {
            const map = extractTestcaseTraceMap(s);
            return Object.keys(map).length > 0 ? map : undefined;
        },
        testcaseEvidence: (s: any) => {
            const map = extractTestcaseEvidenceMap(s);
            return Object.keys(map).length > 0 ? map : undefined;
        }
    }
};

export const defaultTestplanTemplate: ResourceTemplate = {
    type: 'testplan',
    attributes: (s: any, context?: any) => {
        const rollupStatus = calculatePlanRollup(s, context);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {};

        return {
            title: s.feature?.name || '',
            body: '',
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: rollupStatus === 'passed' ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {
        status: (s: any, context?: any) => calculatePlanRollup(s, context),
        attach: (s: any) => getScenarioEvidence(s),
        testruns: (s: any, context?: any) => extractPlanTestrunsMap(s, context)
    }
};

export const defaultBugTemplate: ResourceTemplate = {
    type: 'bug',
    attributes: (s: any) => {
        const rawStatus = getScenarioStatus(s, 'open');
        const bugStatus = ['open', 'in_progress', 'closed', 'resolved'].includes(rawStatus.toLowerCase()) ? rawStatus : 'open';
        const meta = extractCustomFields(s.custom?.fields, [
            'labels', 'assignees', 'milestone', 'trace', 'error', 'evidence', 'attach', 'target', 'testcase', 'testrun', 'run'
        ]) || {};

        return {
            title: s.name || s.feature?.name || '',
            body: '',
            labels: extractLabels(s, 'bug'),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: (bugStatus === 'closed' || bugStatus === 'resolved') ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {
        status: (s: any) => {
            const rawStatus = getScenarioStatus(s, 'open');
            return ['open', 'in_progress', 'closed', 'resolved'].includes(rawStatus.toLowerCase()) ? rawStatus : 'open';
        },
        trace: (s: any) => getScenarioTrace(s),
        attach: (s: any) => getScenarioEvidence(s),
        testcase: (s: any) => getScenarioValue(s, 'target') ?? getScenarioValue(s, 'testcase'),
        testrun: (s: any) => getScenarioValue(s, 'run') ?? s.feature?.name ?? getScenarioValue(s, 'testrun')
    }
};

// Register pure agnostic baseline resources
resource.registry(defaultTestcaseTemplate);
resource.registry(defaultTestrunTemplate);
resource.registry(defaultTestplanTemplate);
resource.registry(defaultBugTemplate);


