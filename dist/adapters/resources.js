"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerResource = exports.resource = void 0;
const const_1 = require("../const");
const notify_1 = require("../notify");
const chalk_1 = require("chalk");
const utils_1 = require("../core/utils");
class Resource {
    builtinTemplates = Object.create(null);
    userTemplates = Object.create(null);
    resolve() {
        const system = Object.values(this.builtinTemplates);
        const user = Object.values(this.userTemplates);
        return [...system, ...user];
    }
    get(type) {
        const template = this.resolve().find(t => t.type === type);
        if (!template) {
            notify_1.notify.push({
                type: 'error',
                title: `Unknown resource type: "${type}"`,
                detail: [
                    `No template is registered for resource type "${type}".`,
                    `Available types: ${this.resolve().map(t => t.type).join(', ') || '(none)'}`,
                ],
                close: true,
            });
        }
        return template;
    }
    registry(template, type = 'system') {
        if (type === 'system') {
            this.builtinTemplates[template.type] = template;
        }
        if (type === 'user') {
            this.userTemplates[template.type] = template;
        }
    }
    evaluate(type, scenario, context) {
        const template = this.get(type);
        const result = {};
        for (const field of template.fields) {
            if (field.knownAfterApply)
                continue;
            result[field.name] = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
        }
        return result;
    }
    getSymbol(type) {
        const symbol = {
            add: (0, chalk_1.green)('+'),
            change: (0, chalk_1.yellow)('~'),
            destroy: (0, chalk_1.red)('-'),
            replace: `${(0, chalk_1.red)('-')}/${(0, chalk_1.green)('+')}`,
        }[type];
        return symbol;
    }
    getSymbols(changes) {
        const actions = new Set(changes.map((c) => c.action));
        const symbols = {
            add: `${(0, chalk_1.green)('+')} create`,
            change: `${(0, chalk_1.yellow)('~')} update in-place`,
            destroy: `${(0, chalk_1.red)('-')} destroy`,
            replace: `${(0, chalk_1.red)('-')}/${(0, chalk_1.green)('+')} destroy and then create replacement`,
        };
        const result = [];
        if (actions.has('add'))
            result.push(symbols.add);
        if (actions.has('change'))
            result.push(symbols.change);
        if (actions.has('destroy'))
            result.push(symbols.destroy);
        if (actions.has('replace'))
            result.push(symbols.replace);
        return result.map(s => `  ${s}`).join('\n');
    }
    format(change, context) {
        const { action, scenario, resourceType, identity, oldAttributes } = change;
        const lines = [];
        const template = this.get(resourceType);
        const sym = this.getSymbol(action);
        const pad = (name) => name.padEnd(16);
        lines.push(`  ${sym} resource "${resourceType}" "${(0, utils_1.formatIdentityDisplay)(identity)}" {`);
        for (const field of template.fields) {
            const raw = typeof field.value === 'function' ? field.value(scenario, context) : field.value;
            const oldRaw = oldAttributes ? oldAttributes[field.name] : undefined;
            let valueStr = '';
            let fieldChanged = false;
            if (field.knownAfterApply) {
                valueStr = '(known after apply)';
                fieldChanged = true;
            }
            else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                let safeOldRaw = oldRaw;
                if (!safeOldRaw || typeof safeOldRaw !== 'object' || Array.isArray(safeOldRaw)) {
                    safeOldRaw = action === 'destroy' ? oldRaw : {};
                }
                const isDiffAction = action === 'change' || action === 'add' || action === 'replace';
                if (isDiffAction && safeOldRaw && typeof safeOldRaw === 'object' && !Array.isArray(safeOldRaw)) {
                    const allKeys = Array.from(new Set([...Object.keys(safeOldRaw), ...Object.keys(raw)])).sort();
                    const diffLines = [];
                    diffLines.push('{');
                    for (const k of allKeys) {
                        const oldVal = safeOldRaw[k];
                        const newVal = raw[k];
                        const kStr = `"${k}"`;
                        if (action === 'add') {
                            const formattedNewVal = (0, utils_1.formatHclValue)(newVal, 2).trimStart();
                            diffLines.push(`          ${(0, chalk_1.green)('+')} ${kStr}: ${formattedNewVal}`);
                            fieldChanged = true;
                        }
                        else if (oldVal === undefined) {
                            const formattedNewVal = (0, utils_1.formatHclValue)(newVal, 2).trimStart();
                            diffLines.push(`          ${(0, chalk_1.green)('+')} ${kStr}: ${formattedNewVal}`);
                            fieldChanged = true;
                        }
                        else if (newVal === undefined) {
                            const formattedOldVal = (0, utils_1.formatHclValue)(oldVal, 2).trimStart();
                            diffLines.push(`          ${(0, chalk_1.red)('-')} ${kStr}: ${formattedOldVal}`);
                            fieldChanged = true;
                        }
                        else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                            const formattedOldVal = (0, utils_1.formatHclValue)(oldVal, 2).trimStart();
                            const formattedNewVal = (0, utils_1.formatHclValue)(newVal, 2).trimStart();
                            diffLines.push(`          ${(0, chalk_1.yellow)('~')} ${kStr}: ${formattedOldVal} -> ${formattedNewVal}`);
                            fieldChanged = true;
                        }
                        else {
                            const formattedOldVal = (0, utils_1.formatHclValue)(oldVal, 2).trimStart();
                            diffLines.push(`            ${kStr}: ${formattedOldVal}`);
                        }
                    }
                    diffLines.push('        }');
                    valueStr = diffLines.join('\n');
                }
                else {
                    const formattedLines = (0, utils_1.formatHclValue)(raw, 2).split('\n');
                    valueStr = formattedLines.map((line, idx) => idx === 0 ? line.trimStart() : line).join('\n');
                    fieldChanged = true;
                }
            }
            else if (Array.isArray(raw)) {
                const formattedLines = (0, utils_1.formatHclValue)(raw, 2).split('\n');
                valueStr = formattedLines.map((line, idx) => idx === 0 ? line.trimStart() : line).join('\n');
                if (action === 'change') {
                    fieldChanged = JSON.stringify(raw) !== JSON.stringify(oldRaw);
                }
                else {
                    fieldChanged = true;
                }
            }
            else if (typeof raw === 'string' && raw.includes('\n')) {
                const formattedLines = (0, utils_1.formatHclValue)(raw, 2).split('\n');
                valueStr = formattedLines.map((line, idx) => idx === 0 ? line.trimStart() : line).join('\n');
                if (action === 'change') {
                    fieldChanged = raw !== oldRaw;
                }
                else {
                    fieldChanged = true;
                }
            }
            else {
                if (action === 'change' && raw !== oldRaw && oldRaw !== undefined) {
                    valueStr = `"${oldRaw}" -> "${raw}"`;
                    fieldChanged = true;
                }
                else {
                    valueStr = `"${raw}"`;
                    if (action === 'change') {
                        fieldChanged = raw !== oldRaw;
                    }
                    else {
                        fieldChanged = true;
                    }
                }
            }
            if (action === 'add' || action === 'replace') {
                lines.push(`      ${sym} ${pad(field.name)}= ${valueStr}`);
            }
            else if (action === 'change') {
                if (field.knownAfterApply) {
                    lines.push(`        ${pad(field.name)}= ${valueStr}`);
                }
                else if (fieldChanged) {
                    lines.push(`      ${sym} ${pad(field.name)}= ${valueStr}`);
                }
                else {
                    lines.push(`        ${pad(field.name)}= ${valueStr}`);
                }
            }
            else if (action === 'destroy') {
                lines.push(`      ${sym} ${pad(field.name)}= ${valueStr} -> null`);
            }
        }
        lines.push('    }');
        return lines.join('\n');
    }
    summary(changes, isPlanOnly = true, context) {
        const output = [];
        if (changes.length === 0) {
            output.push('No changes. Your test matches the configuration.');
            if (!isPlanOnly) {
                output.push('');
                output.push(`${const_1.TITLE_APP} has compared your real test against your configuration and found no differences, so no`);
                output.push('changes are needed.');
                output.push('');
                output.push((0, chalk_1.green)('Apply complete! Resources: 0 added, 0 changed, 0 destroyed.'));
            }
            console.log(output.join('\n'));
            return;
        }
        // Header
        output.push(`${const_1.TITLE_APP} used the selected providers to generate the following execution plan. Resource actions are indicated with the`);
        output.push('following symbols:');
        output.push(this.getSymbols(changes));
        output.push('');
        // Changes grouped by type
        output.push(`${const_1.TITLE_APP} will perform the following actions:`);
        output.push('');
        for (const change of changes) {
            const shortIdentity = (0, utils_1.formatIdentityDisplay)(change.identity);
            const actionText = change.action === 'add'
                ? (0, chalk_1.bold)((0, chalk_1.green)(`# [${change.scenario.feature?.name || 'Unknown'}].${change.resourceType}.${shortIdentity} will be created`))
                : change.action === 'change'
                    ? (0, chalk_1.bold)((0, chalk_1.yellow)(`# ${change.resourceType}.${shortIdentity} will be updated in-place`))
                    : change.action === 'replace'
                        ? (0, chalk_1.bold)((0, chalk_1.red)(`# ${change.resourceType}.${shortIdentity} must be replaced`))
                        : (0, chalk_1.bold)((0, chalk_1.red)(`# ${change.resourceType}.${shortIdentity} will be destroyed`));
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
        output.push(`${(0, chalk_1.bold)('Plan:')} ${toAdd + toReplace} to add, ${toChange} to change, ${toDestroy + toReplace} to destroy.`);
        output.push('');
        // Note
        if (isPlanOnly) {
            // Separator
            output.push((0, chalk_1.dim)('─'.repeat(108)));
            output.push('');
            if (!context?.outPath) {
                output.push(`Note: You didn't use the -out option to save this plan, so ${const_1.TITLE_APP} can't guarantee to take exactly these`);
                output.push(`actions if you run "${const_1.TITLE_CLI} apply" now.`);
            }
        }
        console.log(output.join('\n'));
    }
}
exports.resource = new Resource();
const registerResource = (template) => exports.resource.registry(template, 'user');
exports.registerResource = registerResource;
exports.resource.registry({
    type: 'github_testcase',
    fields: [
        { name: 'title', value: (s) => s.name },
        { name: 'body', value: (s) => '```gherkin\n' + s.steps.map((sp) => `${sp.keyword}${sp.text}`).join('\n') + '\n```' },
        { name: 'labels', value: (s) => [...new Set([...(s.tags || [])].map(String).map(t => t.startsWith('@') ? t.substring(1) : t))] },
        { name: 'assignees', value: (s) => (s.custom?.fields?.assignees || '').split(',').map((a) => a.trim()).filter(Boolean) },
        { name: 'milestone', value: (s) => s.custom?.fields?.milestone || '' },
        { name: 'custom_fields', value: (s) => {
                const fields = { ...(s.custom?.fields || {}) };
                delete fields['labels'];
                delete fields['assignees'];
                delete fields['milestone'];
                return fields;
            } }
    ]
});
exports.resource.registry({
    type: 'github_testrun',
    fields: [
        { name: 'title', value: (s) => s.feature?.name || '' },
        { name: 'body', value: (s, context) => {
                let body = s.feature.description || '';
                const testcases = s.custom?.testcases || [];
                if (testcases.length > 0 && context?.state) {
                    body += '\n\n### Test Cases\n';
                    const state = context.state;
                    for (const tc of testcases) {
                        const parts = tc.split('::');
                        const scenarioName = parts.pop();
                        const ruleName = parts.pop() || '';
                        const baseRule = ruleName.replace('.case.feature', '').replace('.feature', '');
                        const tcResources = state.getResources('github_testcase').filter((r) => r.identity.includes(baseRule) && (scenarioName === '*' || r.identity.endsWith(`::${scenarioName}`)));
                        if (tcResources.length > 0) {
                            for (const tcResource of tcResources) {
                                if (tcResource?.attributes?.issueNumber) {
                                    body += `- [ ] #${tcResource.attributes.issueNumber}\n`;
                                }
                                else {
                                    body += `- [ ] (known after apply) - ${tcResource.identity}\n`;
                                }
                            }
                        }
                        else {
                            body += `- [ ] (not found in state) - ${tc}\n`;
                        }
                    }
                }
                return body.trim();
            } },
        { name: 'labels', value: (s) => [...new Set([...(s.tags || [])].map(String).map(t => t.startsWith('@') ? t.substring(1) : t))] },
        { name: 'assignees', value: (s) => (s.custom?.fields?.assignees || '').split(',').map((a) => a.trim()).filter(Boolean) },
        { name: 'milestone', value: (s) => s.custom?.fields?.milestone || '' },
        { name: 'custom_fields', value: (s) => {
                const fields = { ...(s.custom?.fields || {}) };
                delete fields['labels'];
                delete fields['assignees'];
                delete fields['milestone'];
                return fields;
            } }
    ]
});
exports.resource.registry({
    type: 'github_testplan',
    fields: [
        { name: 'title', value: (s) => s.feature?.name || '' },
        { name: 'body', value: (s, context) => {
                let body = s.feature.description || '';
                const testruns = s.custom?.testruns || [];
                if (testruns.length > 0 && context?.state) {
                    body += '\n\n### Test Runs\n';
                    const state = context.state;
                    for (const tr of testruns) {
                        const runResources = state.getResources('github_testrun').filter((r) => r.identity.endsWith(tr));
                        if (runResources.length > 0) {
                            for (const runResource of runResources) {
                                if (runResource?.attributes?.issueNumber) {
                                    body += `- [ ] #${runResource.attributes.issueNumber} - ${runResource.attributes.title}\n`;
                                }
                                else {
                                    body += `- [ ] (known after apply) - ${runResource.identity}\n`;
                                }
                            }
                        }
                        else {
                            body += `- [ ] (not found in state) - ${tr}\n`;
                        }
                    }
                }
                return body.trim();
            } },
        { name: 'labels', value: (s) => [...new Set([...(s.tags || [])].map(String).map(t => t.startsWith('@') ? t.substring(1) : t))] },
        { name: 'assignees', value: (s) => (s.custom?.fields?.assignees || '').split(',').map((a) => a.trim()).filter(Boolean) },
        { name: 'milestone', value: (s) => s.custom?.fields?.milestone || '' },
        { name: 'custom_fields', value: (s) => {
                const fields = { ...(s.custom?.fields || {}) };
                delete fields['labels'];
                delete fields['assignees'];
                delete fields['milestone'];
                return fields;
            } },
        { name: 'testruns', value: (s) => s.custom?.testruns || [] }
    ]
});
