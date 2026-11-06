import { IScope, ParserScenario } from '../core/types';
import { PolicyDefinition, PolicyRule } from './types';

export const BUILTIN_POLICIES: PolicyDefinition[] = [
    {
        id: "undeclared-fields",
        description: "Warns about scenario fields not declared in configuration",
        scope: ["testcase", "bug"],
        severity: "warning",
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
    },
    {
        id: "required-fields",
        description: "Ensures required fields defined in configuration are present",
        scope: ["testcase", "testrun", "testplan", "bug"],
        severity: "error",
        action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
            for (const scenario of scenarios) {
                for (const v of scenario.custom?.policy?.filter(v => v.type === 'required-field') ?? []) {
                    rules.push({
                        id: "required-field-missing",
                        type: 'error',
                        title: `Required field "${v.field}" is missing`,
                        detail: `Add a step: "field ${v.field} = <value>" to the scenario.`,
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location,
                    });
                }
            }
        }
    },
    {
        id: "required-gherkin",
        description: "Validates required Gherkin structure and keywords (Given, When, Then)",
        scope: ["testcase"],
        severity: "error",
        action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
            const validKeywords = ["scenario", "scenario outline"];

            for (const scenario of scenarios) {
                // Check: Feature name is required
                if (!scenario.feature.name || scenario.feature.name.trim() === "") {
                    rules.push({
                        id: "feature-name-required",
                        type: 'error',
                        title: "Feature name is required",
                        detail: "Every feature must have a name. Add a descriptive name after 'Feature'.",
                        uri: scenario.uri,
                        line: scenario.location
                    });
                }

                // Check: Scenario name is required
                if (!scenario.name || scenario.name.trim() === "") {
                    rules.push({
                        id: "scenario-name-required",
                        type: 'error',
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
                        type: 'error',
                        title: `Scenario is missing required step types: ${missing.join(", ")}.`,
                        detail: "Each scenario must have at least one Given, When, and Then step.",
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location,
                    });
                }
            }
        }
    },
    {
        id: "no-feature-tags",
        description: "Restricts non-standard tags at the Feature level",
        scope: ["testcase", "testrun", "testplan", "bug"],
        severity: "error",
        action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
            const expectedTag = `@${scope}`;
            const seen = new Set<string>();

            for (const scenario of scenarios) {
                const uri = scenario.uri ?? "(unknown)";
                if (seen.has(uri)) continue;
                seen.add(uri);

                const allowedScopeTags = ["@testcase", "@testrun", "@testplan", "@bug"];
                const allowedFeatureTags = [...allowedScopeTags];
                if (scenario.custom?.identity) {
                    allowedFeatureTags.push(scenario.custom.identity.toLowerCase());
                }

                const featureTags = scenario.feature?.tags ?? [];
                const invalidTags = featureTags.filter(tag => !allowedFeatureTags.includes(tag.toLowerCase()));

                if (invalidTags.length > 0) {
                    rules.push({
                        id: "no-feature-tags",
                        type: 'error',
                        title: `Feature-level tags are not allowed in ${uri} scope (found: ${invalidTags.join(", ")}).`,
                        detail: "Move any tags from Feature: to the individual Scenario level, except for scope tags and identity tags.",
                        uri,
                    });
                }

                const declaredScopeTags = featureTags.filter(tag => allowedScopeTags.includes(tag.toLowerCase()));
                for (const tag of declaredScopeTags) {
                    if (tag.toLowerCase() !== expectedTag) {
                        rules.push({
                            id: "invalid-scope-tag",
                            type: 'error',
                            title: `Mismatched scope: file is tagged as ${tag} but is being processed as ${expectedTag}.`,
                            detail: `A feature file designed for ${tag} cannot be executed in -scope ${scope}.`,
                            uri,
                        });
                    }
                }
            }
        }
    },
    {
        id: "identity-required",
        description: "Enforces identity tags (@tc-X, @tr-X, @tp-X, @bg-X)",
        scope: ["testcase", "testrun", "testplan", "bug"],
        severity: "error",
        action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
            for (const scenario of scenarios ?? []) {
                const identity = scenario.custom?.identity;

                if (!identity || identity.trim() === "" || identity === scenario.uri) {
                    const isScenarioLevel = scope === 'testcase' || scope === 'bug';
                    const sampleTag = scope === 'testcase' ? '@tc-1' : scope === 'bug' ? '@bg-1' : scope === 'testrun' ? '@tr-1' : '@tp-1';

                    rules.push({
                        id: "identity-required",
                        type: 'error',
                        title: isScenarioLevel
                            ? "Every scenario must have an identity tag matching the configured identity pattern."
                            : "Every feature must have an identity tag matching the configured identity pattern.",
                        detail: isScenarioLevel
                            ? `Add the identity tag (e.g. ${sampleTag}) to each scenario.`
                            : `Add the identity tag (e.g. ${sampleTag}) to the Feature level.`,
                        uri: scenario.uri ?? "(unknown)",
                        scenario: isScenarioLevel ? scenario.name : undefined,
                        line: isScenarioLevel ? scenario.location : (scenario.feature?.location ?? scenario.location),
                    });
                    continue;
                }

                if (scope === 'testrun' || scope === 'testplan') {
                    const featureTags = scenario.feature?.tags ?? [];
                    const hasFeatureTag = featureTags.some(t => t.toLowerCase() === identity.toLowerCase());

                    if (!hasFeatureTag) {
                        rules.push({
                            id: "identity-feature-level-required",
                            type: 'error',
                            title: `The identity tag ${identity} must be declared at the Feature level.`,
                            detail: `Move the identity tag ${identity} so it is placed next to the @${scope} tag before the 'Feature:' keyword.`,
                            uri: scenario.uri ?? "(unknown)",
                            line: scenario.feature?.location ?? scenario.location,
                        });
                    }
                }
            }
        }
    },
    {
        id: "identity-unique",
        description: "Verifies identity tag uniqueness within scope",
        scope: ["testcase", "testrun", "testplan", "bug"],
        severity: "error",
        action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
            const seen = new Map<string, { scenario: string; line?: number; keyword: string; uri: string }[]>();

            for (const scenario of scenarios) {
                const identity = scenario.custom?.identity?.trim();
                if (!identity) continue;

                // Ignore if the identity is just the uri fallback
                if (identity === scenario.uri) continue;

                const entry = { scenario: scenario.name, line: scenario.location, keyword: scenario.keyword || '', uri: scenario.uri || '' };

                // For testcase and bug, identities only need to be unique within the same file.
                // For testrun/testplan, identities must be globally unique across all files.
                const isLocalScope = scope === 'testcase' || scope === 'bug';
                const uniquenessKey = isLocalScope ? `${scenario.uri}.${identity}` : identity;

                const existing = seen.get(uniquenessKey);
                if (existing) {
                    existing.push(entry);
                } else {
                    seen.set(uniquenessKey, [entry]);
                }
            }

            for (const [key, entries] of seen) {
                if (entries.length <= 1) continue;

                const lastDot = key.lastIndexOf('.');
                const identity = lastDot !== -1 ? key.slice(lastDot + 1) : key;

                const allSameOutline =
                    entries.every((e) => (e.keyword || '').trim() === "Scenario Outline") &&
                    entries.every((e) => e.line === entries[0].line && e.uri === entries[0].uri);

                if (allSameOutline) {
                    rules.push({
                        id: "unique-key-required",
                        type: 'error',
                        title: `Scenario Outline expanded ${entries.length} rows but all share the same identity "${identity}".`,
                        detail: "Add a <key> inside the identity tag (e.g. @tc-<key>) so each expanded row has a unique identity.",
                        uri: entries[0].uri,
                        scenario: entries[0].scenario,
                        line: entries[0].line,
                    });
                    continue;
                }

                for (const entry of entries) {
                    let suggestion = "";
                    const match = identity.match(/^(@[a-zA-Z0-9-]+?)-?(\d+)(.*)$/);
                    if (match) {
                        const prefix = match[1] + (identity.includes('-') ? '-' : '');
                        const suffix = match[3];
                        let max = 0;

                        const isLocalScope = scope === 'testcase' || scope === 'bug';
                        for (const s of scenarios) {
                            if (isLocalScope && s.uri !== entry.uri) continue;

                            const id = s.custom?.identity?.trim();
                            if (id && id !== s.uri) {
                                const m = id.match(new RegExp(`^${prefix}(\\d+)${suffix}$`));
                                if (m) {
                                    const num = parseInt(m[1], 10);
                                    if (num > max) max = num;
                                }
                            }
                        }
                        if (max > 0) {
                            suggestion = ` The next available identity ${isLocalScope ? 'in this file ' : ''}is ${prefix}${max + 1}${suffix}.`;
                        }
                    }

                    const isLocalScope = scope === 'testcase' || scope === 'bug';
                    rules.push({
                        id: "identity-unique",
                        type: 'error',
                        title: isLocalScope
                            ? `Duplicate identity "${identity}" found in the same file.`
                            : `Duplicate identity "${identity}" found.`,
                        detail: (isLocalScope
                            ? "Each scenario within a file must have a unique identity tag."
                            : "Each element must have a globally unique identity tag in the workspace.") + suggestion,
                        uri: entry.uri,
                        scenario: entry.scenario,
                        line: entry.line,
                    });
                }
            }
        }
    },
    {
        id: "duplicate-testruns-in-testplan",
        description: "Prevents duplicate testruns inside the same or across testplans",
        scope: ["testplan"],
        severity: "error",
        action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
            const globalSeen = new Map<string, { uri: string; scenario: string; line: number }[]>();

            for (const scenario of scenarios) {
                const testruns = scenario.custom?.testruns || [];
                const seenInFile = new Set<string>();
                const fileDuplicates = new Set<string>();

                for (const tr of testruns) {
                    if (seenInFile.has(tr)) {
                        fileDuplicates.add(tr);
                    } else {
                        seenInFile.add(tr);
                    }

                    const trKey = tr.trim();
                    const info = { uri: scenario.uri, scenario: scenario.name, line: scenario.location };
                    if (!globalSeen.has(trKey)) {
                        globalSeen.set(trKey, []);
                    }
                    globalSeen.get(trKey)!.push(info);
                }

                if (fileDuplicates.size > 0) {
                    rules.push({
                        id: "duplicate-testruns-in-testplan",
                        type: 'error',
                        title: `Duplicate testruns defined in the same testplan: ${Array.from(fileDuplicates).join(", ")}`,
                        detail: `Remove the duplicate Rule declarations from this testplan.`,
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location,
                    });
                }
            }

            for (const [tr, occurrences] of globalSeen) {
                if (occurrences.length > 1) {
                    const distinctUris = new Set(occurrences.map(o => o.uri));
                    if (distinctUris.size > 1) {
                        for (const occ of occurrences) {
                            const otherFiles = Array.from(distinctUris).filter(u => u !== occ.uri);
                            rules.push({
                                id: "duplicate-testruns-across-testplans",
                                type: 'error',
                                title: `Testrun "${tr}" is declared in multiple testplans`,
                                detail: `This testrun is also declared in: ${otherFiles.join(", ")}. A testrun should only belong to one testplan.`,
                                uri: occ.uri,
                                scenario: occ.scenario,
                                line: occ.line,
                            });
                        }
                    }
                }
            }
        }
    },
    {
        id: "bug-target-integrity",
        description: "Ensures bug scenarios declare a target scenario, run, or failure trace",
        scope: ["bug"],
        severity: "warning",
        action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
            for (const scenario of scenarios) {
                const steps = scenario.steps || [];
                const hasTarget = steps.some(s => s.text && (s.text.includes('target =') || s.text.includes('target=')));
                const hasTrace = steps.some(s => s.text && (s.text.includes('trace =') || s.text.includes('trace=')));
                const hasTargetTag = (scenario.tags || []).some(t => t.startsWith('@tc-') || t.startsWith('@tr-'));

                if (!hasTarget && !hasTrace && !hasTargetTag) {
                    rules.push({
                        id: "bug-target-missing",
                        type: 'warning',
                        title: `Bug scenario "${scenario.name || 'Unnamed'}" lacks target traceability`,
                        detail: `Add a step '* mark target = <testcase.identity>' or link it with a '@tc-*' tag for full defect-to-case traceability.`,
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location
                    });
                }
            }
        }
    }
];
