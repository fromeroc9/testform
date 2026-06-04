/**
 * @fileoverview Feature file writer.
 *
 * Provides utilities to declaratively modify .feature files locally,
 * such as updating the status of testcases.
 */

import { readFileSync, writeFileSync } from 'fs';
import { Parser } from './parser';
import { IScope, ParserScenario } from '../types';

/**
 * Modifies local .feature files to inject/update status values for testcases.
 * @param dir Workspace directory
 * @param scope Current scope
 * @param setStatusStr The raw string passed to --set-status, e.g., "tc1=passed,tc2=failed"
 */
export function writeStatusToFeatureFiles(dir: string, scope: IScope, setStatusStr: string) {
    if (!setStatusStr || scope !== 'testrun') return;

    // Parse status assignments: "tc1=passed,Rule::tc2=failed"
    const assignments = new Map<string, string>();
    for (const pair of setStatusStr.split(',')) {
        const [identity, status] = pair.split('=').map(s => s.trim());
        if (identity && status) {
            assignments.set(identity, status);
        }
    }

    if (assignments.size === 0) return;

    // Parse all files to find which file contains which scenario
    const parser = new Parser(dir);
    const documents = parser.content();
    
    // Group scenarios by file so we only read/write each file once
    const modificationsByFile = new Map<string, Array<{ line: number, status: string }>>();

    for (const scenario of documents) {
        if (!scenario.rule || !scenario.name) continue;
        
        const identity = `${scenario.rule.name}::${scenario.name}`;
        const identityShort = scenario.name; // In case the user passed just the scenario name

        let targetStatus: string | undefined = undefined;
        if (assignments.has(identity)) targetStatus = assignments.get(identity);
        else if (assignments.has(identityShort)) targetStatus = assignments.get(identityShort);

        if (targetStatus) {
            let fileMods = modificationsByFile.get(scenario.uri);
            if (!fileMods) {
                fileMods = [];
                modificationsByFile.set(scenario.uri, fileMods);
            }
            
            // We need to inject or replace the `* status = <status>` step in this scenario
            // The parser gives us the starting line of the scenario (1-indexed)
            fileMods.push({ line: scenario.location, status: targetStatus });
        }
    }

    // Now process each file
    for (const [uri, mods] of modificationsByFile.entries()) {
        try {
            const lines = readFileSync(uri, 'utf-8').split('\n');
            const newLines: string[] = [];

            for (let i = 0; i < lines.length; i++) {
                newLines.push(lines[i]);
                
                // If this line is the start of a matched scenario, we need to handle the status step
                const currentLineNum = i + 1; // 1-indexed
                const mod = mods.find(m => m.line === currentLineNum);
                
                if (mod) {
                    // Look ahead to find existing `* status = ...` step inside this scenario
                    // Scenario ends when we hit another Scenario, Rule, Background, or EOF
                    let existingStatusLineIdx = -1;
                    let j = i + 1;
                    
                    while (j < lines.length) {
                        const nextLine = lines[j].trim();
                        if (nextLine.startsWith('Scenario:') || nextLine.startsWith('Rule:') || nextLine.startsWith('Background:')) {
                            break;
                        }
                        if (nextLine.match(/^\*\s+status\s*=/i)) {
                            existingStatusLineIdx = j;
                            break;
                        }
                        j++;
                    }

                    if (existingStatusLineIdx !== -1) {
                        // Replace existing status
                        lines[existingStatusLineIdx] = `      * status = ${mod.status}`;
                    } else {
                        // Inject new status right after the Scenario line
                        newLines.push(`      * status = ${mod.status}`);
                    }
                }
            }

            writeFileSync(uri, newLines.join('\n'), 'utf-8');
            console.log(`Updated status in ${uri}`);
        } catch (e: any) {
            console.error(`Failed to update status in ${uri}: ${e.message}`);
        }
    }
}
