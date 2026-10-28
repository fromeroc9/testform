import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync, statSync, readdirSync, mkdirSync } from 'fs';
import { Parser as Parse, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import YAML from 'yaml';
import { ParserStep } from './types';
import { findDomainConfigFiles, reassembleSplitTags, sanitizeTagsWithSpaces, restoreTagsWithSpaces } from './utils';
import { CONFIG_FILE_NAMES } from './const';

export interface ModuleTarget {
    name?: string;
    source: string;
    scenario?: string; // Optional: e.g. "@tc-1" or "Login con credenciales"
    vars?: Record<string, any>; // Input parameters passed to module
}

export interface ModuleDeclaration {
    source: string;
    version?: string;
    scenario?: string;
    vars?: Record<string, any>;
    outputs?: Record<string, any>;
}

/**
 * Registry of declared modules from testform.yml and domain configuration files.
 */
export class ModuleRegistry {
    private declaredModules: Map<string, ModuleDeclaration> = new Map();
    private workDir: string;

    constructor(workDir: string = '.') {
        this.workDir = workDir;
        this.loadDeclarations();
    }

    public loadDeclarations(): void {
        // 1. Root main.yml / CONFIG_FILE_NAMES
        for (const name of CONFIG_FILE_NAMES) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    const mods = parsed?.module || parsed?.modules;
                    if (mods && typeof mods === 'object') {
                        this.registerModules(mods);
                    }
                } catch {
                    // ignore parse errors
                }
            }
        }

        // 2. Domain files
        const domainFiles = findDomainConfigFiles(this.workDir);
        for (const f of domainFiles) {
            try {
                const parsed = YAML.parse(readFileSync(f, 'utf-8'));
                const mods = parsed?.module || parsed?.modules;
                if (mods && typeof mods === 'object') {
                    this.registerModules(mods);
                }
            } catch {
                // ignore
            }
        }
    }

    private registerModules(raw: Record<string, any>): void {
        for (const [name, cfg] of Object.entries(raw)) {
            if (!cfg || typeof cfg !== 'object') continue;
            this.declaredModules.set(name, {
                source: cfg.source || '',
                version: cfg.version || '',
                scenario: cfg.scenario || cfg.id,
                vars: cfg.vars && typeof cfg.vars === 'object' ? cfg.vars : undefined,
                outputs: cfg.outputs && typeof cfg.outputs === 'object' ? cfg.outputs : undefined,
            });
        }
    }

    public getModule(name: string): ModuleDeclaration | undefined {
        return this.declaredModules.get(name);
    }

    public getDeclaredModules(): Map<string, ModuleDeclaration> {
        return this.declaredModules;
    }
}

/**
 * Checks if a module source string is a remote Git repository.
 */
export function isGitSource(source: string): boolean {
    return source.startsWith('git::') ||
           source.startsWith('git@') ||
           (source.startsWith('https://') && source.includes('.git'));
}

export interface ParsedGitSource {
    repoUrl: string;
    subPath?: string;
    ref?: string;
}

/**
 * Parses Git module source addresses (e.g. git::https://github.com/org/repo.git//modules/auth?ref=v1.2.0).
 */
export function parseGitSource(source: string): ParsedGitSource {
    let clean = source.replace(/^git::/, '');

    let ref: string | undefined;
    const refIdx = clean.indexOf('?ref=');
    if (refIdx !== -1) {
        ref = clean.substring(refIdx + 5);
        clean = clean.substring(0, refIdx);
    }

    let subPath: string | undefined;
    const protoEnd = clean.indexOf('://');
    const searchStart = protoEnd !== -1 ? protoEnd + 3 : 0;
    const subIdx = clean.indexOf('//', searchStart);
    if (subIdx !== -1) {
        subPath = clean.substring(subIdx + 2);
        clean = clean.substring(0, subIdx);
    }

    return { repoUrl: clean, subPath, ref };
}

/**
 * Parses input variables inside vars={...} argument of @module.
 */
function parseVarsArgument(tag: string): Record<string, any> | undefined {
    const varsIdx = tag.indexOf('vars=');
    if (varsIdx === -1) return undefined;

    const openIdx = tag.indexOf('{', varsIdx);
    if (openIdx === -1) return undefined;

    let openCount = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < tag.length; i++) {
        if (tag[i] === '{') openCount++;
        else if (tag[i] === '}') {
            openCount--;
            if (openCount === 0) {
                closeIdx = i;
                break;
            }
        }
    }

    if (closeIdx === -1) return undefined;

    const rawInner = tag.substring(openIdx + 1, closeIdx).trim();
    if (!rawInner) return {};

    try {
        const parsed = YAML.parse(`{\n${rawInner}\n}`);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch {
        // Fallback: simple key-value split
        const res: Record<string, any> = {};
        const pairs = rawInner.split(',');
        for (const p of pairs) {
            const colon = p.indexOf(':');
            if (colon > 0) {
                const k = p.substring(0, colon).trim().replace(/^['"]|['"]$/g, '');
                const v = p.substring(colon + 1).trim().replace(/^['"]|['"]$/g, '');
                res[k] = v;
            }
        }
        return res;
    }
    return undefined;
}

/**
 * Parses @module tags at Feature or Scenario level with optional scenario selection,
 * named module lookup, and input variable parameters.
 * Examples:
 *   @module(source="./auth.case.feature")
 *   @module(source="./auth.case.feature", vars={user: "admin", env: "${var.environment}"})
 *   @module(source="./auth.case.feature", scenario="@tc-1", vars={user: "admin"})
 *   @module(name="auth_standard", vars={user: "custom"})
 *   @module("auth_standard")
 *   @module("./auth.case.feature.@tc-1")
 *   @module(source=["./m1.feature.@tc-1", "./m2.feature"])
 */
export function parseModuleTargets(tag: string, registry?: ModuleRegistry): ModuleTarget[] | null {
    if (!tag.startsWith('@module')) return null;

    // Check for named scenario/id parameter: scenario="..." or id="..."
    const scenarioArgMatch = tag.match(/[,;]\s*(?:scenario|id)=['"]([^'"]+)['"]/i);
    const scenarioArg = scenarioArgMatch ? scenarioArgMatch[1].trim() : undefined;

    // Extract vars={...} if present
    const parsedVars = parseVarsArgument(tag);

    // Check for name="..."
    const nameMatch = tag.match(/name=['"]([^'"]+)['"]/i);
    const explicitName = nameMatch ? nameMatch[1].trim() : undefined;

    // 1. Array format: @module(source=["...", "..."])
    const arrayMatch = tag.match(/@module\(source=\[([^\]]+)\]/i);
    if (arrayMatch) {
        return arrayMatch[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
            .map(item => {
                if (item.includes('.feature.')) {
                    const idx = item.indexOf('.feature.');
                    return {
                        source: item.slice(0, idx + 8).trim(),
                        scenario: item.slice(idx + 9).trim(),
                        vars: parsedVars
                    };
                }
                return { source: item, scenario: scenarioArg, vars: parsedVars };
            });
    }

    // 2. Named module reference via name="..."
    if (explicitName && registry) {
        const declared = registry.getModule(explicitName);
        if (declared) {
            return [{
                name: explicitName,
                source: declared.source,
                scenario: scenarioArg || declared.scenario,
                vars: { ...(declared.vars || {}), ...(parsedVars || {}) }
            }];
        }
        return [{
            name: explicitName,
            source: explicitName,
            scenario: scenarioArg,
            vars: parsedVars
        }];
    }

    // 3. Single source: @module(source="...") or @module(source='...')
    const singleMatch = tag.match(/@module\(source=['"]([^'"]+)['"]/i);
    if (singleMatch) {
        let src = singleMatch[1].trim();
        let sc = scenarioArg;

        // Check if src is a registered module name
        if (registry) {
            const declared = registry.getModule(src);
            if (declared) {
                return [{
                    name: src,
                    source: declared.source,
                    scenario: sc || declared.scenario,
                    vars: { ...(declared.vars || {}), ...(parsedVars || {}) }
                }];
            }
        }

        if (src.includes('.feature.')) {
            const idx = src.indexOf('.feature.');
            sc = src.slice(idx + 9).trim();
            src = src.slice(0, idx + 8).trim();
        }
        return [{ source: src, scenario: sc, vars: parsedVars }];
    }

    // 4. Shorthand: @module("...") or @module('...')
    const directMatch = tag.match(/@module\(['"]([^'"]+)['"]/i);
    if (directMatch) {
        let src = directMatch[1].trim();
        let sc = scenarioArg;

        // Check if src is a registered module name
        if (registry) {
            const declared = registry.getModule(src);
            if (declared) {
                return [{
                    name: src,
                    source: declared.source,
                    scenario: sc || declared.scenario,
                    vars: { ...(declared.vars || {}), ...(parsedVars || {}) }
                }];
            }
        }

        if (src.includes('.feature.')) {
            const idx = src.indexOf('.feature.');
            sc = src.slice(idx + 9).trim();
            src = src.slice(0, idx + 8).trim();
        }
        return [{ source: src, scenario: sc, vars: parsedVars }];
    }

    return null;
}

/** Backward compatibility helper */
export function parseModuleTag(tag: string, registry?: ModuleRegistry): string[] | null {
    const targets = parseModuleTargets(tag, registry);
    if (!targets) return null;
    return targets.map(t => t.scenario ? `${t.source}.${t.scenario}` : t.source);
}

/**
 * Searches for a feature file within a directory.
 */
function findFeatureInDir(dir: string): string | null {
    try {
        const entries = readdirSync(dir);
        for (const e of entries) {
            if (e.endsWith('.feature')) {
                return resolve(dir, e);
            }
        }
    } catch {
        // ignore
    }
    return null;
}

/**
 * Resolves a module file path relative to the current feature file's directory or workspace.
 * Also checks .testform/modules/ for installed modules.
 */
export function resolveModulePath(
    currentFilePath: string,
    sourcePath: string,
    workspaceRoot: string = process.cwd(),
    registry?: ModuleRegistry
): string | null {
    // 0. If sourcePath is a declared module name in registry
    if (registry) {
        const declared = registry.getModule(sourcePath);
        if (declared && declared.source) {
            return resolveModulePath(currentFilePath, declared.source, workspaceRoot, undefined);
        }
    }

    // 1. Try relative to current feature file
    const relToFeature = resolve(dirname(currentFilePath), sourcePath);
    if (existsSync(relToFeature)) {
        if (statSync(relToFeature).isFile()) {
            return relToFeature;
        }
        const candidate = findFeatureInDir(relToFeature);
        if (candidate) return candidate;
    }

    // 2. Try relative to workspace root
    const relToRoot = resolve(workspaceRoot, sourcePath);
    if (existsSync(relToRoot)) {
        if (statSync(relToRoot).isFile()) {
            return relToRoot;
        }
        const candidate = findFeatureInDir(relToRoot);
        if (candidate) return candidate;
    }

    // 3. Try under .testform/modules/<sourcePath>
    const underDotTestform = resolve(workspaceRoot, '.testform', 'modules', sourcePath);
    if (existsSync(underDotTestform)) {
        if (statSync(underDotTestform).isFile()) {
            return underDotTestform;
        }
        const candidate = findFeatureInDir(underDotTestform);
        if (candidate) return candidate;
    }

    return null;
}

/**
 * Reads default variables from a module's directory if present (e.g. vars.yml or testform.yml).
 */
function loadModuleDirectoryDefaults(moduleFilePath: string): Record<string, any> {
    const dir = dirname(moduleFilePath);
    const defaults: Record<string, any> = {};

    for (const name of ['variables.yml', 'variables.yaml', ...CONFIG_FILE_NAMES]) {
        const p = join(dir, name);
        if (existsSync(p)) {
            try {
                const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                const varsBlock = parsed?.variable;
                if (varsBlock && typeof varsBlock === 'object') {
                    for (const [k, v] of Object.entries(varsBlock)) {
                        if (v && typeof v === 'object' && 'default' in (v as any)) {
                            defaults[k] = (v as any).default;
                        } else if (v !== undefined) {
                            defaults[k] = v;
                        }
                    }
                }
            } catch {
                // ignore
            }
        }
    }

    return defaults;
}

/**
 * Reads and parses steps from a module feature file for scenario-level composition.
 * If targetScenario is specified, only steps from that scenario (plus background) are loaded.
 * Applies module input variables (moduleVars) and variable interpolation (variableParser).
 */
export function loadModuleSteps(
    moduleFilePath: string,
    targetScenario?: string,
    moduleVars?: Record<string, any>,
    variableParser?: any
): ParserStep[] {
    try {
        let content = readFileSync(moduleFilePath, 'utf-8');
        content = sanitizeTagsWithSpaces(content);
        const parser = new Parse(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
        const doc = parser.parse(content);
        const steps: ParserStep[] = [];

        if (doc.feature) {
            const bgSteps: ParserStep[] = [];
            for (const child of doc.feature.children || []) {
                if (child.background) {
                    for (const s of child.background.steps || []) {
                        bgSteps.push({ keyword: s.keyword, keywordType: s.keywordType, text: s.text });
                    }
                }
            }

            for (const child of doc.feature.children || []) {
                if (child.scenario) {
                    const s = child.scenario;
                    if (targetScenario) {
                        const targetNorm = targetScenario.toLowerCase().trim();
                        const targetNoAt = targetNorm.startsWith('@') ? targetNorm.slice(1) : targetNorm;
                        const scenarioTags = (s.tags || []).map((t: any) => t.name.toLowerCase().trim());
                        const hasMatchingTag = scenarioTags.some(t => t === targetNorm || t === `@${targetNoAt}` || t === targetNoAt);
                        const hasMatchingName = s.name.toLowerCase().trim() === targetNorm;

                        if (!hasMatchingTag && !hasMatchingName) {
                            continue;
                        }
                    }

                    if (steps.length === 0 && bgSteps.length > 0) {
                        steps.push(...bgSteps);
                    }
                    for (const step of s.steps || []) {
                        steps.push({ keyword: step.keyword, keywordType: step.keywordType, text: step.text });
                    }

                    if (targetScenario) break;
                }
            }
        }

        // Merge module directory defaults with explicitly provided moduleVars
        const dirDefaults = loadModuleDirectoryDefaults(moduleFilePath);
        const effectiveVars: Record<string, any> = { ...dirDefaults, ...(moduleVars || {}) };

        // Parameterize steps with effectiveVars and variableParser
        return steps.map(step => {
            let text = step.text;

            // 1. Module parameter substitution (<param> and ${var.param} and ${param})
            for (const [k, v] of Object.entries(effectiveVars)) {
                const valStr = v !== null && v !== undefined ? String(v) : '';
                text = text.split(`<${k}>`).join(valStr);
                text = text.split(`\${var.${k}}`).join(valStr);
                text = text.split(`\${${k}}`).join(valStr);
            }

            // 2. Global variable parser resolution
            if (variableParser && typeof variableParser.applyToTemplate === 'function') {
                text = variableParser.applyToTemplate(text);
            }

            return {
                ...step,
                text
            };
        });
    } catch {
        return [];
    }
}
