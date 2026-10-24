import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { logger as notify } from '../core/logger';
import { CONFIG_FILE_NAMES } from '../core/const';
import { DataResolver } from './data';
import { findDomainConfigFiles } from './utils';

export interface VariableDeclaration {
    type?: string;
    description?: string;
    default?: any;
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
        this.parseVarFiles(varFileArgs);
        this.parseVars(varArgs);
        this.evaluateLocals();
    }


    /**
     * Loads variable and local declarations according to the precedence hierarchy:
     *   [Nivel 0] Monolito Base: testform.yml (defaults globales)
     *   [Nivel 1] Estándar Terraform: vars.yml, local.yml
     *   [Nivel 2] Funcionalidad / Dominio: auth.yml, checkout.yml, pagos.yml
     */
    private loadDeclarations() {
        // [Nivel 0] Monolito Base: testform.yml
        for (const name of CONFIG_FILE_NAMES) {
            const configPath = resolve(this.workDir, name);
            if (existsSync(configPath)) {
                try {
                    const content = readFileSync(configPath, 'utf-8');
                    const parsed = YAML.parse(content) || {};
                    const varsBlock = parsed.vars;
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
                    const localBlock = parsed.local;
                    if (localBlock && typeof localBlock === 'object') {
                        this.rawLocals = { ...this.rawLocals, ...localBlock };
                    }
                } catch {
                    // Ignore parse errors here, validated separately
                }
                break;
            }
        }

        // [Nivel 1] Estándar Terraform: vars.yml / local.yml
        for (const name of ['vars.yml', 'vars.yaml']) {
            const varDeclPath = resolve(this.workDir, name);
            if (existsSync(varDeclPath)) {
                try {
                    const content = readFileSync(varDeclPath, 'utf-8');
                    const parsed = YAML.parse(content) || {};
                    const varsObj = parsed.vars || parsed;
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

        for (const name of ['local.yml', 'local.yaml']) {
            const localsPath = resolve(this.workDir, name);
            if (existsSync(localsPath)) {
                try {
                    const content = readFileSync(localsPath, 'utf-8');
                    const parsed = YAML.parse(content) || {};
                    const localsObj = parsed.local || parsed;
                    if (typeof localsObj === 'object') {
                        this.rawLocals = { ...this.rawLocals, ...localsObj };
                    }
                } catch {}
                break;
            }
        }

        // [Nivel 2] Funcionalidad / Dominio: auth.yml, checkout.yml, pagos.yml
        // Se escanean recursivamente todos los .yml/.yaml del proyecto.
        // Tienen máxima prioridad de configuración sobre Nivel 0 y Nivel 1.
        const domainFiles = findDomainConfigFiles(this.workDir);
        for (const filePath of domainFiles) {
            try {
                const content = readFileSync(filePath, 'utf-8');
                const parsed = YAML.parse(content);
                if (!parsed || typeof parsed !== 'object') continue;

                // Si contiene vars:, suma o sobreescribe las variables
                if (parsed.vars && typeof parsed.vars === 'object') {
                    for (const [key, val] of Object.entries(parsed.vars)) {
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

                // Si contiene local:, suma o sobreescribe los valores locales
                if (parsed.local && typeof parsed.local === 'object') {
                    this.rawLocals = { ...this.rawLocals, ...parsed.local };
                }
            } catch {
                // Ignore parse errors on domain files
            }
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
                const entries = parsed.vars || parsed;
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
     * Evaluates local expressions, resolving variables and local dependencies.
     */
    private evaluateLocals() {
        const raw = { ...this.rawLocals };
        const evaluated: Record<string, string> = {};

        // Resolve ${var.x} and ${local.x} up to 3 passes for nested references
        for (let pass = 0; pass < 3; pass++) {
            for (const [key, val] of Object.entries(raw)) {
                if (typeof val !== 'string') {
                    evaluated[key] = String(val ?? '');
                    continue;
                }

                let resolved = val;
                // Substitute var.*
                resolved = resolved.replace(/\$\{var\.([a-zA-Z0-9_-]+)\}/g, (_, k) => {
                    return this.vars[k] !== undefined ? this.vars[k] : `\${var.${k}}`;
                });
                // Substitute local.*
                resolved = resolved.replace(/\$\{local\.([a-zA-Z0-9_-]+)\}/g, (_, k) => {
                    return evaluated[k] !== undefined ? evaluated[k] : `\${local.${k}}`;
                });
                // Substitute data.*
                resolved = resolved.replace(/\$\{data\.([a-zA-Z0-9_\-\.\@\/]+)\}/g, (_, k) => {
                    const dataVal = this.dataResolver.resolvePath(k);
                    return dataVal !== undefined && dataVal !== null ? (typeof dataVal === 'object' ? JSON.stringify(dataVal) : String(dataVal)) : `\${data.${k}}`;
                });
                // Substitute module.*
                resolved = resolved.replace(/\$\{module\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g, (_, mod, out) => {
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

                evaluated[key] = resolved;
            }
        }

        this.locals = evaluated;
    }

    public getVars(): Record<string, string> {
        return this.vars;
    }

    public setVar(key: string, value: string) {
        this.vars[key] = value;
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
     * Replaces ${var.name} and ${local.name} in the given template string
     * with the corresponding resolved values.
     */
    public applyToTemplate(template: string): string {
        let result = template;

        // Match ${var.NAME}
        const varRegex = /\$\{var\.([a-zA-Z0-9_-]+)\}/g;
        result = result.replace(varRegex, (match, key) => {
            return this.vars[key] !== undefined ? this.vars[key] : match;
        });

        // Match ${local.NAME}
        const localRegex = /\$\{local\.([a-zA-Z0-9_-]+)\}/g;
        result = result.replace(localRegex, (match, key) => {
            return this.locals[key] !== undefined ? this.locals[key] : match;
        });

        // Match ${data.PATH}
        const dataRegex = /\$\{data\.([a-zA-Z0-9_\-\.\@\/]+)\}/g;
        result = result.replace(dataRegex, (match, path) => {
            const val = this.dataResolver.resolvePath(path);
            if (val !== undefined && val !== null) {
                return typeof val === 'object' ? JSON.stringify(val) : String(val);
            }
            return match;
        });

        // Match ${module.NAME.OUTPUT}
        const moduleRegex = /\$\{module\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g;
        result = result.replace(moduleRegex, (match, mod, out) => {
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

        return result;
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
