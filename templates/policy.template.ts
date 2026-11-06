import { PolicyDefinition, PolicyRule, IScope, ParserScenario } from '@fromeroc9/testform';

export const {{POLICY_VAR}}: PolicyDefinition = {
    id: "{{POLICY_ID}}",
    description: "Custom quality policy {{POLICY_ID}}",
    scope: ["testcase"],
    severity: "error",
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        for (const scenario of scenarios) {
            // Implement custom quality rules and validations
            // Push diagnostic violations to rules array:
            // rules.push({
            //     id: "{{POLICY_ID}}",
            //     type: 'error', // 'error' | 'warning' | 'advisory'
            //     title: "Rule violated summary",
            //     detail: "Specific explanation and actionable suggestion",
            //     uri: scenario.uri,
            //     scenario: scenario.name,
            //     line: scenario.location
            // });
        }
    }
};

export default {{POLICY_VAR}};
