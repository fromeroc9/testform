/**
 * @fileoverview Testrun parser.
 *
 * Extracts testrun data by grouping all scenarios in a file into a single
 * aggregate scenario. Also extracts embedded testcase links from Rules.
 */

import { TestcaseParser } from './testcase-parser';
import { ITest, IScope, ParserScenario } from '../core/types';

export class TestrunParser extends TestcaseParser {
    public filter(scenarios: ParserScenario[], test: ITest, scope?: IScope): ParserScenario[] {
        // First, apply standard DSL field extraction
        const filtered = super.filter(scenarios, test, scope);

        // Group by URI (1 feature file = 1 testrun)
        const groups: Record<string, ParserScenario[]> = {};
        for (const s of filtered) {
            (groups[s.uri] ??= []).push(s);
        }

        // Transform each group into a single run scenario
        return Object.entries(groups).map(([uri, groupScenarios]) => {
            const aggregated = JSON.parse(JSON.stringify(groupScenarios[0])) as ParserScenario;
            aggregated.custom ??= {};
            // If the base parser extracted an identity from tags, preserve it, otherwise fallback to uri
            const firstScenarioWithIdentity = groupScenarios.find(s => s.custom && s.custom.identity);
            if (firstScenarioWithIdentity && firstScenarioWithIdentity.custom?.identity) {
                aggregated.custom.identity = firstScenarioWithIdentity.custom.identity;
            } else {
                aggregated.custom.identity = uri;
            }

            // Extract all testcases belonging to this run
            // Format: "RuleName::ScenarioName"
            aggregated.custom.testcases = groupScenarios
                .filter(e => e.rule && e.name)
                .map(e => `${e.rule?.name}::${e.name}`);

            // Also keep the raw group scenarios so we can extract their status fields later
            aggregated.custom.groupScenarios = groupScenarios;

            return aggregated;
        });
    }
}
