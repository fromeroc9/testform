import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import chalk from 'chalk';
import { policy, PolicyInfo } from '../core/policy';
import { Config } from '../core/config';
import { IScope } from '../core/types';
import { CONFIG_FILE_NAMES, TITLE_CLI } from '../core/const';
import { Logger } from '../core/logger';

const { bold, green, red, yellow, cyan, gray } = chalk;

export interface PolicyCmdOptions {
    dir: string;
    scope?: IScope;
    enable?: string;
    disable?: string;
    show?: string;
    json?: boolean;
    verbose?: boolean;
}

function updateConfigFilePolicy(dir: string, policyId: string, enabled: boolean): string {
    let targetPath: string | null = null;
    for (const name of CONFIG_FILE_NAMES) {
        const p = resolve(dir, name);
        if (existsSync(p)) {
            targetPath = p;
            break;
        }
    }
    if (!targetPath) {
        targetPath = resolve(dir, 'main.yml');
    }

    let doc: YAML.Document;
    if (existsSync(targetPath)) {
        const raw = readFileSync(targetPath, 'utf-8');
        doc = YAML.parseDocument(raw);
    } else {
        doc = new YAML.Document({});
    }

    if (!doc.contents) {
        doc.contents = doc.createNode({}) as any;
    }

    let policyNode = doc.get('policy') as any;
    if (!policyNode) {
        doc.set('policy', doc.createNode({}));
        policyNode = doc.get('policy') as any;
    }

    if (enabled) {
        const disabledNode = doc.getIn(['policy', 'disabled']) as any;
        if (disabledNode) {
            const items = disabledNode.items ? disabledNode.items.map((i: any) => i.value ?? i) : (Array.isArray(disabledNode) ? disabledNode : []);
            const filtered = items.filter((id: string) => id !== policyId);
            if (filtered.length > 0) {
                doc.setIn(['policy', 'disabled'], filtered);
            } else {
                doc.deleteIn(['policy', 'disabled']);
            }
        }
        if (doc.hasIn(['policy', policyId])) {
            doc.deleteIn(['policy', policyId]);
        }
    } else {
        const disabledNode = doc.getIn(['policy', 'disabled']) as any;
        if (disabledNode) {
            const items: string[] = disabledNode.items ? disabledNode.items.map((i: any) => i.value ?? i) : (Array.isArray(disabledNode) ? disabledNode : []);
            if (!items.includes(policyId)) {
                items.push(policyId);
                doc.setIn(['policy', 'disabled'], items);
            }
        } else if (doc.hasIn(['policy', policyId])) {
            doc.setIn(['policy', policyId], false);
        } else {
            doc.setIn(['policy', 'disabled'], [policyId]);
        }
    }

    writeFileSync(targetPath, doc.toString(), 'utf-8');
    return targetPath;
}

export const policyCmd = async (options: PolicyCmdOptions): Promise<void> => {
    const { dir, scope, enable, disable, show, json: isJson, verbose } = options;
    const logger = new Logger(verbose);

    // 1. Auto-discover custom policies from .testform/policies, ./policies, and .testform/modules/**/policies
    await policy.loadCustomPolicies(dir);

    // 2. Load workspace config if exists to apply disabled policies
    const configObj = new Config(dir, false);
    const policiesConfig = configObj.getPolicies();
    if (policiesConfig) {
        policy.configure(policiesConfig);
    }

    // ─── Action: Enable Policy ───────────────────────────────────────────────
    if (enable) {
        const targetId = enable.trim();
        const p = policy.get(targetId);
        if (!p) {
            logger.warn(`Warning: Policy "${targetId}" is not currently registered, but will be enabled in configuration.`);
        }
        policy.enable(targetId);
        const configFile = updateConfigFilePolicy(dir, targetId, true);

        if (isJson) {
            console.log(JSON.stringify({ id: targetId, action: 'enable', status: 'enabled', configFile }));
        } else {
            console.log(green(`\nSuccess! Policy "${targetId}" has been enabled.`));
            console.log(gray(`Updated configuration in ${configFile}\n`));
        }
        return;
    }

    // ─── Action: Disable Policy ──────────────────────────────────────────────
    if (disable) {
        const targetId = disable.trim();
        const p = policy.get(targetId);
        if (!p) {
            logger.warn(`Warning: Policy "${targetId}" is not currently registered, but will be disabled in configuration.`);
        }
        policy.disable(targetId);
        const configFile = updateConfigFilePolicy(dir, targetId, false);

        if (isJson) {
            console.log(JSON.stringify({ id: targetId, action: 'disable', status: 'disabled', configFile }));
        } else {
            console.log(yellow(`\nPolicy "${targetId}" has been disabled.`));
            console.log(gray(`Updated configuration in ${configFile}\n`));
        }
        return;
    }

    // ─── Action: Show Single Policy ──────────────────────────────────────────
    if (show) {
        const targetId = show.trim();
        const p = policy.get(targetId);
        if (!p) {
            logger.error(`Error: Policy "${targetId}" was not found.`);
            process.exit(1);
        }

        if (isJson) {
            console.log(JSON.stringify(p, null, 2));
            return;
        }

        console.log('');
        console.log(bold(`Policy: ${cyan(p.id)}`));
        console.log(`  ${bold('Type:')}        ${p.type === 'system' ? 'system (built-in)' : 'user (custom)'}`);
        console.log(`  ${bold('Scope:')}       ${p.scope.join(', ')}`);
        console.log(`  ${bold('Status:')}      ${p.enabled ? green('enabled') : red('disabled')}`);
        console.log(`  ${bold('Description:')} ${p.description || '(none)'}`);
        console.log('');
        return;
    }

    // ─── Action: List Policies (Default) ─────────────────────────────────────
    let policies = policy.getAll();
    if (scope) {
        policies = policies.filter(p => p.scope.includes(scope));
    }

    if (isJson) {
        console.log(JSON.stringify(policies, null, 2));
        return;
    }

    if (policies.length === 0) {
        console.log(gray('\nNo policies registered for this configuration.\n'));
        return;
    }

    // Calculate column widths
    const idWidth = Math.max(14, ...policies.map(p => p.id.length));
    const scopeWidth = Math.max(7, ...policies.map(p => p.scope.join(', ').length));
    const typeWidth = 8;
    const statusWidth = 10;

    console.log('');
    const header = [
        'ID'.padEnd(idWidth),
        'SCOPE'.padEnd(scopeWidth),
        'TYPE'.padEnd(typeWidth),
        'STATUS'.padEnd(statusWidth),
        'DESCRIPTION'
    ].join('  ');

    const separator = [
        '─'.repeat(idWidth),
        '─'.repeat(scopeWidth),
        '─'.repeat(typeWidth),
        '─'.repeat(statusWidth),
        '─'.repeat(30)
    ].join('  ');

    console.log(bold(header));
    console.log(gray(separator));

    for (const p of policies) {
        const idCol = cyan(p.id.padEnd(idWidth));
        const scopeCol = p.scope.join(', ').padEnd(scopeWidth);
        const typeCol = (p.type === 'system' ? 'system' : 'custom').padEnd(typeWidth);
        const statusCol = p.enabled ? green('enabled'.padEnd(statusWidth)) : red('disabled'.padEnd(statusWidth));
        const descCol = gray(p.description || '');

        console.log(`${idCol}  ${scopeCol}  ${typeCol}  ${statusCol}  ${descCol}`);
    }

    console.log('');
};

