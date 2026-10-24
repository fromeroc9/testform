/**
 * @fileoverview Base Gherkin parser.
 *
 * Handles file reading, tokenization, AST building, and base DSL field extraction.
 * Specialized parsers (testcase, testrun, testplan) extend this class to implement
 * their specific filtering and data enrichment logic.
 */

import { Parser as Parse, AstBuilder, GherkinClassicTokenMatcher } from "@cucumber/gherkin";
import { Background, FeatureChild, GherkinDocument, IdGenerator, RuleChild, Step, TableCell, Tag } from "@cucumber/messages";
import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative } from "path";
import {
    IField, IScope, ITest,
    ParserFeature, ParserScenario, ParserStep, ParserBackground, ParserRule
} from '../core/types';
import { VariableParser } from '../core/variables';
import { CONFIG_FILE_NAMES } from '../core/const';
import { parseModuleTargets, parseModuleTag, resolveModulePath, loadModuleSteps, ModuleRegistry } from '../core/module';
import { reassembleSplitTags, sanitizeTagsWithSpaces, restoreTagsWithSpaces } from '../core/utils';
import { findFeatureFiles } from '../core/editor';
import { Diag } from '../core/diagnostics';

export const FIELD_PATTERN = /^(?:field)\s+([A-Za-z0-9_.\- ]+?)\s*=\s*(.+)$/i;

export abstract class BaseParser {
    private moduleRegistry?: ModuleRegistry;

    constructor(
        protected dir: string,
        protected variables?: VariableParser
    ) { }

    protected getModuleRegistry(): ModuleRegistry {
        if (!this.moduleRegistry) {
            this.moduleRegistry = new ModuleRegistry(this.dir);
        }
        return this.moduleRegistry;
    }

    protected find(targetPath: string): string[] {
        return findFeatureFiles(targetPath, true);
    }

    protected format(document: GherkinDocument, fileAbs?: string): ParserScenario[] {
        const feature = document.feature;
        const uri = document.uri ?? "(unknown)";
        const currentFile = fileAbs || uri;

        const toStep = (s: Step): ParserStep => ({
            keyword: s.keyword,
            keywordType: s.keywordType,
            text: s.text,
        });

        const toBackground = (bg: Background): ParserBackground => ({
            keyword: bg.keyword,
            name: bg.name,
            steps: (bg.steps ?? []).map(toStep),
        });

        const interpolate = (text: string, headers: string[], values: string[]): string =>
            headers.reduce((acc, h, i) => acc.split(`<${h}>`).join(values[i]), text);

        const processChildren = (
            children: readonly (FeatureChild | RuleChild)[],
            parentBackground?: ParserBackground,
            rule?: ParserRule
        ): ParserScenario[] => {
            const result: ParserScenario[] = [];
            const localBg = children[0]?.background ? toBackground(children[0].background) : parentBackground;

            for (const child of children) {
                if (child.background) continue;

                if (child.scenario) {
                    const s = child.scenario;
                    const featureTags = (feature?.tags ?? []).map((t: any) => restoreTagsWithSpaces(t.name));
                    const tags: string[] = [...featureTags, ...(s.tags ?? []).map((t: any) => restoreTagsWithSpaces(t.name))];
                    const isUnique = tags.includes("@unique");
                    const hasTemplate = (s.name).includes("<") || (s.steps ?? []).some((st: Step) => (st.text).includes("<")) || tags.some((t) => t.includes("<"));

                    const featureObj: ParserFeature = {
                        tags: (feature?.tags ?? []).map((t: Tag) => restoreTagsWithSpaces(t.name)),
                        keyword: feature?.keyword ?? "",
                        name: feature?.name ?? "",
                        description: feature?.description ?? "",
                        location: feature?.location.line ?? 0
                    };

                    // Handle Scenario-level @module composition (inheriting steps)
                    const moduleSteps: ParserStep[] = [];
                    const reassembledModuleTags = reassembleSplitTags(tags, '@module(');
                    for (const t of reassembledModuleTags) {
                        const moduleTargets = parseModuleTargets(t, this.getModuleRegistry());
                        if (moduleTargets) {
                            for (const target of moduleTargets) {
                                const resolved = resolveModulePath(currentFile, target.source, this.dir, this.getModuleRegistry());
                                if (resolved) {
                                    const evaluatedVars: Record<string, any> = {};
                                    if (target.vars) {
                                        for (const [k, v] of Object.entries(target.vars)) {
                                            if (typeof v === 'string' && this.variables) {
                                                evaluatedVars[k] = this.variables.applyToTemplate(v);
                                            } else {
                                                evaluatedVars[k] = v;
                                            }
                                        }
                                    }
                                    moduleSteps.push(...loadModuleSteps(resolved, target.scenario, evaluatedVars, this.variables));
                                }
                            }
                        }
                    }

                    if (isUnique && hasTemplate && (s.examples ?? []).length > 0) {
                        for (const example of s.examples) {
                            const headers: string[] = (example.tableHeader?.cells ?? []).map((c: TableCell) => c.value);
                            for (const row of example.tableBody ?? []) {
                                const values: string[] = (row.cells ?? []).map((c: TableCell) => c.value);
                                result.push({
                                    uri,
                                    feature: featureObj,
                                    location: s.location.line,
                                    keyword: s.keyword,
                                    name: interpolate(s.name, headers, values),
                                    description: s.description,
                                    tags: tags.map((t) => interpolate(t, headers, values)),
                                    steps: [
                                        ...moduleSteps,
                                        ...(s.steps ?? []).map((step) => ({
                                            keyword: step.keyword,
                                            keywordType: step.keywordType,
                                            text: interpolate(step.text, headers, values),
                                        }))
                                    ],
                                    ...(localBg ? { background: JSON.parse(JSON.stringify(localBg)) } : {}),
                                    ...(rule ? { rule } : {}),
                                });
                            }
                        }
                    } else {
                        result.push({
                            uri,
                            feature: featureObj,
                            location: s.location.line,
                            keyword: s.keyword,
                            name: s.name,
                            description: s.description,
                            tags,
                            steps: [...moduleSteps, ...(s.steps ?? []).map(toStep)],
                            ...(localBg ? { background: JSON.parse(JSON.stringify(localBg)) } : {}),
                            ...(rule ? { rule } : {}),
                        });
                    }
                }

                if ("rule" in child && child.rule) {
                    const r = child.rule;
                    const ruleObj: ParserRule = {
                        keyword: r.keyword,
                        name: r.name,
                        description: r.description ?? '',
                    };
                    const ruleScenarios = processChildren(r.children ?? [], localBg, ruleObj);
                    if (ruleScenarios.length === 0) {
                        const ruleBgNode = (r.children ?? [])[0]?.background;
                        const ruleBg = ruleBgNode ? toBackground(ruleBgNode) : localBg;
                        result.push({
                            uri,
                            feature: {
                                keyword: feature?.keyword ?? "",
                                name: feature?.name ?? "",
                                description: feature?.description ?? "",
                                tags: (feature?.tags ?? []).map((t) => t.name),
                                location: feature?.location?.line ?? 0
                            },
                            location: r.location.line,
                            keyword: r.keyword,
                            name: '*',
                            description: r.description,
                            tags: [...(feature?.tags ?? []).map((t: any) => t.name)],
                            steps: [],
                            ...(ruleBg ? { background: JSON.parse(JSON.stringify(ruleBg)) } : {}),
                            rule: ruleObj
                        });
                    } else {
                        result.push(...ruleScenarios);
                    }
                }
            }
            return result;
        };

        if (!feature) return [];
        return processChildren(feature.children ?? []);
    }

    private findProjectRoot(startDir: string): string {
        const { resolve, dirname } = require('path');
        const { existsSync } = require('fs');
        let currentDir = resolve(startDir);
        const rootDir = resolve('/');

        while (currentDir !== rootDir) {
            for (const name of CONFIG_FILE_NAMES) {
                const configPath = resolve(currentDir, name);
                if (existsSync(configPath)) {
                    return currentDir;
                }
            }
            const parentDir = dirname(currentDir);
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }

        return startDir;
    }

    public content(): ParserScenario[] {
        const featureFiles = this.find(this.dir);
        const scenarios: ParserScenario[] = [];
        const projectRoot = this.findProjectRoot(this.dir);

        const loadedModules = new Set<string>();
        for (const file of featureFiles) {
            let content = readFileSync(file, "utf-8");
            if (this.variables) {
                content = this.variables.applyToTemplate(content);
            }
            content = sanitizeTagsWithSpaces(content);
            const parser = new Parse(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
            let rawDoc: GherkinDocument = null as any;
            try {
                rawDoc = parser.parse(content);
            } catch (err: any) {
                const errMsg: string = err.message || String(err);
                const match = errMsg.match(/\((\d+):(\d+)\):\s*(.+)/);
                const lineNum = match ? parseInt(match[1], 10) : undefined;
                const fileLines = content.split('\n');
                const snippet = (lineNum && fileLines[lineNum - 1]) ? fileLines[lineNum - 1].trim() : undefined;
                const displayPath = relative(projectRoot, file) || file;

                const detail = errMsg
                    .split('\n')
                    .map((l: string) => l.trim())
                    .filter((l: string) => l.length > 0 && !l.startsWith('Parser errors:'));

                Diag.structureError({
                    file: displayPath,
                    message: "Failed to parse Gherkin feature file",
                    location: {
                        file: displayPath,
                        line: lineNum,
                        snippet,
                    },
                    detail,
                }).abort();
            }
            rawDoc.uri = relative(projectRoot, file);

            // Check for Feature-level @module tags to accumulate module scenarios
            const featureTags = (rawDoc.feature?.tags ?? []).map((t: any) => restoreTagsWithSpaces(t.name));
            const reassembledFeatureTags = reassembleSplitTags(featureTags, '@module(');
            for (const tag of reassembledFeatureTags) {
                const targets = parseModuleTargets(tag, this.getModuleRegistry());
                if (targets) {
                    for (const target of targets) {
                        const resolvedMod = resolveModulePath(file, target.source, projectRoot, this.getModuleRegistry());
                        if (resolvedMod && !featureFiles.includes(resolvedMod) && !loadedModules.has(resolvedMod)) {
                            loadedModules.add(resolvedMod);
                            try {
                                let modContent = readFileSync(resolvedMod, "utf-8");
                                if (this.variables) {
                                    modContent = this.variables.applyToTemplate(modContent);
                                }
                                modContent = sanitizeTagsWithSpaces(modContent);
                                const modDoc = parser.parse(modContent);
                                modDoc.uri = relative(projectRoot, resolvedMod);
                                scenarios.push(...this.format(modDoc, resolvedMod));
                            } catch {
                                // Ignore non-parseable module
                            }
                        }
                    }
                }
            }

            scenarios.push(...this.format(rawDoc, file));
        }

        return scenarios;
    }

    protected dslFields(fields: IField[]) {
        const keywordFields = new Map<string, IField>();
        const tagFields = new Map<string, IField>();

        for (const field of fields) {
            if (field.type === "keywords") {
                keywordFields.set(field.name.toLowerCase(), field);
            }
            if (field.type === "tags") {
                tagFields.set(field.name.toLowerCase(), field);
            }
        }
        return { keywordFields, tagFields }
    }

    protected compileIdentityMatcher(pattern?: string): { type: 'wildcard'; prefix: string; suffix: string } | { type: 'exact'; value: string } | null {
        if (!pattern) return null;
        const normalized = pattern.trim().replace(/^@/, "");

        if (normalized.includes("*")) {
            const parts = normalized.split('*');
            return { type: 'wildcard', prefix: parts[0], suffix: parts[1] || '' };
        }

        return { type: 'exact', value: normalized };
    }

    protected matchIdentity(tags: string[], matcher: { type: 'wildcard'; prefix: string; suffix: string } | { type: 'exact'; value: string }): { identityValue?: string; tagToRemove?: string } {
        if (matcher.type === 'wildcard') {
            for (const tag of tags) {
                const normalizedTag = tag.replace(/^@/, "");
                if (normalizedTag.startsWith(matcher.prefix) && normalizedTag.endsWith(matcher.suffix)) {
                    return { identityValue: tag, tagToRemove: tag };
                }
            }
            return {};
        }

        const matched = tags.find((tag) => tag.replace(/^@/, "") === matcher.value);
        if (matched) {
            return { identityValue: matched, tagToRemove: matched };
        }
        return {};
    }

    public abstract filter(scenarios: ParserScenario[], test: ITest, scope?: IScope): ParserScenario[];
}
