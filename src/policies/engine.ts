import { logger } from '../core/logger';
import { logger as notify } from '../core/logger';
import { IScope, ParserScenario } from '../core/types';
import { BUILTIN_POLICIES } from './catalog';
import { PolicyLoader } from './loader';
import {
    PolicyDefinition,
    PolicyInfo,
    PolicyRule,
    PolicyScanOptions,
    PolicyScanResult,
    PolicySeverity
} from './types';

/**
 * Checks whether a file path matches a wildcard glob pattern:
 * e.g. "tests/checkout/**", "*.case.feature", "legacy/**"
 */
export function matchGlobPattern(filePath: string, pattern: string): boolean {
    if (!pattern) return true;
    const normPath = filePath.replace(/\\/g, '/').toLowerCase();
    const normPattern = pattern.replace(/\\/g, '/').toLowerCase().trim();
    if (normPattern === '*' || normPattern === '**' || normPattern === '**/*') return true;

    // Direct substring or basename coincidence
    if (!normPattern.includes('*') && !normPattern.includes('?')) {
        return normPath === normPattern || normPath.endsWith(`/${normPattern}`) || normPath.includes(normPattern);
    }

    const regexPattern = normPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§§DOUBLE_STAR§§')
        .replace(/\*/g, '[^/]*')
        .replace(/§§DOUBLE_STAR§§/g, '.*')
        .replace(/\?/g, '.');

    const re = new RegExp(`(^|/)${regexPattern}$`);
    return re.test(normPath) || new RegExp(`^${regexPattern}$`).test(normPath);
}

export class PolicyEngine {
    public builtinPolicies: Record<string, PolicyDefinition> = {};
    public userPolicies: Record<string, PolicyDefinition> = {};
    private disabledPolicies: Set<string> = new Set();
    private severityOverrides: Map<string, PolicySeverity> = new Map();

    constructor() {
        for (const p of BUILTIN_POLICIES) {
            this.builtinPolicies[p.id] = p;
        }
    }

    public registry(policy: PolicyDefinition, type: 'system' | 'user' = 'system'): void {
        if (type === 'system') {
            this.builtinPolicies[policy.id] = policy;
        } else {
            this.userPolicies[policy.id] = policy;
        }
    }

    public enable(id: string): boolean {
        this.disabledPolicies.delete(id);
        return true;
    }

    public disable(id: string): boolean {
        this.disabledPolicies.add(id);
        return true;
    }

    public isEnabled(id: string): boolean {
        return !this.disabledPolicies.has(id);
    }

    public get(id: string): PolicyInfo | undefined {
        const sys = this.builtinPolicies[id];
        if (sys) {
            return {
                id: sys.id,
                type: 'system',
                scope: sys.scope,
                description: sys.description || '',
                enabled: this.isEnabled(sys.id),
                severity: this.severityOverrides.get(sys.id) || sys.severity || 'error'
            };
        }
        const usr = this.userPolicies[id];
        if (usr) {
            return {
                id: usr.id,
                type: 'user',
                scope: usr.scope,
                description: usr.description || '',
                enabled: this.isEnabled(usr.id),
                severity: this.severityOverrides.get(usr.id) || usr.severity || 'error'
            };
        }
        return undefined;
    }

    public getAll(): PolicyInfo[] {
        const result: PolicyInfo[] = [];
        for (const sys of Object.values(this.builtinPolicies)) {
            result.push({
                id: sys.id,
                type: 'system',
                scope: sys.scope,
                description: sys.description || '',
                enabled: this.isEnabled(sys.id),
                severity: this.severityOverrides.get(sys.id) || sys.severity || 'error'
            });
        }
        for (const usr of Object.values(this.userPolicies)) {
            result.push({
                id: usr.id,
                type: 'user',
                scope: usr.scope,
                description: usr.description || '',
                enabled: this.isEnabled(usr.id),
                severity: this.severityOverrides.get(usr.id) || usr.severity || 'error'
            });
        }
        return result.sort((a, b) => a.id.localeCompare(b.id));
    }

    public configure(config?: any): void {
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
            if (val && typeof val === 'object' && (val as any).severity) {
                this.severityOverrides.set(key, (val as any).severity);
            }
        }
    }

    public async loadCustomPolicies(dir: string): Promise<string[]> {
        return PolicyLoader.loadCustomPolicies(dir, (p) => this.registry(p, 'user'));
    }

    public resolve(scope: IScope): PolicyDefinition[] {
        const system = Object.values(this.builtinPolicies);
        const user = Object.values(this.userPolicies);
        return [...system, ...user].filter(
            (policy) => policy.scope.includes(scope) && !this.disabledPolicies.has(policy.id)
        );
    }

    /**
     * Executes the policy scan against the provided scenarios.
     * Supports filtering by include/exclude globs and severity levels.
     */
    public scan(
        scenarios: ParserScenario[],
        scope: IScope,
        options: PolicyScanOptions = {}
    ): PolicyScanResult {
        let candidateScenarios = scenarios;

        // Apply include / exclude glob filters if specified
        if (options.include) {
            const incList = Array.isArray(options.include) ? options.include : [options.include];
            candidateScenarios = candidateScenarios.filter(s =>
                incList.some(pat => matchGlobPattern(s.uri, pat) || (s.tags || []).some(t => t.includes(pat)))
            );
        }

        if (options.exclude) {
            const excList = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
            candidateScenarios = candidateScenarios.filter(s =>
                !excList.some(pat => matchGlobPattern(s.uri, pat) || (s.tags || []).some(t => t.includes(pat)))
            );
        }

        const rawRules: PolicyRule[] = [];
        const activePolicies = this.resolve(scope);

        for (const policy of activePolicies) {
            try {
                policy.action(candidateScenarios, rawRules, scope);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Unknown policy execution error";
                rawRules.push({
                    id: `policy-runtime-error:${policy.id}`,
                    type: 'error',
                    title: `Policy "${policy.id}" failed during execution.`,
                    detail: message,
                    uri: "(policy-runtime)",
                });
            }
        }

        // Apply severity overrides or policy defaults
        const processedRules: PolicyRule[] = rawRules.map(r => {
            const override = this.severityOverrides.get(r.id);
            const severity: PolicySeverity = override || r.type || 'error';
            return {
                ...r,
                type: severity
            };
        });

        // Filter by target severity threshold if requested
        let filteredRules = processedRules;
        if (options.severity) {
            if (options.severity === 'error') {
                filteredRules = processedRules.filter(r => r.type === 'error');
            } else if (options.severity === 'warning') {
                filteredRules = processedRules.filter(r => r.type === 'error' || r.type === 'warning');
            }
        }

        const errorCount = filteredRules.filter(r => r.type === 'error').length;
        const warningCount = filteredRules.filter(r => r.type === 'warning').length;
        const advisoryCount = filteredRules.filter(r => r.type === 'advisory').length;

        const isStrict = Boolean(options.strict);
        const hasErrors = errorCount > 0 || (isStrict && warningCount > 0);
        const hasWarnings = warningCount > 0;

        return {
            hasErrors,
            hasWarnings,
            errorCount,
            warningCount,
            advisoryCount,
            fixedCount: 0,
            rules: filteredRules
        };
    }

    /**
     * Preserved signature for backward compatibility with plan, validate, and tests.
     * Returns true ONLY if there are blocking violations (errors, or warnings in strict mode).
     * Warnings do not block normal plan or validate runs.
     */
    public scanner(
        scenarios: ParserScenario[],
        scope: IScope,
        isJson: boolean = false,
        compactWarnings: boolean = false,
        options: PolicyScanOptions = {}
    ): boolean {
        const mergedOptions: PolicyScanOptions = {
            ...options,
            isJson,
            compactWarnings
        };

        const result = this.scan(scenarios, scope, mergedOptions);
        const { rules, hasErrors, errorCount, warningCount, advisoryCount } = result;

        if (isJson) {
            if (rules.length > 0) {
                const data = {
                    valid: !hasErrors,
                    error_count: errorCount,
                    warning_count: warningCount,
                    advisory_count: advisoryCount,
                    diagnostics: rules.map(r => ({
                        severity: r.type ?? 'error',
                        summary: r.title,
                        detail: r.detail
                    }))
                };
                console.log(JSON.stringify(data, null, 2));
                if (hasErrors) {
                    process.exit(1);
                }
            }
            return hasErrors;
        }

        if (rules.length > 0) {
            if (hasErrors) {
                logger.info("Review the violations above and fix them before continuing.", { bold: true });
                logger.info(`${errorCount} policy error${errorCount > 1 ? "s" : ""} found:\n`, { bold: true });
            } else {
                logger.info(`${warningCount} policy warning${warningCount > 1 ? "s" : ""} noted:\n`, { bold: true });
            }
        }

        for (const violation of rules) {
            const isWarning = violation.type === 'warning';
            if (isWarning && compactWarnings) continue;

            let locationStr = `on ${violation.uri}`;
            if (violation.line !== undefined) locationStr += ` line ${violation.line}`;
            if (violation.scenario) locationStr += `, in scenario "${violation.scenario}"`;

            notify.push({
                type: (violation.type as any) ?? 'error',
                title: violation.title,
                detail: [
                    violation.detail,
                    locationStr
                ]
            });
        }

        if (warningCount > 0 && compactWarnings) {
            logger.warn(`\n${warningCount} warning(s) found. (Details suppressed by -compact-warnings)`);
        }

        return hasErrors;
    }
}
