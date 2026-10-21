import { readFileSync, writeFileSync } from 'fs';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { Document, Feature, Rule, Scenario, Step } from 'gherkin-ast';
import { format } from 'gherkin-formatter';

export class GherkinEditor {
    /**
     * Parse a feature file into a gherkin-ast Document
     */
    private static parseDocument(filePath: string): Document {
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
            // Insert status step at the beginning
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
            const parts = tc.split('::');
            if (parts.length >= 2 && parts[parts.length - 1] !== '*') {
                hasExplicit = true;
                break;
            }
        }

        if (hasExplicit) {
            this.removeWildcardScenario(document);
        }

        for (const tc of testcases) {
            const parts = tc.split('::');
            if (parts.length < 2) continue;
            
            const scenarioName = parts.pop()!;
            const ruleName = parts.pop()!;
            
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
