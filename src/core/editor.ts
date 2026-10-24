import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { Document, Feature, Rule, Scenario, Step } from 'gherkin-ast';
import { format } from 'gherkin-formatter';

export class GherkinEditor {
    // ─── File Discovery ──────────────────────────────────────────────────────────

    /**
     * Recursively or shallowly searches a path for `.feature` files,
     * ignoring `node_modules` and hidden directories (`.git`, etc.).
     */
    public static findFeatureFiles(targetPath: string, recursive: boolean = true): string[] {
        try {
            const stat = statSync(targetPath);
            if (stat.isFile() && targetPath.endsWith('.feature')) {
                return [targetPath];
            }
            if (stat.isDirectory()) {
                if (targetPath.includes('node_modules') || targetPath.includes('.git')) return [];

                const entries = readdirSync(targetPath, { withFileTypes: true });
                const result: string[] = [];
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    const filePath = join(targetPath, entry.name);
                    if (entry.isDirectory()) {
                        if (recursive) {
                            result.push(...this.findFeatureFiles(filePath, recursive));
                        }
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

    /**
     * Inspects all feature files in a directory to find the highest existing identity index
     * for a given pattern (e.g. `@tc-*`), returning the next incremented identity tag.
     */
    public static findNextIdentity(dirPath: string, pattern: string): string | null {
        if (!pattern.includes('*')) return null;

        const prefix = pattern.split('*')[0].replace(/^@/, '');
        const suffix = pattern.split('*')[1] || '';

        const regex = new RegExp(`@${prefix}(\\d+)${suffix}\\b`, 'g');
        let max = 0;

        const allFeatures = this.findFeatureFiles(dirPath, true);
        for (const file of allFeatures) {
            const content = readFileSync(file, 'utf-8');
            let match;
            while ((match = regex.exec(content)) !== null) {
                const num = parseInt(match[1], 10);
                if (num > max) max = num;
            }
        }

        return `@${prefix}${max + 1}${suffix}`;
    }

    // ─── Formatting ──────────────────────────────────────────────────────────────

    /**
     * Formats Gherkin content according to standard indentation and spacing rules.
     */
    public static formatGherkin(content: string): string {
        const lines = content.split('\n');
        const output: string[] = [];

        let expectedIndent = 0;
        let inDocString = false;
        let docStringIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Handle docstrings
            if (line.trim().startsWith('"""') || line.trim().startsWith('```')) {
                if (!inDocString) {
                    inDocString = true;
                    docStringIndent = 6;
                    output.push(' '.repeat(docStringIndent) + line.trim());
                } else {
                    inDocString = false;
                    output.push(' '.repeat(docStringIndent) + line.trim());
                }
                continue;
            }

            if (inDocString) {
                output.push(line);
                continue;
            }

            let trimmed = line.trim();

            if (trimmed === '') {
                if (output.length > 0 && output[output.length - 1] !== '') {
                    output.push('');
                }
                continue;
            }

            // Determine indentation based on keyword
            if (trimmed.startsWith('Feature:')) {
                expectedIndent = 0;
            } else if (trimmed.startsWith('Rule:') || trimmed.startsWith('Background:') || trimmed.startsWith('Scenario:') || trimmed.startsWith('Scenario Outline:') || trimmed.startsWith('Example:')) {
                expectedIndent = 2;
                if (output.length > 0 && output[output.length - 1] !== '' && !output[output.length - 1].trim().startsWith('@')) {
                    output.push('');
                }
            } else if (trimmed.startsWith('Given ') || trimmed.startsWith('When ') || trimmed.startsWith('Then ') || trimmed.startsWith('And ') || trimmed.startsWith('But ') || trimmed.startsWith('* ')) {
                expectedIndent = 4;
            } else if (trimmed.startsWith('Examples:')) {
                expectedIndent = 4;
                if (output.length > 0 && output[output.length - 1] !== '') {
                    output.push('');
                }
            } else if (trimmed.startsWith('|')) {
                expectedIndent = 6;
            } else if (trimmed.startsWith('@')) {
                let nextIndent = 0;
                for (let j = i + 1; j < lines.length; j++) {
                    let nextTrimmed = lines[j].trim();
                    if (nextTrimmed === '' || nextTrimmed.startsWith('@')) continue;
                    if (nextTrimmed.startsWith('Feature:')) nextIndent = 0;
                    else if (nextTrimmed.startsWith('Rule:') || nextTrimmed.startsWith('Background:') || nextTrimmed.startsWith('Scenario:') || nextTrimmed.startsWith('Scenario Outline:')) nextIndent = 2;
                    else if (nextTrimmed.startsWith('Examples:')) nextIndent = 4;
                    break;
                }
                expectedIndent = nextIndent;

                if (output.length > 0 && output[output.length - 1] !== '') {
                    output.push('');
                }
            } else if (trimmed.startsWith('#')) {
                // Comments preserve expected indent
            } else {
                if (expectedIndent === 0) expectedIndent = 2;
            }

            output.push(' '.repeat(expectedIndent) + trimmed);
        }

        if (output.length > 0 && output[output.length - 1] !== '') {
            output.push('');
        }

        return output.join('\n');
    }

    // ─── Scenario Title & Tags Update ────────────────────────────────────────────

    /**
     * Updates a scenario's title and/or tags in a feature file.
     */
    public static updateScenarioTitleAndTags(
        filePath: string,
        oldTitle: string,
        newTitle: string,
        newLabels?: string[]
    ): boolean {
        if (!existsSync(filePath)) return false;
        let content = readFileSync(filePath, 'utf8');

        // 1. Update Scenario title if changed
        if (oldTitle && newTitle && oldTitle !== newTitle) {
            const escapedOld = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const scenarioRegex = new RegExp(`(Scenario(?: Outline)?:\\s*)${escapedOld}`, 'g');
            if (scenarioRegex.test(content)) {
                content = content.replace(scenarioRegex, `$1${newTitle}`);
            }
        }

        // 2. Update labels if provided
        if (newLabels && newLabels.length > 0) {
            const searchTitle = newTitle || oldTitle;
            const scenarioIdx = content.indexOf(`Scenario: ${searchTitle}`);
            if (scenarioIdx !== -1) {
                const beforeScenario = content.slice(0, scenarioIdx);
                const lines = beforeScenario.split('\n');
                const prevLine = lines[lines.length - 2]?.trim();
                const formattedTags = newLabels.map(l => l.startsWith('@') ? l : `@${l}`).join(' ');

                if (prevLine && prevLine.startsWith('@')) {
                    lines[lines.length - 2] = `  ${formattedTags}`;
                    content = lines.join('\n') + content.slice(scenarioIdx);
                } else {
                    content = content.slice(0, scenarioIdx) + `  ${formattedTags}\n` + content.slice(scenarioIdx);
                }
            }
        }

        writeFileSync(filePath, content, 'utf8');
        return true;
    }

    // ─── AST Document Parsing & Saving ───────────────────────────────────────────

    /**
     * Parses a .feature file path or raw Gherkin text into a raw Cucumber GherkinDocument AST.
     */
    public static parseRawDocument(filePathOrContent: string) {
        const content = existsSync(filePathOrContent)
            ? readFileSync(filePathOrContent, 'utf-8')
            : filePathOrContent;
        const builder = new AstBuilder(IdGenerator.uuid());
        const parser = new Parser(builder, new GherkinClassicTokenMatcher());
        const doc = parser.parse(content);
        if (existsSync(filePathOrContent)) {
            doc.uri = filePathOrContent;
        }
        return doc;
    }

    /**
     * Parse a feature file into a gherkin-ast Document
     */
    public static parseDocument(filePath: string): Document {
        const content = readFileSync(filePath, 'utf-8');
        const builder = new AstBuilder(IdGenerator.uuid());
        const parser = new Parser(builder, new GherkinClassicTokenMatcher());
        const gherkinDocument = parser.parse(content);
        gherkinDocument.uri = filePath;

        return Document.parse({ gherkinDocument: gherkinDocument as any });
    }

    /**
     * Save a gherkin-ast Document back to the file system
     */
    private static saveDocument(filePath: string, document: Document) {
        const formatted = format(document);
        writeFileSync(filePath, formatted, 'utf-8');
    }

    /**
     * Find a rule within a feature by matching the baseRule string
     */
    private static findRule(feature: Feature, baseRule: string): Rule | undefined {
        const normalizedBaseRule = baseRule.replace(/\.feature$/i, '');
        return feature.elements.find(element => {
            if (element instanceof Rule) {
                const ruleText = element.name.replace(/\.feature$/i, '');
                return normalizedBaseRule.endsWith(ruleText) || normalizedBaseRule.includes(ruleText) ||
                       ruleText.endsWith(normalizedBaseRule) || ruleText.includes(normalizedBaseRule);
            }
            return false;
        }) as Rule | undefined;
    }

    /**
     * Expands or updates a single scenario's status inside a .feature file.
     */
    public static updateScenarioStatus(filePath: string, baseRule: string, scenarioName: string, newStatus: string) {
        const document = this.parseDocument(filePath);
        if (!document.feature) {
            throw new Error(`File ${filePath} has no feature definition.`);
        }

        const rule = this.findRule(document.feature, baseRule);
        if (!rule) {
            throw new Error(`Could not find Rule '${baseRule}' in ${filePath}`);
        }

        let targetScenario: Scenario | undefined;

        // Find existing scenario
        for (const element of rule.elements) {
            if (element instanceof Scenario) {
                if (
                    element.name === scenarioName ||
                    element.name.replace(/^@/, '') === scenarioName.replace(/^@/, '')
                ) {
                    targetScenario = element;
                    break;
                }
            }
        }

        if (!targetScenario) {
            throw new Error(`Scenario '${scenarioName}' is not expanded in Rule '${baseRule}'. Run 'testform suite fill' first to expand the rule's scenarios before marking status.`);
        }

        // Update existing status step
        let statusStep = targetScenario.steps.find(step =>
            step.keyword.trim() === '*' && step.text.startsWith('mark status =')
        );

        if (statusStep) {
            statusStep.text = `mark status = ${newStatus}`;
        } else {
            const newStep = new Step('*', `mark status = ${newStatus}`);
            targetScenario.steps.unshift(newStep);
        }

        this.saveDocument(filePath, document);
    }

    /**
     * Adds or links a Rule or Scenario into a .run.feature or .plan.feature file.
     * Supports both testrun and testplan scopes:
     * - Implicit link: Adds Rule: <ruleName>
     * - Explicit link: Adds Rule: <ruleName> + Scenario: <scenarioName> (* link status = <status>)
     */
    public static linkRuleOrScenario(
        filePath: string,
        ruleName: string,
        scenarioName?: string,
        status: string = 'pending'
    ): { addedRule: boolean; addedScenario: boolean; updatedScenario: boolean } {
        const document = this.parseDocument(filePath);
        if (!document.feature) {
            throw new Error(`File ${filePath} has no feature definition.`);
        }

        let rule = this.findRule(document.feature, ruleName);
        let addedRule = false;
        let addedScenario = false;
        let updatedScenario = false;

        if (!rule) {
            rule = new Rule('Rule', ruleName, '');
            document.feature.elements.push(rule);
            addedRule = true;
        }

        if (scenarioName) {
            let targetScenario: Scenario | undefined;
            for (const element of rule.elements) {
                if (element instanceof Scenario) {
                    if (
                        element.name === scenarioName ||
                        element.name.replace(/^@/, '') === scenarioName.replace(/^@/, '')
                    ) {
                        targetScenario = element;
                        break;
                    }
                }
            }

            if (targetScenario) {
                let statusStep = targetScenario.steps.find(step =>
                    step.keyword.trim() === '*' && step.text.startsWith('mark status =')
                );
                if (statusStep) {
                    statusStep.text = `mark status = ${status}`;
                } else {
                    targetScenario.steps.unshift(new Step('*', `mark status = ${status}`));
                }
                updatedScenario = true;
            } else {
                const newScenario = new Scenario('Scenario', scenarioName, '');
                newScenario.steps.push(new Step('*', `mark status = ${status}`));
                rule.elements.push(newScenario);
                addedScenario = true;
            }
        }

        this.saveDocument(filePath, document);
        return { addedRule, addedScenario, updatedScenario };
    }

    /**
     * Expands all implicit scenarios in a .feature file to be explicit.
     */
    public static expandScenarios(filePath: string, testcases: string[], defaultStatus: string = 'pending') {
        const document = this.parseDocument(filePath);
        if (!document.feature) return;

        let hasExplicit = false;
        for (const tc of testcases) {
            const parts = tc.split('.');
            if (parts.length >= 2 && parts[parts.length - 1] !== '*') {
                hasExplicit = true;
                break;
            }
        }

        if (hasExplicit) {
            this.removeWildcardScenario(document);
        }

        for (const tc of testcases) {
            const parts = tc.split('.');
            if (parts.length < 2) continue;

            const scenarioName = parts.pop()!;
            const ruleName = parts.join('.');

            if (hasExplicit && scenarioName === '*') continue;

            const rule = this.findRule(document.feature, ruleName);
            if (rule) {
                let scenarioExists = rule.elements.some(element =>
                    element instanceof Scenario && element.name === scenarioName
                );

                if (!scenarioExists) {
                    const newScenario = new Scenario('Scenario', scenarioName, '');
                    newScenario.steps.push(new Step('*', `mark status = ${defaultStatus}`));
                    rule.elements.push(newScenario);
                }
            }
        }

        this.saveDocument(filePath, document);
    }

    private static removeWildcardScenario(document: Document) {
        if (!document.feature) return;

        for (const element of document.feature.elements) {
            if (element instanceof Rule) {
                element.elements = element.elements.filter(child => {
                    if (child instanceof Scenario && child.name.trim() === '*') {
                        return false;
                    }
                    return true;
                });
            }
        }
    }
}

// ─── Exported Function Aliases ────────────────────────────────────────────────
export const findFeatureFiles = GherkinEditor.findFeatureFiles.bind(GherkinEditor);
export const findNextIdentity = GherkinEditor.findNextIdentity.bind(GherkinEditor);
export const formatGherkin = GherkinEditor.formatGherkin.bind(GherkinEditor);
export const updateFeatureScenario = GherkinEditor.updateScenarioTitleAndTags.bind(GherkinEditor);
export const parseRawDocument = GherkinEditor.parseRawDocument.bind(GherkinEditor);
