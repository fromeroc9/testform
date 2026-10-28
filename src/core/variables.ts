import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { logger as notify } from '../core/logger';
import { CONFIG_FILE_NAMES } from '../core/const';
import { DataResolver } from './data';
import { findDomainConfigFiles } from './utils';
import { evaluateExpression, interpolateExpressions } from './expressions/evaluator';

export interface VariableValidation {
    condition: string;
    error_message: string;
}

export interface VariableDeclaration {
    type?: 'string' | 'number' | 'boolean' | 'list' | 'map' | string;
    description?: string;
    default?: any;
    enum?: (string | number)[];
    validation?: VariableValidation;
}

export class VariableParser {
    private declaredVars: Record<string, VariableDeclaration> = {};
    private vars: Record<string, string> = {};
    private rawLocals: Record<string, any> = {};
    private locals: Record<string, string> = {};
    private workDir: string;
    private dataResolver: DataResolver;
    private outputResolver?: any;
    private state?: any;

    constructor(varArgs?: string | string[], varFileArgs?: string | string[], workDir: string = '.') {
        this.workDir = workDir;
        this.dataResolver = new DataResolver(workDir);
        this.loadDeclarations();
        this.loadAutoVarFiles();
        this.parseVarFiles(varFileArgs);
        this.parseVars(varArgs);
        this.validateVariables();
        this.evaluateLocals();
    }

    /**
     * Loads variable and local declarations:
     *   [Nivel 0] Configuración Base: main.yml / main.yaml (bloques variable: y locals:)
     *   [Nivel 1] Estándar: variables.yml / variables.yaml & locals.yml / locals.yaml
     *   [Nivel 2] Funcionalidad / Dominio: archivos domain .yml en el proyecto
     */
    private loadDeclarations() {
        // [Nivel 0] Configuración Base: main.yml / main.yaml
        for (const name of CONFIG_FILE_NAMES) {
            const configPath = resolve(this.workDir, name);
            if (existsSync(configPath)) {
                try {
                    const content = readFileSync(configPath, 'utf-8');
                    const parsed = YAML.parse(content) || {};
                    const varsBlock = parsed.variable;
                    if (varsBlock && typeof varsBlock === 'object') {
                        this.declaredVars = { ...this.declaredVars, ...varsBlock };
                        for (const [key, decl] of Object.entries(varsBlock)) {
                            if (decl && typeof decl === 'object' && (decl as any).default !== undefined) {
                                this.vars[key] = String((decl as any).default);
                            } else if (decl !== undefined && decl !== null && typeof decl !== 'object') {
                                this.vars[key] = String(decl);
                            }
                        }
                    }
                    const localBlock = parsed.locals || parsed.local;
                    if (localBlock && typeof localBlock === 'object') {
                        this.rawLocals = { ...this.rawLocals, ...localBlock };
                    }
                } catch {
                    // Ignore parse errors here, validated separately
                }
                break;
            }
        }

        // [Nivel 1] Estándar: variables.yml & locals.yml
        for (const name of ['variables.yml', 'variables.yaml']) {
            const varDeclPath = resolve(this.workDir, name);
            if (existsSync(varDeclPath)) {
                try {
                    const content = readFileSync(varDeclPath, 'utf-8');
                    const parsed = YAML.parse(content) || {};
                    const varsObj = parsed.variable || parsed;
                    if (typeof varsObj === 'object') {
                        this.declaredVars = { ...this.declaredVars, ...varsObj };
                        for (const [key, decl] of Object.entries(varsObj)) {
                            if (decl && typeof decl === 'object' && (decl as any).default !== undefined) {
                                this.vars[key] = String((decl as any).default);
                            } else if (decl !== undefined && decl !== null && typeof decl !== 'object') {
                                this.vars[key] = String(decl);
                            }
                        }
                    }
                } catch {}
                break;
            }
        }

        for (const name of ['locals.yml', 'locals.yaml', 'local.yml', 'local.yaml']) {
            const localsPath = resolve(this.workDir, name);
            if (existsSync(localsPath)) {
                try {
                    const content = readFileSync(localsPath, 'utf-8');
                    const parsed = YAML.parse(content) || {};
                    const localsObj = parsed.locals || parsed.local || parsed;
                    if (typeof localsObj === 'object') {
                        this.rawLocals = { ...this.rawLocals, ...localsObj };
                    }
                } catch {}
                break;
            }
        }

        // [Nivel 2] Funcionalidad / Dominio: archivos domain
        const domainFiles = findDomainConfigFiles(this.workDir);
        for (const filePath of domainFiles) {
            try {
                const content = readFileSync(filePath, 'utf-8');
                const parsed = YAML.parse(content);
                if (!parsed || typeof parsed !== 'object') continue;

                const varsBlock = parsed.variable;
                if (varsBlock && typeof varsBlock === 'object') {
                    for (const [key, val] of Object.entries(varsBlock)) {
                        if (val && typeof val === 'object' && !Array.isArray(val)) {
                            this.declaredVars[key] = { ...this.declaredVars[key], ...(val as any) };
                            if ((val as any).default !== undefined) {
                                this.vars[key] = String((val as any).default);
                            }
                        } else if (val !== undefined && val !== null) {
                            this.declaredVars[key] = { default: val };
                            this.vars[key] = String(val);
                        }
                    }
                }

                const localBlock = parsed.locals || parsed.local;
                if (localBlock && typeof localBlock === 'object') {
                    this.rawLocals = { ...this.rawLocals, ...localBlock };
                }
            } catch {
                // Ignore parse errors on domain files
            }
        }
    }

    /**
     * Auto-loads all *.vars.yml and *.vars.yaml files in the workspace directory.
     * Files are sorted alphabetically for deterministic precedence.
     */
    private loadAutoVarFiles() {
        if (!existsSync(this.workDir)) return;
        try {
            const entries = readdirSync(this.workDir);
            const varFiles = entries
                .filter(file => file.endsWith('.vars.yml') || file.endsWith('.vars.yaml'))
                .sort();

            for (const file of varFiles) {
                const fullPath = resolve(this.workDir, file);
                this.loadSingleYamlFile(fullPath);
            }
        } catch {
            // Ignore readdir errors
        }
    }

    private parseVars(varArgs?: string | string[]) {
        if (!varArgs) return;
        const items = Array.isArray(varArgs) ? varArgs : [varArgs];

        for (const item of items) {
            const idx = item.indexOf('=');
            if (idx === -1) {
                notify.push({
                    type: 'warning',
                    title: `Invalid variable format: ${item}`,
                    detail: ['Variables must be in the format key=value']
                });
                continue;
            }
            const key = item.substring(0, idx).trim();
            const value = item.substring(idx + 1).trim();
            this.vars[key] = value;
        }
    }

    private parseVarFiles(varFileArgs?: string | string[]) {
        if (!varFileArgs) return;
        const items = Array.isArray(varFileArgs) ? varFileArgs : [varFileArgs];

        for (let filePath of items) {
            filePath = resolve(this.workDir, filePath);

            if (!existsSync(filePath)) {
                notify.push({
                    type: 'error',
                    title: `Variable file not found: ${filePath}`,
                    detail: [],
                    close: true
                });
                process.exit(1);
            }

            if (!filePath.endsWith('.yml') && !filePath.endsWith('.yaml')) {
                notify.push({
                    type: 'error',
                    title: `Unsupported variable file format: ${filePath}`,
                    detail: ['Testform only supports YAML variable files (.yml or .yaml).'],
                    close: true
                });
                process.exit(1);
            }

            this.loadSingleYamlFile(filePath);
        }
    }

    private loadSingleYamlFile(filePath: string) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            const parsed = YAML.parse(content);
            if (parsed && typeof parsed === 'object') {
                const entries = parsed.variable || parsed;
                for (const [k, v] of Object.entries(entries)) {
                    if (v !== undefined && v !== null && typeof v !== 'object') {
                        this.vars[k] = String(v);
                    }
                }
            }
        } catch (error: any) {
            notify.push({
                type: 'error',
                title: `Failed to parse variable file: ${filePath}`,
                detail: [error.message],
                close: true
            });
            process.exit(1);
        }
    }

    /**
     * Validates declared variables: types, enums, and AST condition rules.
     */
    private validateVariables() {
        const evalContext = {
            vars: this.vars,
            locals: this.rawLocals,
            data: this.dataResolver,
            workDir: this.workDir
        };

        for (const [key, decl] of Object.entries(this.declaredVars)) {
            const val = this.vars[key];
            if (val === undefined) continue;

            // 1. Enum check
            if (decl.enum && Array.isArray(decl.enum) && decl.enum.length > 0) {
                const validValues = decl.enum.map(String);
                if (!validValues.includes(String(val))) {
                    notify.push({
                        type: 'error',
                        title: `Variable enum validation error: "${key}"`,
                        detail: [
                            `Value "${val}" is not in the allowed list: [${validValues.join(', ')}].`
                        ],
                        close: true
                    });
                }
            }

            // 2. Type check
            if (decl.type) {
                const type = decl.type.toLowerCase();
                if (type === 'number') {
                    if (isNaN(Number(val))) {
                        notify.push({
                            type: 'error',
                            title: `Variable type validation error: "${key}"`,
                            detail: [`Value "${val}" cannot be parsed as a number.`],
                            close: true
                        });
                    }
                } else if (type === 'boolean') {
                    if (val !== 'true' && val !== 'false' && typeof val !== 'boolean') {
                        notify.push({
                            type: 'error',
                            title: `Variable type validation error: "${key}"`,
                            detail: [`Value "${val}" is not a boolean ('true' or 'false').`],
                            close: true
                        });
                    }
                }
            }

            // 3. Validation rule check via AST expression engine
            if (decl.validation?.condition) {
                let result: any;
                try {
                    result = evaluateExpression(decl.validation.condition, evalContext);
                } catch (error: any) {
                    notify.push({
                        type: 'error',
                        title: `Error evaluating validation condition for "${key}"`,
                        detail: [error.message],
                        close: true
                    });
                }

                if (!result) {
                    notify.push({
                        type: 'error',
                        title: decl.validation.error_message || `Variable validation condition failed: "${key}"`,
                        detail: [
                            decl.validation.error_message ||
                            `Condition "${decl.validation.condition}" evaluated to false for variable "${key}".`
                        ],
                        close: true
                    });
                }
            }
        }
    }

    /**
     * Evaluates local expressions using the AST expression engine and function library.
     */
    private evaluateLocals() {
        const raw = { ...this.rawLocals };
        const evaluated: Record<string, string> = {};

        // Resolve expressions up to 3 passes for nested references
        for (let pass = 0; pass < 3; pass++) {
            for (const [key, val] of Object.entries(raw)) {
                if (typeof val !== 'string') {
                    evaluated[key] = String(val ?? '');
                    continue;
                }

                // First resolve module outputs if any
                let current = val.replace(/\$\{module\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g, (_, mod, out) => {
                    const fullKey = `module.${mod}.${out}`;
                    if (this.state) {
                        const stateOutputs = (this.state as any).getOutputs ? (this.state as any).getOutputs() : (this.state as any).outputs;
                        if (stateOutputs && stateOutputs[fullKey] && stateOutputs[fullKey].value !== undefined) {
                            return String(stateOutputs[fullKey].value);
                        }
                    }
                    if (this.outputResolver) {
                        const decls = this.outputResolver.getDeclarations ? this.outputResolver.getDeclarations() : {};
                        if (decls[fullKey] && decls[fullKey].value !== undefined) {
                            return String(decls[fullKey].value);
                        }
                    }
                    return `\${module.${mod}.${out}}`;
                });

                // Evaluate using AST engine
                const evalContext = {
                    vars: this.vars,
                    locals: evaluated,
                    data: this.dataResolver,
                    workDir: this.workDir
                };

                try {
                    evaluated[key] = interpolateExpressions(current, evalContext);
                } catch {
                    evaluated[key] = current;
                }
            }
        }

        this.locals = evaluated;
    }

    public getVars(): Record<string, string> {
        return this.vars;
    }

    public setVar(key: string, value: string) {
        this.vars[key] = value;
        this.validateVariables();
        this.evaluateLocals();
    }

    public getLocals(): Record<string, string> {
        return this.locals;
    }

    public getDeclaredVars(): Record<string, VariableDeclaration> {
        return this.declaredVars;
    }

    /**
     * Returns required variables that have no default and have not been set.
     */
    public getMissingRequiredVars(): { name: string; description?: string }[] {
        const missing: { name: string; description?: string }[] = [];
        for (const [name, decl] of Object.entries(this.declaredVars)) {
            const hasDefault = decl && typeof decl === 'object' && decl.default !== undefined;
            if (!hasDefault && this.vars[name] === undefined) {
                missing.push({
                    name,
                    description: decl?.description
                });
            }
        }
        return missing;
    }

    /**
     * Replaces expressions in template string with resolved values.
     */
    public applyToTemplate(template: string): string {
        if (typeof template !== 'string') return template;

        // Substitute module.*
        let result = template.replace(/\$\{module\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g, (match, mod, out) => {
            const fullKey = `module.${mod}.${out}`;
            if (this.state) {
                const stateOutputs = (this.state as any).getOutputs ? (this.state as any).getOutputs() : (this.state as any).outputs;
                if (stateOutputs && stateOutputs[fullKey] && stateOutputs[fullKey].value !== undefined) {
                    return String(stateOutputs[fullKey].value);
                }
            }
            if (this.outputResolver) {
                const decls = this.outputResolver.getDeclarations ? this.outputResolver.getDeclarations() : {};
                if (decls[fullKey] && decls[fullKey].value !== undefined) {
                    return String(decls[fullKey].value);
                }
            }
            return match;
        });

        // Evaluate with AST engine
        const evalContext = {
            vars: this.vars,
            locals: this.locals,
            data: this.dataResolver,
            workDir: this.workDir
        };

        return interpolateExpressions(result, evalContext);
    }

    public setOutputResolver(outputResolver: any) {
        this.outputResolver = outputResolver;
    }

    public setState(state: any) {
        this.state = state;
    }

    public getDataResolver(): DataResolver {
        return this.dataResolver;
    }
}
