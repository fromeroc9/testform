import { readFileSync, writeFileSync } from 'fs';

export class GherkinEditor {
    /**
     * Expands or updates a single scenario's status inside a .feature file text.
     * This mutates the file on disk.
     */
    public static updateScenarioStatus(filePath: string, baseRule: string, scenarioName: string, newStatus: string) {
        let content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        let insideTargetRule = false;
        let insideTargetScenario = false;
        let scenarioStartIndex = -1;
        let ruleStartIndex = -1;
        let ruleEndIndex = lines.length;

        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const scenarioPattern = new RegExp(`^\\s*Scenario:\\s*${escapeRegex(scenarioName)}\\s*$`, 'i');
        const nextRulePattern = /^\s*Rule:/i;
        const statusFieldPattern = /^\s*\*\s*link\s+status\s*=\s*(.*)$/i;
        const generalRulePattern = /^\s*Rule:\s*(.+?)\s*$/i;

        // 1. Locate the target Rule block
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!insideTargetRule) {
                const match = generalRulePattern.exec(line);
                if (match) {
                    const ruleText = match[1].replace(/\.feature$/i, '');
                    const normalizedBaseRule = baseRule.replace(/\.feature$/i, '');
                    if (normalizedBaseRule.endsWith(ruleText) || normalizedBaseRule.includes(ruleText)) {
                        insideTargetRule = true;
                        ruleStartIndex = i;
                    }
                }
            } else {
                if (nextRulePattern.test(line)) {
                    ruleEndIndex = i;
                    break;
                }
            }
        }

        if (!insideTargetRule) {
            throw new Error(`Could not find Rule '${baseRule}' in ${filePath}`);
        }

        // 2. Locate the target Scenario block within the Rule
        let foundStatusField = false;
        for (let i = ruleStartIndex + 1; i < ruleEndIndex; i++) {
            const line = lines[i];
            
            if (!insideTargetScenario) {
                if (scenarioPattern.test(line)) {
                    insideTargetScenario = true;
                    scenarioStartIndex = i;
                }
            } else {
                // If we hit another Scenario or Rule, the current scenario block ends
                if (/^\s*(Scenario|Rule):/i.test(line)) {
                    break;
                }
                
                // If we find the link status field, replace it
                if (statusFieldPattern.test(line)) {
                    lines[i] = line.replace(/(^\s*\*\s*link\s+status\s*=\s*).*/i, `$1${newStatus}`);
                    foundStatusField = true;
                    break;
                }
            }
        }

        // 3. Inject if not found
        if (insideTargetScenario && !foundStatusField) {
            // Scenario exists, but no status field. Insert it right after the Scenario line.
            lines.splice(scenarioStartIndex + 1, 0, `    * link status = ${newStatus}`);
        } else if (!insideTargetScenario) {
            // Scenario doesn't exist under this Rule. Inject it at the end of the Rule block.
            // Find the last non-empty line of the rule block to maintain good spacing
            let insertAt = ruleEndIndex;
            while (insertAt > ruleStartIndex + 1 && lines[insertAt - 1].trim() === '') {
                insertAt--;
            }
            
            // Ensure there's a blank line before the new scenario if it's not immediately after the Rule
            if (insertAt > ruleStartIndex + 1 && lines[insertAt - 1].trim() !== '') {
                lines.splice(insertAt, 0, '');
                insertAt++;
            }
            
            lines.splice(insertAt, 0, `  Scenario: ${scenarioName}`, `    * link status = ${newStatus}`);
        }

        writeFileSync(filePath, lines.join('\n'), 'utf-8');
    }

    /**
     * Expands all implicit scenarios in a .feature file to be explicit.
     * @param filePath Path to the .feature file
     * @param testcases Array of testcases in "RuleName::ScenarioName" format
     * @param defaultStatus The default status to assign to newly expanded scenarios
     */
    public static expandScenarios(filePath: string, testcases: string[], defaultStatus: string = 'pending') {
        let hasExplicit = false;
        for (const tc of testcases) {
            const parts = tc.split('::');
            if (parts.length >= 2 && parts[parts.length - 1] !== '*') {
                hasExplicit = true;
                break;
            }
        }

        if (hasExplicit) {
            this.removeWildcardScenario(filePath);
        }

        for (const tc of testcases) {
            const parts = tc.split('::');
            if (parts.length < 2) continue;
            
            const scenarioName = parts.pop()!;
            const ruleName = parts.pop()!;
            
            if (hasExplicit && scenarioName === '*') continue;

            this.ensureScenarioExists(filePath, ruleName, scenarioName, defaultStatus);
        }
    }

    private static removeWildcardScenario(filePath: string) {
        let content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const newLines = [];
        let skip = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*Scenario:\s*\*\s*$/i.test(line)) {
                skip = true;
                continue;
            }
            if (skip && /^\s*(Scenario|Rule|Feature|Background):/i.test(line)) {
                skip = false;
            }
            if (!skip) {
                newLines.push(line);
            }
        }
        
        // Remove trailing empty lines that might have been left by removing the wildcard block
        while (newLines.length > 0 && newLines[newLines.length - 1].trim() === '') {
            newLines.pop();
        }
        
        writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    }

    private static ensureScenarioExists(filePath: string, baseRule: string, scenarioName: string, defaultStatus: string) {
        let content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        let insideTargetRule = false;
        let ruleStartIndex = -1;
        let ruleEndIndex = lines.length;

        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const scenarioPattern = new RegExp(`^\\s*Scenario:\\s*${escapeRegex(scenarioName)}\\s*$`, 'i');
        const nextRulePattern = /^\s*Rule:/i;
        const generalRulePattern = /^\s*Rule:\s*(.+?)\s*$/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!insideTargetRule) {
                const match = generalRulePattern.exec(line);
                if (match) {
                    const ruleText = match[1].replace(/\.feature$/i, '');
                    const normalizedBaseRule = baseRule.replace(/\.feature$/i, '');
                    if (normalizedBaseRule.endsWith(ruleText) || normalizedBaseRule.includes(ruleText)) {
                        insideTargetRule = true;
                        ruleStartIndex = i;
                    }
                }
            } else {
                if (nextRulePattern.test(line)) {
                    ruleEndIndex = i;
                    break;
                }
            }
        }

        if (!insideTargetRule) return;

        for (let i = ruleStartIndex + 1; i < ruleEndIndex; i++) {
            const line = lines[i];
            if (scenarioPattern.test(line)) {
                // Scenario already exists, do nothing
                return;
            }
        }

        // Inject at the end of the Rule
        let insertAt = ruleEndIndex;
        while (insertAt > ruleStartIndex + 1 && lines[insertAt - 1].trim() === '') {
            insertAt--;
        }
        
        if (insertAt > ruleStartIndex + 1 && lines[insertAt - 1].trim() !== '') {
            lines.splice(insertAt, 0, '');
            insertAt++;
        }
        
        lines.splice(insertAt, 0, `  Scenario: ${scenarioName}`, `    * link status = ${defaultStatus}`);
        writeFileSync(filePath, lines.join('\n'), 'utf-8');
    }
}
