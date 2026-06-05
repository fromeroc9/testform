"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPolicy = exports.policy = void 0;
const logger_1 = require("../logger");
const notify_1 = require("../notify");
class Policy {
    builtinPolicies = {};
    userPolicies = {};
    resolve(scope) {
        const system = Object.values(this.builtinPolicies);
        const user = Object.values(this.userPolicies);
        return [...system, ...user].filter((policy) => policy.scope.includes(scope));
    }
    registry(policy, type = 'system') {
        if (type === 'system') {
            this.builtinPolicies[policy.id] = policy;
        }
        if (type === 'user') {
            this.userPolicies[policy.id] = policy;
        }
    }
    scanner(scenarios, scope, isJson = false, compactWarnings = false) {
        const rules = [];
        const activePolicies = this.resolve(scope);
        for (const policy of activePolicies) {
            try {
                policy.action(scenarios, rules, scope);
            }
            catch (err) {
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
            logger_1.logger.info("Review the violations above and fix them before continuing.", { bold: true });
            logger_1.logger.info(`${rules.length} policy violation${rules.length > 1 ? "s" : ""} found:\n`, { bold: true });
        }
        let warningsCount = 0;
        for (const violation of rules) {
            const isWarning = violation.type === 'warning';
            if (isWarning)
                warningsCount++;
            if (isWarning && compactWarnings)
                continue;
            let locationStr = `on ${violation.uri}`;
            if (violation.line !== undefined)
                locationStr += ` line ${violation.line}`;
            if (violation.scenario)
                locationStr += `, in scenario "${violation.scenario}"`;
            notify_1.notify.push({
                type: violation.type ?? 'error',
                title: violation.title,
                detail: [
                    violation.detail,
                    locationStr
                ]
            });
        }
        if (warningsCount > 0 && compactWarnings) {
            logger_1.logger.warn(`\n${warningsCount} warning(s) found. (Details suppressed by -compact-warnings)`);
        }
        return rules.length > 0;
    }
}
exports.policy = new Policy();
const registerPolicy = (policyDefinition) => exports.policy.registry(policyDefinition, 'user');
exports.registerPolicy = registerPolicy;
exports.policy.registry({
    id: "undeclared-fields",
    scope: ["testcase"],
    action: (scenarios, rules, scope) => {
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
});
exports.policy.registry({
    id: "required-fields",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios, rules, scope) => {
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
});
exports.policy.registry({
    id: "required-gherkin",
    scope: ["testcase"],
    action: (scenarios, rules, scope) => {
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
                });
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
            if (!validKeywords.includes(scenario.keyword.trim().toLowerCase()))
                continue;
            // Check: Required steps (Given, When, Then)
            const allSteps = [
                ...(scenario.background?.steps ?? []),
                ...scenario.steps,
            ];
            const missing = [];
            if (!allSteps.some(s => s.keyword.trim().toLowerCase() === "given"))
                missing.push("Given");
            if (!allSteps.some(s => s.keyword.trim().toLowerCase() === "when"))
                missing.push("When");
            if (!allSteps.some(s => s.keyword.trim().toLowerCase() === "then"))
                missing.push("Then");
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
});
exports.policy.registry({
    id: "no-feature-tags",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios, rules, scope) => {
        const expectedTag = `@${scope}`;
        const seen = new Set();
        for (const scenario of scenarios) {
            const uri = scenario.uri ?? "(unknown)";
            if (seen.has(uri))
                continue;
            seen.add(uri);
            const allowedScopeTags = ["@testcase", "@testrun", "@testplan"];
            const allowedFeatureTags = [...allowedScopeTags];
            if (scenario.custom?.identity) {
                allowedFeatureTags.push(scenario.custom.identity.toLowerCase());
            }
            const featureTags = scenario.feature?.tags ?? [];
            const invalidTags = featureTags.filter(tag => !allowedFeatureTags.includes(tag.toLowerCase()));
            if (invalidTags.length > 0) {
                rules.push({
                    id: "no-feature-tags",
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
                        title: `Mismatched scope: file is tagged as ${tag} but is being processed as ${expectedTag}.`,
                        detail: `A feature file designed for ${tag} cannot be executed in -scope ${scope}.`,
                        uri,
                    });
                }
            }
        }
    }
});
exports.policy.registry({
    id: "identity-required",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios, rules, scope) => {
        for (const scenario of scenarios ?? []) {
            const identity = scenario.custom?.identity;
            if (!identity || identity.trim() === "" || identity === scenario.uri) {
                rules.push({
                    id: "identity-required",
                    title: scope === 'testcase'
                        ? "Every scenario must have an identity tag matching the configured identity pattern."
                        : "Every feature must have an identity tag matching the configured identity pattern.",
                    detail: scope === 'testcase'
                        ? "Add the identity tag (e.g. @tc-1) to each scenario."
                        : "Add the identity tag (e.g. @tr-1) to the Feature level.",
                    uri: scenario.uri ?? "(unknown)",
                    scenario: scope === 'testcase' ? scenario.name : undefined,
                    line: scope === 'testcase' ? scenario.location : (scenario.feature?.location ?? scenario.location),
                });
                continue;
            }
            if (scope === 'testrun' || scope === 'testplan') {
                const featureTags = scenario.feature?.tags ?? [];
                const hasFeatureTag = featureTags.some(t => t.toLowerCase() === identity.toLowerCase());
                if (!hasFeatureTag) {
                    rules.push({
                        id: "identity-feature-level-required",
                        title: `The identity tag ${identity} must be declared at the Feature level.`,
                        detail: `Move the identity tag ${identity} so it is placed next to the @${scope} tag before the 'Feature:' keyword.`,
                        uri: scenario.uri ?? "(unknown)",
                        line: scenario.feature?.location ?? scenario.location,
                    });
                }
            }
        }
    }
});
exports.policy.registry({
    id: "identity-unique",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios, rules, scope) => {
        const seen = new Map();
        for (const scenario of scenarios) {
            const identity = scenario.custom?.identity?.trim();
            if (!identity)
                continue;
            // Ignore if the identity is just the uri fallback
            if (identity === scenario.uri)
                continue;
            const entry = { scenario: scenario.name, line: scenario.location, keyword: scenario.keyword || '', uri: scenario.uri || '' };
            // For testcase, identities only need to be unique within the same file.
            // For testrun/testplan, identities must be globally unique across all files.
            const uniquenessKey = scope === 'testcase' ? `${scenario.uri}::${identity}` : identity;
            const existing = seen.get(uniquenessKey);
            if (existing) {
                existing.push(entry);
            }
            else {
                seen.set(uniquenessKey, [entry]);
            }
        }
        for (const [key, entries] of seen) {
            if (entries.length <= 1)
                continue;
            const identity = key.includes('::') ? key.split('::')[1] : key;
            const allSameOutline = entries.every((e) => (e.keyword || '').trim() === "Scenario Outline") &&
                entries.every((e) => e.line === entries[0].line && e.uri === entries[0].uri);
            if (allSameOutline) {
                rules.push({
                    id: "unique-key-required",
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
                    for (const s of scenarios) {
                        // For testcase, only check within the same file. For others, check globally.
                        if (scope === 'testcase' && s.uri !== entry.uri)
                            continue;
                        const id = s.custom?.identity?.trim();
                        if (id && id !== s.uri) {
                            // Extract numbers from matching prefixes
                            const m = id.match(new RegExp(`^${prefix}(\\d+)${suffix}$`));
                            if (m) {
                                const num = parseInt(m[1], 10);
                                if (num > max)
                                    max = num;
                            }
                        }
                    }
                    if (max > 0) {
                        suggestion = ` The next available identity ${scope === 'testcase' ? 'in this file ' : ''}is ${prefix}${max + 1}${suffix}.`;
                    }
                }
                rules.push({
                    id: "identity-unique",
                    title: scope === 'testcase'
                        ? `Duplicate identity "${identity}" found in the same file.`
                        : `Duplicate identity "${identity}" found.`,
                    detail: (scope === 'testcase'
                        ? "Each scenario within a file must have a unique identity tag."
                        : "Each element must have a globally unique identity tag in the workspace.") + suggestion,
                    uri: entry.uri,
                    scenario: entry.scenario,
                    line: entry.line,
                });
            }
        }
    }
});
