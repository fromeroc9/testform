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
} from "../../types";
import { VariableParser } from "../variables";

export const FIELD_PATTERN = /^(?:field)\s+([A-Za-z0-9_.\- ]+?)\s*=\s*(.+)$/i;

export abstract class BaseParser {
    constructor(
        protected dir: string,
        protected variables?: VariableParser
    ) { }

    protected find(targetPath: string): string[] {
        try {
            const stat = statSync(targetPath);
            if (stat.isFile() && targetPath.endsWith('.feature')) {
                return [targetPath];
            }
            if (stat.isDirectory()) {
                const entries = readdirSync(targetPath, { withFileTypes: true });
                const result: string[] = [];
                for (const entry of entries) {
                    const filePath = join(targetPath, entry.name);
                    if (entry.isDirectory()) {
                        result.push(...this.find(filePath));
                    } else if (entry.name.endsWith('.feature')) {
                        result.push(filePath);
                    }
                }
                return result;
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    protected format(document: GherkinDocument): ParserScenario[] {
        const feature = document.feature;
        const uri = document.uri ?? "(unknown)";

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
                    const featureTags = (feature?.tags ?? []).map((t: any) => t.name);
                    const tags: string[] = [...featureTags, ...(s.tags ?? []).map((t: any) => t.name)];
                    const isUnique = tags.includes("@unique");
                    const hasTemplate = (s.name).includes("<") || (s.steps ?? []).some((st: Step) => (st.text).includes("<")) || tags.some((t) => t.includes("<"));

                    const featureObj: ParserFeature = {
                        tags: (feature?.tags ?? []).map((t: Tag) => t.name),
                        keyword: feature?.keyword ?? "",
                        name: feature?.name ?? "",
                        description: feature?.description ?? "",
                    };

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
                    } else {
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
                    const ruleObj: ParserRule = {
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
                            },
                            location: r.location.line,
                            keyword: r.keyword,
                            name: '*',
                            description: r.description,
                            tags: [...(feature?.tags ?? []).map((t: any) => t.name)],
                            steps: [],
                            ...(localBg ? { background: JSON.parse(JSON.stringify(localBg)) } : {}),
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

    public content(): ParserScenario[] {
        const featureFiles = this.find(this.dir);
        const scenarios: ParserScenario[] = [];

        for (const file of featureFiles) {
            let content = readFileSync(file, "utf-8");
            if (this.variables) {
                content = this.variables.applyToTemplate(content);
            }
            const parser = new Parse(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
            const rawDoc = parser.parse(content);
            rawDoc.uri = relative(this.dir, file);

            scenarios.push(...this.format(rawDoc));
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
