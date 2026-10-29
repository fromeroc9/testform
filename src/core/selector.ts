import { join, resolve, basename } from 'path';
import { IScope } from './types';
import { SCOPE_CONFIG, TESTCASE_STATUSES, TITLE_CLI } from './const';
import { Parser } from './parser';
import { Config } from './config';
import { VariableParser } from './variables';
import { Diag } from './diagnostics';
import { askSelect } from './prompt';

// ─── Scope Utilities ──────────────────────────────────────────────────────────

/**
 * Checks whether a given scenario document belongs to a specific scope,
 * based on feature tags or filename conventions.
 */
export function matchesScope(s: any, scopeName: IScope, filePattern?: string): boolean {
    if (!s) return false;
    if (!Object.prototype.hasOwnProperty.call(SCOPE_CONFIG, scopeName)) return false;
    const cfg = SCOPE_CONFIG[scopeName as keyof typeof SCOPE_CONFIG];
    const tags = s.feature?.tags || [];
    const uri = typeof s.uri === 'string' ? s.uri : '';
    if (tags.includes(cfg.tag) || uri.endsWith(cfg.ext)) {
        return true;
    }
    if (filePattern) {
        const clean = filePattern.split('.')[0].trim();
        if (clean && clean !== '*') {
            if (clean.startsWith('*') && uri.endsWith(clean.slice(1))) {
                return true;
            }
            if (uri === clean || uri.endsWith(`/${clean}`)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Detects the likely scope from a target string or filename.
 */
export function detectScopeFromTarget(target: string): IScope | undefined {
    const clean = target.trim().toLowerCase();
    if (clean === 'testplan' || clean.endsWith('.plan.feature') || clean.includes('.plan.feature') || clean.startsWith('@tp') || clean.includes('.@tp')) {
        return 'testplan';
    }
    if (clean === 'testrun' || clean.endsWith('.run.feature') || clean.includes('.run.feature') || clean.startsWith('@tr') || clean.includes('.@tr')) {
        return 'testrun';
    }
    if (clean === 'testcase' || clean.endsWith('.case.feature') || clean.includes('.case.feature') || clean.startsWith('@tc') || clean.includes('.@tc')) {
        return 'testcase';
    }
    return undefined;
}

// ─── Target Matching ──────────────────────────────────────────────────────────

/**
 * Checks if a given identity or URI matches any of the target expressions.
 * Supports exact match, scope prefix (`${target}.`), path suffix (`/${target}`),
 * and filename suffix. Also matches resource type (e.g. 'testcase', 'testform_testcase').
 */
export function matchesTarget(identityOrUri: string, target: string | string[], resourceType?: string): boolean {
    if (!identityOrUri && !resourceType) return false;
    const targets = Array.isArray(target) ? target : [target];

    return targets.some(t => {
        if (!t) return false;
        const cleanT = t.trim().toLowerCase();

        // Match by resource type (e.g. -target=testcase or -target=testform_testcase)
        if (resourceType) {
            const cleanRes = resourceType.trim().toLowerCase();
            if (cleanT === cleanRes || cleanT === `testform_${cleanRes}` || `testform_${cleanT}` === cleanRes) {
                return true;
            }
        }

        if (!identityOrUri) return false;
        const normIdentity = identityOrUri.replace(/\\/g, '/');
        let normT = t.replace(/\\/g, '/');

        // Check if target is a resource address with type prefix (e.g. testcase.modules/auth/login or github_testcase.modules/auth/login)
        if (resourceType) {
            const cleanRes = resourceType.trim().toLowerCase();
            if (normT.toLowerCase().startsWith(`${cleanRes}.`)) {
                normT = normT.slice(cleanRes.length + 1);
            } else if (normT.toLowerCase().match(new RegExp(`^[a-z0-9_-]+_${cleanRes}\\.`, 'i'))) {
                normT = normT.replace(new RegExp(`^[a-z0-9_-]+_${cleanRes}\\.`, 'i'), '');
            }
        }

        // Strip trailing scenario/identity tag (e.g. .@tc-01, .@tr-1, .@tp-1) if present
        const lastDot = normIdentity.lastIndexOf('.');
        const cleanIdentity = (lastDot !== -1 && normIdentity.slice(lastDot).startsWith('.@'))
            ? normIdentity.slice(0, lastDot)
            : normIdentity;

        const normBase = basename(cleanIdentity).replace(/(\.(case|run|plan))?\.feature$/i, '');
        const normTarget = basename(normT).replace(/(\.(case|run|plan))?\.feature$/i, '');
        const hasPath = normT.includes('/');

        if (hasPath) {
            return (
                normIdentity === normT ||
                cleanIdentity === normT ||
                normIdentity.startsWith(`${normT}.`) ||
                cleanIdentity.startsWith(`${normT}.`) ||
                cleanIdentity.endsWith(`/${normT}`) ||
                cleanIdentity.endsWith(normT)
            );
        }

        return (
            normIdentity === normT ||
            cleanIdentity === normT ||
            normIdentity.startsWith(`${normT}.`) ||
            cleanIdentity.startsWith(`${normT}.`) ||
            cleanIdentity.endsWith(`/${normT}`) ||
            cleanIdentity.endsWith(normT) ||
            basename(cleanIdentity) === normT ||
            basename(cleanIdentity).replace(/(\.(case|run|plan))?\.feature$/i, '') === normTarget ||
            normBase === normTarget
        );
    });
}

// ─── Spec Parsing ─────────────────────────────────────────────────────────────

export interface ParsedSpec {
    raw: string;
    rawIdentifier: string;
    featurePart: string;
    casePart: string;
    newStatus: string;
    isWholeFile: boolean;
}

export interface ParseSpecOptions {
    command?: 'mark' | 'link';
    defaultStatus?: string;
    requireStatus?: boolean;
}

/**
 * Parses a CLI spec string like:
 *   - "@tc-1=passed"
 *   - "cuenta/inicio.feature@tc-1=passed"
 *   - "checkout.case.feature.@tc-1=failed"
 *   - "Pago con tarjeta=passed"
 *   - "checkout.case.feature" (whole file for implicit link)
 */
export function parseSpec(specArg: string, options: ParseSpecOptions = {}): ParsedSpec {
    const { command = 'mark', defaultStatus = 'pending', requireStatus = (command === 'mark') } = options;

    let newStatus = defaultStatus;
    let rawIdentifier = specArg;

    if (specArg.includes('=')) {
        const eqIdx = specArg.lastIndexOf('=');
        newStatus = specArg.slice(eqIdx + 1).trim();
        rawIdentifier = specArg.slice(0, eqIdx).trim();

        if (!TESTCASE_STATUSES.includes(newStatus as any)) {
            Diag.error({
                title: `Invalid status '${newStatus}' in '${specArg}'.`,
                detail: [`Available statuses: ${TESTCASE_STATUSES.join(', ')}`],
            }).abort();
        }
    } else if (requireStatus) {
        Diag.error({
            title: `Invalid format: '${specArg}'`,
            detail: [
                `Expected format: '<identifier>=<status>'`,
                `Examples:`,
                `  ${TITLE_CLI} suite mark "@tc-1=passed" -target="@tr-2"`,
                `  ${TITLE_CLI} suite mark "cuenta/inicio-sesion.feature@tc-1=passed" -target="@tr-2"`,
                ``,
                `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
            ],
        }).abort();
    }

    if (!rawIdentifier) {
        Diag.error({
            title: `Could not find scenario identity in '${specArg}'.`,
            detail: [
                `Expected format: '<identifier>=<status>'`,
                `Available statuses: ${TESTCASE_STATUSES.join(', ')}`,
            ],
        }).abort();
    }

    // Strip provider/scope prefix if present (e.g. github_testcase., local_testcase., testcase.)
    const stripped = rawIdentifier.replace(/^([a-zA-Z0-9_-]+_)?testcase\./, '');

    let featurePart = '';
    let casePart = '';
    let isWholeFile = false;

    if (stripped.includes('.feature.')) {
        const dotIdx = stripped.indexOf('.feature.');
        featurePart = stripped.slice(0, dotIdx + 8).trim();
        casePart = stripped.slice(dotIdx + 9).trim();
    } else {
        const atIdx = stripped.lastIndexOf('@');
        if (atIdx > 0) {
            featurePart = stripped.slice(0, atIdx).trim();
            casePart = stripped.slice(atIdx).trim();
        } else if (stripped.endsWith('.feature')) {
            featurePart = stripped.trim();
            casePart = '';
            isWholeFile = true;
        } else if (stripped.includes('.')) {
            const lastDot = stripped.lastIndexOf('.');
            featurePart = stripped.slice(0, lastDot).trim();
            casePart = stripped.slice(lastDot + 1).trim();
        } else {
            casePart = stripped.trim();
        }
    }

    return {
        raw: specArg,
        rawIdentifier,
        featurePart,
        casePart,
        newStatus,
        isWholeFile,
    };
}

// ─── Scenario & State Key Matching ────────────────────────────────────────────

/**
 * Checks whether a featurePart string matches a file path or URI.
 */
export function matchesFeatureFile(filePath: string, featurePart?: string): boolean {
    if (!featurePart) return true;
    const normalizedTarget = featurePart.replace(/\.feature$/i, '');
    const normalizedFile = filePath.replace(/\.feature$/i, '');

    return (
        filePath === featurePart ||
        normalizedFile === normalizedTarget ||
        filePath.endsWith(featurePart) ||
        filePath.endsWith('/' + featurePart) ||
        filePath.endsWith('/' + featurePart + '.feature') ||
        basename(normalizedFile) === basename(normalizedTarget)
    );
}

/**
 * Matches a scenario object against a parsed spec using the 3 identity strategies:
 *   1. Tag / ID match (`@tc-1` or `tc-1`)
 *   2. Scenario title / name match (case-insensitive)
 *   3. Full identity match
 */
export function matchesScenarioSpec(
    scenario: { uri: string; name?: string; custom?: { identity?: string } },
    spec: { featurePart?: string; casePart: string }
): boolean {
    if (spec.featurePart && !matchesFeatureFile(scenario.uri, spec.featurePart)) {
        return false;
    }

    const normCase = spec.casePart.trim().toLowerCase();
    const sId = (scenario.custom?.identity || '').trim().toLowerCase();
    const sName = (scenario.name || '').trim().toLowerCase();

    // Strategy 1: Tag/ID match
    if (sId === normCase || sId.replace(/^@/, '') === normCase.replace(/^@/, '')) {
        return true;
    }

    // Strategy 2: Title / Name match
    if (sName && sName === normCase) {
        return true;
    }

    // Strategy 3: Full identity match
    const fullId = `${scenario.uri}.${scenario.custom?.identity || scenario.name}`.toLowerCase();
    if (fullId === normCase) {
        return true;
    }

    return false;
}

/**
 * Matches a state key (e.g. `login.case.feature.@tc-1`) against a spec.
 */
export function matchesStateKey(
    key: string,
    scenarioTitle: string | undefined,
    spec: { featurePart?: string; casePart: string; rawIdentifier?: string }
): boolean {
    const lastDot = key.lastIndexOf('.');
    const kFile = lastDot !== -1 ? key.slice(0, lastDot) : key;
    const kId = lastDot !== -1 ? key.slice(lastDot + 1) : '';

    if (spec.featurePart && !matchesFeatureFile(kFile, spec.featurePart)) {
        return false;
    }

    const normCase = spec.casePart.trim().toLowerCase();
    const normId = kId.trim().toLowerCase();
    const normTitle = (scenarioTitle || '').trim().toLowerCase();

    // 1. Exact ID/Tag match (with or without '@')
    if (normId === normCase || normId.replace(/^@/, '') === normCase.replace(/^@/, '')) {
        return true;
    }

    // 2. Exact Title match
    if (normTitle && normTitle === normCase) {
        return true;
    }

    // 3. Fallback: Full identity match
    if (spec.rawIdentifier && key.toLowerCase() === spec.rawIdentifier.toLowerCase()) {
        return true;
    }

    return false;
}

// ─── Target Scenario Resolver ─────────────────────────────────────────────────

export interface ResolveTargetScenarioOptions {
    target: string;
    dir: string;
    scopeKey: IScope;
    testDirectory?: string;
    variables?: VariableParser;
}

/**
 * Resolves a target string into a single scenario and absolute file path.
 * If 0 or >1 matches are found, it triggers the appropriate Diag error.
 */
export async function resolveTargetScenario(
    targetOrOptions: string | ResolveTargetScenarioOptions,
    dir?: string,
    scopeKey?: IScope,
    testDirectory?: string,
    variables?: VariableParser
): Promise<{
    absolutePath: string;
    scenario: any;
}> {
    const opts: ResolveTargetScenarioOptions = typeof targetOrOptions === 'string'
        ? { target: targetOrOptions, dir: dir!, scopeKey: scopeKey!, testDirectory, variables }
        : targetOrOptions;

    const { target, dir: workDir, scopeKey: scope, testDirectory: tDir, variables: vars } = opts;
    const searchDir = tDir ? join(workDir, tDir) : workDir;
    const parser = new Parser(searchDir, vars);
    const config = new Config(workDir);

    const data = {
        identity: config.getIdentity(scope),
        fields: config.getFields(scope),
    };

    const documents = parser.content() || [];
    const matchPattern = config.getMatch?.(scope);
    const rawScenarios = documents.filter(s => matchesScope(s, scope, matchPattern));
    const filtered = parser.filter(rawScenarios, data, scope) || [];

    const normTarget = target.replace(/\\/g, '/');
    const matches = filtered.filter(s => {
        const normUri = (s.uri || '').replace(/\\/g, '/');
        const id = s.custom?.identity ? `${normUri}.${s.custom.identity}` : normUri;
        return (
            id === normTarget ||
            id.startsWith(`${normTarget}.`) ||
            id.endsWith(`/${normTarget}`) ||
            id.endsWith(normTarget) ||
            normUri === normTarget ||
            normUri.endsWith(`/${normTarget}`) ||
            normUri.endsWith(normTarget) ||
            basename(normUri) === normTarget ||
            basename(normUri) === basename(normTarget)
        );
    });

    if (matches.length === 1) {
        return {
            absolutePath: resolve(searchDir, matches[0].uri),
            scenario: matches[0],
        };
    }

    if (matches.length === 0) {
        Diag.targetNotFound({ scopeKey: scope, target }).abort();
    }

    // Ambiguity
    const relPaths = Array.from(new Set(matches.map(m => m.uri)));
    Diag.ambiguousTarget({ scopeKey: scope, target, matches: relPaths }).abort();
    throw new Error('Unreachable');
}

// ─── Interactive Suite Target Prompter ────────────────────────────────────────

export interface PromptTargetSuiteOptions {
    dir: string;
    allowedScopes?: IScope[];
    testDirectory?: string;
    variables?: VariableParser;
}

/**
 * Prompts the user interactively to select a suite feature file when -target is omitted.
 */
export async function promptTargetSuite(
    dirOrOptions: string | PromptTargetSuiteOptions,
    allowedScopes: IScope[] = ['testrun', 'testplan'],
    testDirectory?: string,
    variables?: VariableParser
): Promise<string> {
    const opts: PromptTargetSuiteOptions = typeof dirOrOptions === 'string'
        ? { dir: dirOrOptions, allowedScopes, testDirectory, variables }
        : dirOrOptions;

    const { dir: workDir, allowedScopes: scopes = ['testrun', 'testplan'], testDirectory: tDir, variables: vars } = opts;
    const searchDir = tDir ? join(workDir, tDir) : workDir;
    const parser = new Parser(searchDir, vars);
    const documents = parser.content() || [];

    const choices: { label: string; value: string }[] = [];

    for (const sc of scopes) {
        const scDocs = documents.filter(s => matchesScope(s, sc));
        const config = new Config(workDir);
        const data = { identity: config.getIdentity(sc), fields: config.getFields(sc) };
        const filtered = parser.filter(scDocs, data, sc) || [];

        for (const s of filtered) {
            const rel = s.uri;
            const tag = s.custom?.identity || '';
            const idPart = tag ? ` (${tag})` : '';
            const titlePart = s.feature?.name ? ` - "${s.feature.name}"` : '';
            choices.push({
                label: `[${sc}] ${rel}${idPart}${titlePart}`,
                value: tag || rel,
            });
        }
    }

    if (choices.length === 0) {
        Diag.error({
            title: `No ${scopes.join(' or ')} files found in workspace.`,
            detail: [`Use \`testform suite init\` to create one first.`],
        }).abort();
    }

    return askSelect('Selecciona la suite de destino (-target):', choices);
}
