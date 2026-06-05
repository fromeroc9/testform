"use strict";
/**
 * @fileoverview Base Gherkin parser.
 *
 * Handles file reading, tokenization, AST building, and base DSL field extraction.
 * Specialized parsers (testcase, testrun, testplan) extend this class to implement
 * their specific filtering and data enrichment logic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseParser = exports.FIELD_PATTERN = void 0;
const gherkin_1 = require("@cucumber/gherkin");
const messages_1 = require("@cucumber/messages");
const fs_1 = require("fs");
const path_1 = require("path");
exports.FIELD_PATTERN = /^(?:field)\s+([A-Za-z0-9_.\- ]+?)\s*=\s*(.+)$/i;
class BaseParser {
    dir;
    variables;
    constructor(dir, variables) {
        this.dir = dir;
        this.variables = variables;
    }
    find(targetPath) {
        try {
            const stat = (0, fs_1.statSync)(targetPath);
            if (stat.isFile() && targetPath.endsWith('.feature')) {
                return [targetPath];
            }
            if (stat.isDirectory()) {
                const entries = (0, fs_1.readdirSync)(targetPath, { withFileTypes: true });
                const result = [];
                for (const entry of entries) {
                    const filePath = (0, path_1.join)(targetPath, entry.name);
                    if (entry.isDirectory()) {
                        result.push(...this.find(filePath));
                    }
                    else if (entry.name.endsWith('.feature')) {
                        result.push(filePath);
                    }
                }
                return result;
            }
            return [];
        }
        catch (e) {
            return [];
        }
    }
    format(document) {
        const feature = document.feature;
        const uri = document.uri ?? "(unknown)";
        const toStep = (s) => ({
            keyword: s.keyword,
            keywordType: s.keywordType,
            text: s.text,
        });
        const toBackground = (bg) => ({
            keyword: bg.keyword,
            name: bg.name,
            steps: (bg.steps ?? []).map(toStep),
        });
        const interpolate = (text, headers, values) => headers.reduce((acc, h, i) => acc.split(`<${h}>`).join(values[i]), text);
        const processChildren = (children, parentBackground, rule) => {
            const result = [];
            const localBg = children[0]?.background ? toBackground(children[0].background) : parentBackground;
            for (const child of children) {
                if (child.background)
                    continue;
                if (child.scenario) {
                    const s = child.scenario;
                    const featureTags = (feature?.tags ?? []).map((t) => t.name);
                    const tags = [...featureTags, ...(s.tags ?? []).map((t) => t.name)];
                    const isUnique = tags.includes("@unique");
                    const hasTemplate = (s.name).includes("<") || (s.steps ?? []).some((st) => (st.text).includes("<")) || tags.some((t) => t.includes("<"));
                    const featureObj = {
                        tags: (feature?.tags ?? []).map((t) => t.name),
                        keyword: feature?.keyword ?? "",
                        name: feature?.name ?? "",
                        description: feature?.description ?? "",
                        location: feature?.location.line ?? 0
                    };
                    if (isUnique && hasTemplate && (s.examples ?? []).length > 0) {
                        for (const example of s.examples) {
                            const headers = (example.tableHeader?.cells ?? []).map((c) => c.value);
                            for (const row of example.tableBody ?? []) {
                                const values = (row.cells ?? []).map((c) => c.value);
                                result.push({
                                    uri,
                                    feature: featureObj,
                                    location: s.location.line,
                                    keyword: s.keyword,
                                    name: interpolate(s.name, headers, values),
                                    description: s.description,
                                    tags: tags.map((t) => interpolate(t, headers, values)),
                                    steps: (s.steps ?? []).map((step) => ({
                                        keyword: step.keyword,
                                        keywordType: step.keywordType,
                                        text: interpolate(step.text, headers, values),
                                    })),
                                    ...(localBg ? { background: JSON.parse(JSON.stringify(localBg)) } : {}),
                                    ...(rule ? { rule } : {}),
                                });
                            }
                        }
                    }
                    else {
                        result.push({
                            uri,
                            feature: featureObj,
                            location: s.location.line,
                            keyword: s.keyword,
                            name: s.name,
                            description: s.description,
                            tags,
                            steps: (s.steps ?? []).map(toStep),
                            ...(localBg ? { background: JSON.parse(JSON.stringify(localBg)) } : {}),
                            ...(rule ? { rule } : {}),
                        });
                    }
                }
                if ("rule" in child && child.rule) {
                    const r = child.rule;
                    const ruleObj = {
                        keyword: r.keyword,
                        name: r.name,
                        description: r.description ?? '',
                    };
                    const ruleScenarios = processChildren(r.children ?? [], localBg, ruleObj);
                    if (ruleScenarios.length === 0) {
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
                            tags: [...(feature?.tags ?? []).map((t) => t.name)],
                            steps: [],
                            ...(localBg ? { background: JSON.parse(JSON.stringify(localBg)) } : {}),
                            rule: ruleObj
                        });
                    }
                    else {
                        result.push(...ruleScenarios);
                    }
                }
            }
            return result;
        };
        if (!feature)
            return [];
        return processChildren(feature.children ?? []);
    }
    content() {
        const featureFiles = this.find(this.dir);
        const scenarios = [];
        for (const file of featureFiles) {
            let content = (0, fs_1.readFileSync)(file, "utf-8");
            if (this.variables) {
                content = this.variables.applyToTemplate(content);
            }
            const parser = new gherkin_1.Parser(new gherkin_1.AstBuilder(messages_1.IdGenerator.uuid()), new gherkin_1.GherkinClassicTokenMatcher());
            const rawDoc = parser.parse(content);
            rawDoc.uri = (0, path_1.relative)(this.dir, file);
            scenarios.push(...this.format(rawDoc));
        }
        return scenarios;
    }
    dslFields(fields) {
        const keywordFields = new Map();
        const tagFields = new Map();
        for (const field of fields) {
            if (field.type === "keywords") {
                keywordFields.set(field.name.toLowerCase(), field);
            }
            if (field.type === "tags") {
                tagFields.set(field.name.toLowerCase(), field);
            }
        }
        return { keywordFields, tagFields };
    }
    compileIdentityMatcher(pattern) {
        if (!pattern)
            return null;
        const normalized = pattern.trim().replace(/^@/, "");
        if (normalized.includes("*")) {
            const parts = normalized.split('*');
            return { type: 'wildcard', prefix: parts[0], suffix: parts[1] || '' };
        }
        return { type: 'exact', value: normalized };
    }
    matchIdentity(tags, matcher) {
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
}
exports.BaseParser = BaseParser;
