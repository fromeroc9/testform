import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { State } from './state';
import { VariableParser } from './variables';
import { StateOutput, StateResource } from './types';
import { normalizeAddress, addressesMatch, formatHclValue, findDomainConfigFiles } from './utils';
import { DataResolver } from './data';
import { CONFIG_FILE_NAMES } from './const';

export interface OutputDeclaration {
    value: any;
    description?: string;
    sensitive?: boolean;
}

export class OutputResolver {
    private declaredOutputs: Record<string, OutputDeclaration> = {};
    private workDir: string;
    private dataResolver: DataResolver;

    constructor(workDir: string = '.') {
        this.workDir = workDir;
        this.dataResolver = new DataResolver(workDir);
        this.loadDeclarations();
    }

    /**
     * Scans for outputs declarations in testform.yml, outputs.yml, and domain files.
     */
    public loadDeclarations(): void {
        const rootOutputs: Record<string, OutputDeclaration> = {};

        // 1. Root main.yml / CONFIG_FILE_NAMES
        for (const name of CONFIG_FILE_NAMES) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    const outBlock = parsed && (parsed.output || parsed.outputs);
                    if (outBlock && typeof outBlock === 'object') {
                        Object.assign(rootOutputs, this.normalizeDeclarations(outBlock));
                    }
                    const mods = parsed && parsed.module;
                    if (mods && typeof mods === 'object') {
                        for (const [modName, modConfig] of Object.entries(mods)) {
                            const modOut = modConfig && typeof modConfig === 'object' && ((modConfig as any).output || (modConfig as any).outputs);
                            if (modOut && typeof modOut === 'object') {
                                const decls = this.normalizeDeclarations(modOut);
                                for (const [k, v] of Object.entries(decls)) {
                                    rootOutputs[`module.${modName}.${k}`] = v;
                                }
                            }
                        }
                    }
                } catch {
                    // ignore parse errors
                }
            }
        }

        // 2. Root output.yml / outputs.yml
        for (const name of ['output.yml', 'output.yaml', 'outputs.yml', 'outputs.yaml']) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    if (parsed && typeof parsed === 'object') {
                        const target = parsed.output || parsed.outputs || parsed;
                        if (target && typeof target === 'object') {
                            Object.assign(rootOutputs, this.normalizeDeclarations(target));
                        }
                    }
                } catch {
                    // ignore
                }
            }
        }

        // 3. Domain and module files
        const domainFiles = findDomainConfigFiles(this.workDir);
        for (const f of domainFiles) {
            try {
                const parsed = YAML.parse(readFileSync(f, 'utf-8'));
                if (parsed && typeof parsed === 'object') {
                    // Check if it's a module
                    const isModule = f.replace(/\\/g, '/').includes('/modules/') || parsed.module;
                    const moduleName = parsed.module || this.extractModuleName(f);

                    const outBlock = parsed.output || parsed.outputs;
                    if (outBlock && typeof outBlock === 'object') {
                        const decls = this.normalizeDeclarations(outBlock);
                        if (isModule && moduleName) {
                            for (const [k, v] of Object.entries(decls)) {
                                rootOutputs[`module.${moduleName}.${k}`] = v;
                            }
                        } else {
                            Object.assign(rootOutputs, decls);
                        }
                    }

                    const mods = parsed.module;
                    if (mods && typeof mods === 'object') {
                        for (const [modName, modConfig] of Object.entries(mods)) {
                            const modOut = modConfig && typeof modConfig === 'object' && ((modConfig as any).output || (modConfig as any).outputs);
                            if (modOut && typeof modOut === 'object') {
                                const decls = this.normalizeDeclarations(modOut);
                                for (const [k, v] of Object.entries(decls)) {
                                    rootOutputs[`module.${modName}.${k}`] = v;
                                }
                            }
                        }
                    }
                }
            } catch {
                // ignore
            }
        }

        this.declaredOutputs = rootOutputs;
    }

    private extractModuleName(filePath: string): string | null {
        const normalized = filePath.replace(/\\/g, '/');
        const match = normalized.match(/\/modules\/([^\/]+)/);
        return match ? match[1] : null;
    }

    private normalizeDeclarations(raw: Record<string, any>): Record<string, OutputDeclaration> {
        const result: Record<string, OutputDeclaration> = {};
        for (const [key, val] of Object.entries(raw)) {
            if (val === null || val === undefined) continue;
            if (typeof val === 'object' && 'value' in val) {
                result[key] = {
                    value: val.value,
                    description: val.description,
                    sensitive: Boolean(val.sensitive)
                };
            } else {
                result[key] = {
                    value: val
                };
            }
        }
        return result;
    }

    public getDeclarations(): Record<string, OutputDeclaration> {
        return this.declaredOutputs;
    }

    /**
     * Resolves all outputs against the state and variable parser.
     */
    public resolve(state: State, variables?: VariableParser): Record<string, StateOutput> {
        const resolved: Record<string, StateOutput> = {};
        const vars = variables ? variables.getVars() : {};
        const locals = variables ? variables.getLocals() : {};
        const resources = state.getResources();

        for (const [name, decl] of Object.entries(this.declaredOutputs)) {
            const rawVal = decl.value;
            const evalVal = this.evaluateValue(rawVal, resources, vars, locals, state);
            const valType = Array.isArray(evalVal) ? 'tuple' : typeof evalVal;

            resolved[name] = {
                value: evalVal,
                type: valType,
                description: decl.description,
                sensitive: decl.sensitive
            };
        }

        return resolved;
    }

    private evaluateValue(rawVal: any, resources: StateResource[], vars: Record<string, string>, locals: Record<string, string>, state?: State): any {
        if (typeof rawVal !== 'string') {
            return rawVal;
        }

        // Check if string is a single reference: "${...}"
        const singleMatch = rawVal.trim().match(/^\$\{([^\}]+)\}$/);
        if (singleMatch) {
            return this.resolveExpression(singleMatch[1], resources, vars, locals, state);
        }

        // Mixed template with multiple interpolations
        const regex = /\$\{([^\}]+)\}/g;
        return rawVal.replace(regex, (_, expr) => {
            const val = this.resolveExpression(expr, resources, vars, locals, state);
            if (val === undefined || val === null) return '';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
        });
    }

    private resolveExpression(expr: string, resources: StateResource[], vars: Record<string, string>, locals: Record<string, string>, state?: State): any {
        const trimmed = expr.trim();

        // 1. Variable reference: var.name
        if (trimmed.startsWith('var.')) {
            const key = trimmed.substring(4);
            return vars[key] !== undefined ? vars[key] : `\${${trimmed}}`;
        }

        // 2. Local reference: local.name
        if (trimmed.startsWith('local.')) {
            const key = trimmed.substring(6);
            return locals[key] !== undefined ? locals[key] : `\${${trimmed}}`;
        }

        // 3. Data source reference: data.name.attribute
        if (trimmed.startsWith('data.')) {
            const dataPath = trimmed.substring(5);
            const resolvedData = this.dataResolver.resolvePath(dataPath, state);
            if (resolvedData !== undefined) {
                return resolvedData;
            }
        }

        // 4. Module output reference: module.<modName>.<outputName>
        if (trimmed.startsWith('module.')) {
            if (state) {
                const stateOutputs = (state as any).getOutputs ? (state as any).getOutputs() : (state as any).outputs;
                if (stateOutputs && stateOutputs[trimmed]) {
                    return stateOutputs[trimmed].value;
                }
            }
            if (this.declaredOutputs[trimmed]) {
                return this.evaluateValue(this.declaredOutputs[trimmed].value, resources, vars, locals, state);
            }
            return `\${${trimmed}}`;
        }

        // 5. Resource attribute reference: <prefix>.<address>.<attribute>
        // Example: testrun.suites/smoke.run.feature.@tr-1.issueNumber
        const lastDot = trimmed.lastIndexOf('.');
        if (lastDot > 0) {
            const resourceRef = trimmed.substring(0, lastDot);
            const attr = trimmed.substring(lastDot + 1);

            // Match resourceRef against state resources
            const res = resources.find(r => {
                if (addressesMatch(r.identity, resourceRef)) return true;
                if (addressesMatch(`${r.type}.${r.identity}`, resourceRef)) return true;

                // Strip leading scope prefix (e.g. testcase., testrun., testplan.)
                const stripped = resourceRef.replace(/^(github_|local_)?(testcase|testrun|testplan)\./, '');
                if (addressesMatch(r.identity, stripped)) return true;

                return false;
            });

            if (res) {
                return this.extractResourceAttribute(res, attr);
            }
        }

        return `\${${trimmed}}`;
    }

    private extractResourceAttribute(res: StateResource, attr: string): any {
        const attrs = res.attributes || ({} as any);

        switch (attr) {
            case 'id':
            case 'remoteId':
                return attrs.remoteId || attrs.id || '';
            case 'number':
            case 'issueNumber':
                return attrs.issueNumber !== undefined ? attrs.issueNumber : 0;
            case 'url':
                return attrs.url || (attrs.issueNumber ? `https://github.com/issues/${attrs.issueNumber}` : '');
            case 'title':
                return attrs.title || '';
            case 'body':
                return attrs.body || '';
            case 'labels':
            case 'tags':
                return attrs.labels || [];
            case 'status':
                return attrs.status || '';
            case 'testcases':
                return attrs.testcases || attrs.testcaseStatuses || {};
            case 'testruns':
                return attrs.testruns || {};
            case 'metadata':
                return attrs.metadata || {};
            case 'assignees':
                return attrs.assignees || [];
            case 'milestone':
                return attrs.milestone || '';
            case 'testcaseStatuses':
                return attrs.testcases || attrs.testcaseStatuses || {};
            case 'testcaseCommentIds':
                return attrs.testcaseCommentIds || {};
            case 'createdAt':
                return attrs.createdAt || '';
            case 'updatedAt':
                return attrs.updatedAt || '';
            default:
                if (attrs[attr] !== undefined) return attrs[attr];
                if (attrs.custom_fields && attrs.custom_fields[attr] !== undefined) {
                    return attrs.custom_fields[attr];
                }
                return undefined;
        }
    }

    /**
     * Formats outputs for CLI display or JSON / raw output.
     */
    public format(outputs: Record<string, StateOutput>, options: { json?: boolean; raw?: boolean; name?: string } = {}): string {
        const { json, raw, name } = options;

        if (name) {
            const out = outputs[name];
            if (!out) {
                throw new Error(`The state has no output named "${name}".`);
            }
            if (raw) {
                if (out.value === undefined || out.value === null) return '';
                if (typeof out.value === 'object') return JSON.stringify(out.value);
                return String(out.value);
            }
            if (json) {
                return JSON.stringify({
                    sensitive: Boolean(out.sensitive),
                    type: out.type || typeof out.value,
                    value: out.value
                }, null, 2);
            }
            return `${name} = ${formatHclValue(out.value, 0)}`;
        }

        if (json) {
            const jsonOut: Record<string, any> = {};
            for (const [k, v] of Object.entries(outputs)) {
                jsonOut[k] = {
                    sensitive: Boolean(v.sensitive),
                    type: v.type || (Array.isArray(v.value) ? 'tuple' : typeof v.value),
                    value: v.value
                };
            }
            return JSON.stringify(jsonOut, null, 2);
        }

        const lines: string[] = [];
        const keys = Object.keys(outputs).sort();
        if (keys.length === 0) {
            return 'Warning: No outputs found in the given state.';
        }

        let maxLen = 0;
        for (const k of keys) {
            if (k.length > maxLen) maxLen = k.length;
        }

        for (const k of keys) {
            const out = outputs[k];
            const padding = ' '.repeat(maxLen - k.length);
            const valStr = out.sensitive ? '(sensitive value)' : formatHclValue(out.value, 0);
            lines.push(`${k}${padding} = ${valStr}`);
        }

        return lines.join('\n');
    }
}
