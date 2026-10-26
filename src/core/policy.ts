import { existsSync, readdirSync } from 'fs';
import { resolve, extname } from 'path';
import { pathToFileURL } from 'url';
import { Logger, logger } from '../core/logger';
import { logger as notify } from '../core/logger';
import { IScope, ParserScenario, PolicyRule, PolicyAction, PolicyDefinition } from '../core/types';

export interface PolicyInfo {
    id: string;
    type: 'system' | 'user';
    scope: IScope[];
    description: string;
    enabled: boolean;
}

class Policy {
    private builtinPolicies: Record<string, PolicyDefinition> = {};
    private userPolicies: Record<string, PolicyDefinition> = {};
    private disabledPolicies: Set<string> = new Set();

    private resolve(scope: IScope): PolicyDefinition[] {
        const system = Object.values(this.builtinPolicies);
        const user = Object.values(this.userPolicies);
        return [...system, ...user].filter(
            (policy) => policy.scope.includes(scope) && !this.disabledPolicies.has(policy.id)
        );
    }

    registry(policy: PolicyDefinition, type: 'system' | 'user' = 'system'): void {
        if (type === 'system') {
            this.builtinPolicies[policy.id] = policy;
        }

        if (type === 'user') {
            this.userPolicies[policy.id] = policy;
        }
    }

    enable(id: string): boolean {
        this.disabledPolicies.delete(id);
        return true;
    }

    disable(id: string): boolean {
        this.disabledPolicies.add(id);
        return true;
    }

    isEnabled(id: string): boolean {
        return !this.disabledPolicies.has(id);
    }

    get(id: string): PolicyInfo | undefined {
        const sys = this.builtinPolicies[id];
        if (sys) {
            return {
                id: sys.id,
                type: 'system',
                scope: sys.scope,
                description: sys.description || '',
                enabled: this.isEnabled(sys.id)
            };
        }
        const usr = this.userPolicies[id];
        if (usr) {
            return {
                id: usr.id,
                type: 'user',
                scope: usr.scope,
                description: usr.description || '',
                enabled: this.isEnabled(usr.id)
            };
        }
        return undefined;
    }

    getAll(): PolicyInfo[] {
        const result: PolicyInfo[] = [];
        for (const sys of Object.values(this.builtinPolicies)) {
            result.push({
                id: sys.id,
                type: 'system',
                scope: sys.scope,
                description: sys.description || '',
                enabled: this.isEnabled(sys.id)
            });
        }
        for (const usr of Object.values(this.userPolicies)) {
            result.push({
                id: usr.id,
                type: 'user',
                scope: usr.scope,
                description: usr.description || '',
                enabled: this.isEnabled(usr.id)
            });
        }
        return result.sort((a, b) => a.id.localeCompare(b.id));
    }

    configure(config?: any): void {
        if (!config || typeof config !== 'object') return;
        if (Array.isArray(config.disabled)) {
            for (const id of config.disabled) {
                if (typeof id === 'string') this.disable(id.trim());
            }
        }
        if (Array.isArray(config.enabled)) {
            for (const id of config.enabled) {
                if (typeof id === 'string') this.enable(id.trim());
            }
        }
        for (const [key, val] of Object.entries(config)) {
            if (key === 'disabled' || key === 'enabled') continue;
            if (val === false || (val && typeof val === 'object' && (val as any).enabled === false)) {
                this.disable(key);
            } else if (val === true || (val && typeof val === 'object' && (val as any).enabled === true)) {
                this.enable(key);
            }
        }
    }

    async loadCustomPolicies(dir: string): Promise<void> {
        const candidateDirs = [
            resolve(dir, '.testform', 'policies'),
            resolve(dir, 'policies'),
        ];

        // Modules support: .testform/modules/*/policies and .testform/modules/*/.testform/policies
        const modulesDir = resolve(dir, '.testform', 'modules');
        if (existsSync(modulesDir)) {
            try {
                const entries = readdirSync(modulesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        candidateDirs.push(resolve(modulesDir, entry.name, 'policies'));
                        candidateDirs.push(resolve(modulesDir, entry.name, '.testform', 'policies'));
                    }
                }
            } catch {
                // Ignore unreadable modules dir
            }
        }

        const validExts = ['.js', '.mjs', '.cjs', '.ts'];
        for (const cDir of candidateDirs) {
            if (!existsSync(cDir)) continue;
            try {
                const files = readdirSync(cDir, { withFileTypes: true });
                for (const file of files) {
                    if (file.isFile()) {
                        const ext = extname(file.name).toLowerCase();
                        if (validExts.includes(ext)) {
                            const fullPath = resolve(cDir, file.name);
                            await this.loadPolicyFile(fullPath);
                        }
                    }
                }
            } catch {
                // Ignore read errors
            }
        }
    }

    private async loadPolicyFile(filePath: string): Promise<void> {
        let loadedModule: any;
        try {
            loadedModule = await import(pathToFileURL(filePath).href);
        } catch {
            try {
                loadedModule = require(filePath);
            } catch {
                return;
            }
        }

        const exported = loadedModule?.default || loadedModule;
        if (!exported) return;

        // 1. Direct policy definition: { id, scope, action, description }
        if (exported.id && Array.isArray(exported.scope) && typeof exported.action === 'function') {
            this.registry(exported, 'user');
            return;
        }

        // 2. Array of policy definitions: [{ id, ... }, { id, ... }]
        if (Array.isArray(exported)) {
            for (const item of exported) {
                if (item?.id && Array.isArray(item.scope) && typeof item.action === 'function') {
                    this.registry(item, 'user');
                }
            }
            return;
        }

        // 3. Factory function: (context) => void
        if (typeof exported === 'function') {
            try {
                exported({
                    registerPolicy: (p: PolicyDefinition) => this.registry(p, 'user'),
                    policy: this
                });
            } catch {
                // Ignore factory error
            }
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
    description: "Warns about scenario fields not declared in configuration",
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
    description: "Ensures required fields defined in configuration are present",
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
    description: "Validates required Gherkin structure and keywords (Given, When, Then)",
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
    description: "Restricts non-standard tags at the Feature level",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        const expectedTag = `@${scope}`;
        const seen = new Set<string>();

        for (const scenario of scenarios) {
            const uri = scenario.uri ?? "(unknown)";
            if (seen.has(uri)) continue;
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
})

policy.registry({
    id: "identity-required",
    description: "Enforces identity tags (@tc-X, @tr-X, @tp-X)",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
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
})

policy.registry({
    id: "identity-unique",
    description: "Verifies identity tag uniqueness within scope",
    scope: ["testcase", "testrun", "testplan"],
    action: (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => {
        const seen = new Map<string, { scenario: string; line?: number; keyword: string; uri: string }[]>();

        for (const scenario of scenarios) {
            const identity = scenario.custom?.identity?.trim();
            if (!identity) continue;

            // Ignore if the identity is just the uri fallback
            if (identity === scenario.uri) continue;

            const entry = { scenario: scenario.name, line: scenario.location, keyword: scenario.keyword || '', uri: scenario.uri || '' };

            // For testcase, identities only need to be unique within the same file.
            // For testrun/testplan, identities must be globally unique across all files.
            const uniquenessKey = scope === 'testcase' ? `${scenario.uri}.${identity}` : identity;

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
                        if (scope === 'testcase' && s.uri !== entry.uri) continue;

                        const id = s.custom?.identity?.trim();
                        if (id && id !== s.uri) {
                            // Extract numbers from matching prefixes
                            const m = id.match(new RegExp(`^${prefix}(\\d+)${suffix}$`));
                            if (m) {
                                const num = parseInt(m[1], 10);
                                if (num > max) max = num;
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

policy.registry({
    id: "duplicate-testruns-in-testplan",
    description: "Prevents duplicate testruns inside the same or across testplans",
    scope: ["testplan"],
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
});