import { logger } from "../logger";
import { notify } from "../notify";
import { IScope, ParserScenario, PolicyRule, PolicyAction, PolicyDefinition } from "../types";

class Policy {
    private builtinPolicies: Record<string, PolicyDefinition> = {};
    private userPolicies: Record<string, PolicyDefinition> = {};

    private resolve(scope: IScope): PolicyDefinition[] {
        const system = Object.values(this.builtinPolicies);
        const user = Object.values(this.userPolicies);
        return [...system, ...user].filter((policy) => policy.scope.includes(scope));
    }

    registry(policy: PolicyDefinition, type: 'system' | 'user' = 'system'): void {
        if (type === 'system') {
            this.builtinPolicies[policy.id] = policy;
        }

        if (type === 'user') {
            this.userPolicies[policy.id] = policy;
        }
    }

    scanner(scenarios: ParserScenario[], scope: IScope, isJson: boolean = false, compactWarnings: boolean = false) {
        const rules: PolicyRule[] = [];

        const activePolicies = this.resolve(scope);
        for (const policy of activePolicies) {
            try {
                policy.action(scenarios, rules, scope);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Unknown policy execution error";
                rules.push({
                    id: `policy-runtime-error:${policy.id}`,
                    title: `Policy "${policy.id}" failed during execution.`,
                    detail: message,
                    uri: "(policy-runtime)",
                });
            }
        }

        if (isJson) {
            if (rules.length > 0) {
                const data = {
                    valid: false,
                    error_count: rules.length,
                    warning_count: 0,
                    diagnostics: rules.map(r => ({
                        severity: r.type ?? 'error',
                        summary: r.title,
                        detail: r.detail
                    }))
                };
                console.log(JSON.stringify(data, null, 2));
                process.exit(1);
            }
            return;
        }

        if (rules.length > 0) {
            logger.info("Review the violations above and fix them before continuing.", { bold: true })
            logger.info(`${rules.length} policy violation${rules.length > 1 ? "s" : ""} found:\n`, { bold: true });
        }

        let warningsCount = 0;

        for (const violation of rules) {
            const isWarning = violation.type === 'warning';
            if (isWarning) warningsCount++;

            if (isWarning && compactWarnings) continue;

            let locationStr = `on ${violation.uri}`;
            if (violation.line !== undefined) locationStr += ` line ${violation.line}`;
            if (violation.scenario) locationStr += `, in scenario "${violation.scenario}"`;

            notify.push({
                type: violation.type ?? 'error',
                title: violation.title,
                detail: [
                    violation.detail,
                    locationStr
                ]
            })
        }

        if (warningsCount > 0 && compactWarnings) {
            logger.warn(`\n${warningsCount} warning(s) found. (Details suppressed by -compact-warnings)`);
        }

        return rules.length > 0;
    }
}


export const policy = new Policy();
export const registerPolicy = (policyDefinition: PolicyDefinition) => policy.registry(policyDefinition, 'user')

policy.registry({
    id: "undeclared-fields",
    scope: ["testcase"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        for (const scenario of scenarios) {
            for (const v of scenario.custom?.policy?.filter(v => v.type === 'undeclared-field') ?? []) {
                rules.push({
                    id: "undeclared-field",
                    type: 'warning',
                    title: `Value for undeclared field "${v.field}"`,
                    detail: `Field "${v.field}" is not declared in the configuration. Add a "fields" entry to your config.`,
                    uri: scenario.uri,
                    scenario: scenario.name,
                    line: scenario.location,
                });
            }
        }
    }
})

policy.registry({
    id: "required-fields",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        for (const scenario of scenarios) {
            for (const v of scenario.custom?.policy?.filter(v => v.type === 'required-field') ?? []) {
                rules.push({
                    id: "required-field-missing",
                    title: `Required field "${v.field}" is missing`,
                    detail: `Add a step: "field ${v.field} = <value>" to the scenario.`,
                    uri: scenario.uri,
                    scenario: scenario.name,
                    line: scenario.location,
                });
            }
        }
    }
})

policy.registry({
    id: "required-gherkin",
    scope: ["testcase"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        const validKeywords = ["scenario", "scenario outline"];

        for (const scenario of scenarios) {
            // Check: Feature name is required
            if (!scenario.feature.name || scenario.feature.name.trim() === "") {
                rules.push({
                    id: "feature-name-required",
                    title: "Feature name is required",
                    detail: "Every feature must have a name. Add a descriptive name after 'Feature'.",
                    uri: scenario.uri,
                    line: scenario.location
                })
            }

            // Check: Scenario name is required
            if (!scenario.name || scenario.name.trim() === "") {
                rules.push({
                    id: "scenario-name-required",
                    title: "Scenario name is required",
                    detail: "Every scenario must have a name. Add a descriptive name after 'Scenario:' or 'Scenario Outline:'.",
                    uri: scenario.uri,
                    line: scenario.location,
                });
                continue;
            }

            // Check: Valid keyword (Scenario or Scenario Outline)
            if (!validKeywords.includes(scenario.keyword.trim().toLowerCase())) continue;

            // Check: Required steps (Given, When, Then)
            const allSteps = [
                ...(scenario.background?.steps ?? []),
                ...scenario.steps,
            ];

            const missing: string[] = [];
            if (!allSteps.some(s => s.keyword.trim().toLowerCase() === "given")) missing.push("Given");
            if (!allSteps.some(s => s.keyword.trim().toLowerCase() === "when")) missing.push("When");
            if (!allSteps.some(s => s.keyword.trim().toLowerCase() === "then")) missing.push("Then");

            if (missing.length > 0) {
                rules.push({
                    id: "steps-required",
                    title: `Scenario is missing required step types: ${missing.join(", ")}.`,
                    detail: "Each scenario must have at least one Given, When, and Then step.",
                    uri: scenario.uri,
                    scenario: scenario.name,
                    line: scenario.location,
                });
            }
        }
    }
})

policy.registry({
    id: "no-feature-tags",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        const allowedTags = ["@testcase", "@testrun", "@testplan"];
        const expectedTag = `@${scope}`;
        const seen = new Set<string>();

        for (const scenario of scenarios) {
            const uri = scenario.uri ?? "(unknown)";
            if (seen.has(uri)) continue;
            seen.add(uri);

            const featureTags = scenario.feature?.tags ?? [];
            const invalidTags = featureTags.filter(tag => !allowedTags.includes(tag.toLowerCase()));

            if (invalidTags.length > 0) {
                rules.push({
                    id: "no-feature-tags",
                    title: `Feature-level tags are not allowed in ${uri} scope (found: ${invalidTags.join(", ")}).`,
                    detail: "Move any tags from Feature: to the individual Scenario level, except for @testcase, @testrun, @testplan.",
                    uri,
                });
            }

            const declaredScopeTags = featureTags.filter(tag => allowedTags.includes(tag.toLowerCase()));
            for (const tag of declaredScopeTags) {
                if (tag.toLowerCase() !== expectedTag) {
                    rules.push({
                        id: "invalid-scope-tag",
                        title: `Mismatched scope: file is tagged as ${tag} but is being processed as ${expectedTag}.`,
                        detail: `A feature file designed for ${tag} cannot be executed in --scope ${scope}.`,
                        uri,
                    });
                }
            }
        }
    }
})

policy.registry({
    id: "identity-required",
    scope: ["testcase"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        for (const scenario of scenarios ?? []) {
            const identity = scenario.custom?.identity;
            if (!identity || identity.trim() === "") {
                rules.push({
                    id: "identity-required",
                    title: "Every scenario must have an identity tag matching the configured identity pattern.",
                    detail: "Add the identity tag (e.g. @tc-1) to each scenario.",
                    uri: scenario.uri ?? "(unknown)",
                    scenario: scenario.name,
                    line: scenario.location,
                });
            }
        }
    }
})

policy.registry({
    id: "identity-unique",
    scope: ["testcase"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        const byFeature = new Map<string, ParserScenario[]>();

        for (const scenario of scenarios) {
            const uri = scenario.uri;
            const group = byFeature.get(uri);
            if (group) {
                group.push(scenario);
            } else {
                byFeature.set(uri, [scenario]);
            }
        }

        for (const [uri, featureScenarios] of byFeature) {
            const seen = new Map<string, { scenario: string; line?: number; keyword: string }[]>();

            for (const scenario of featureScenarios) {
                const identity = scenario.custom?.identity?.trim();
                if (!identity) continue;

                const entry = { scenario: scenario.name, line: scenario.location, keyword: scenario.keyword || '' };
                const existing = seen.get(identity);
                if (existing) {
                    existing.push(entry);
                } else {
                    seen.set(identity, [entry]);
                }
            }

            for (const [identity, entries] of seen) {
                if (entries.length <= 1) continue;

                const allSameOutline =
                    entries.every((e) => (e.keyword || '').trim() === "Scenario Outline") &&
                    entries.every((e) => e.line === entries[0].line);

                if (allSameOutline) {
                    rules.push({
                        id: "unique-key-required",
                        title: `Scenario Outline expanded ${entries.length} rows but all share the same identity "${identity}".`,
                        detail: "Add a <key> inside the identity tag (e.g. @tc-<key>) so each expanded row has a unique identity.",
                        uri,
                        scenario: entries[0].scenario,
                        line: entries[0].line,
                    });
                    continue;
                }

                for (const entry of entries) {
                    rules.push({
                        id: "identity-unique",
                        title: `Duplicate identity "${identity}" found in ${entries.length} scenarios.`,
                        detail: "Each scenario must have a unique identity tag.",
                        uri,
                        scenario: entry.scenario,
                        line: entry.line,
                    });
                }
            }
        }
    }
})