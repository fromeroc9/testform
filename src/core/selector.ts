/**
 * =========================================================================================
 * TESTFORM SELECTOR & TARGET RESOLUTION MATRIX (src/core/selector.ts)
 * =========================================================================================
 * 
 * Este módulo centraliza la resolución de identidades, filtrado por scopes y direccionamiento
 * de recursos en Testform (plan, apply, destroy, spec, suite).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * TABLA 1: ESTRATEGIAS DE RESOLUCIÓN DE -target (matchesTarget & resolveTargetScenario)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * ┌────┬──────────────────────────────────┬─────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┬───────────────────────────────────┐
 * │ #  │ Estrategia de Selección          │ Sintaxis / Ejemplo de Target                    │ Coincide contra (Match Criteria)                        │ Aplicación / Comandos             │
 * ├────┼──────────────────────────────────┼─────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┼───────────────────────────────────┤
 * │ 1  │ Tag de Identidad (@tag)          │ -target="@tr-4" o -target="@tc-01"              │ Etiqueta única del escenario/archivo (.@tr-4, .@tc-01)  │ plan, apply, spec, suite          │
 * │ 2  │ Tag sin arroba (tag suelto)      │ -target="tr-4" o -target="tc-01"                │ Coincidencia flexible de tag omitiendo el prefijo '@'   │ plan, apply, spec, suite          │
 * │ 3  │ Dirección Canónica Completa      │ -target="tests/runs/20261024.run.feature.@tr-1" │ URI completa vinculada con su tag de identidad          │ plan, apply, spec, suite          │
 * │ 4  │ Dirección con Prefijo Provider   │ -target="github_testcase.auth/login.@tc-1"      │ Dirección estilo Terraform con prefijo de proveedor     │ plan, apply, destroy              │
 * │ 5  │ Dirección con Prefijo Scope      │ -target="testcase.modules/auth/login"           │ Dirección calificada con tipo de recurso                │ plan, apply, destroy              │
 * │ 6  │ Ruta Relativa / Scoped Path      │ -target="ParaBank/bill_pay.case.feature"        │ Ruta relativa al workspace o al -test-directory         │ plan, apply, spec, suite          │
 * │ 7  │ Basename del Archivo (sin ruta)  │ -target="bill_pay.case.feature"                 │ Nombre base del archivo ignorando directorios padres    │ plan, apply, spec, suite          │
 * │ 8  │ Nombre Corto (Slug sin extensión)│ -target="bill_pay"                              │ Nombre raíz sin sufijos (.case, .run, .plan, .feature)  │ plan, apply, spec, suite          │
 * │ 9  │ Prefijo de Carpeta / Módulo      │ -target="testcycle" o -target="testcase/ParaBank│ Coincide con todos los recursos bajo esa carpeta        │ plan, apply, spec                 │
 * │ 10 │ Tipo de Recurso Global           │ -target="testcase" o -target="testrun"          │ Filtra masivamente todos los recursos de ese scope      │ plan, apply, destroy              │
 * │ 11 │ Array / Múltiples Targets        │ -target=@tc-01 -target=@tc-02                   │ Unión inclusiva (OR) evaluando múltiples objetivos      │ plan, apply, spec                 │
 * └────┴──────────────────────────────────┴─────────────────────────────────────────────────┴─────────────────────────────────────────────────────────┴───────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * TABLA 2: ESTRATEGIAS DE ESPECIFICACIÓN Y STATUS (parseSpec, matchesScenarioSpec, Rule: Scenario)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * ┌────┬──────────────────────────────────┬─────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┬───────────────────────────────────┐
 * │ #  │ Identificador con Estatus        │ Ejemplo de Sintaxis                             │ Interpretación y Extracción                             │ Uso principal                     │
 * ├────┼──────────────────────────────────┼─────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┼───────────────────────────────────┤
 * │ 1  │ Tag de Identidad con Arroba      │ "@tc-1=passed" o "Scenario: @tc-01"             │ Identidad: @tc-1 | Estatus: passed                     │ spec testrun, suite mark, testrun │
 * │ 2  │ Tag sin arroba (Bare Tag)        │ "tc-1=passed" o "Scenario: tc-01"               │ Identidad normalizada: @tc-1 | Estatus: passed          │ spec testrun, suite mark, testrun │
 * │ 3  │ Dirección Canónica Completa      │ "tests/features/bill.case.feature.@tc-1=failed" │ URI completa vinculada con su tag de identidad          │ spec testrun, suite mark, testrun │
 * │ 4  │ Basename Archivo + Tag           │ "bill_pay.case.feature.@tc-1=failed"            │ Archivo: bill_pay.case.feature | Tag: @tc-1             │ spec testrun, suite mark, testrun │
 * │ 5  │ Slug sin extensión + Tag         │ "bill_pay.@tc-1=passed"                         │ Slug: bill_pay | Tag: @tc-1                            │ spec testrun, suite mark, testrun │
 * │ 6  │ Nombre o Título de Escenario     │ "Pago con tarjeta=passed"                       │ Nombre: "Pago con tarjeta" | Estatus: passed            │ spec testrun, suite mark, testrun │
 * │ 7  │ Rule como Filtro de Directorio   │ "Rule: tests/features/ParaBank"                 │ Filtro de alcance estilo -test-directory para escenarios│ testrun suites, testplan          │
 * │ 8  │ Archivo Completo Implícito       │ "checkout.case.feature"                         │ Enlaza como bloque 'Rule: checkout.case.feature'        │ spec testrun add, suite link      │
 * └────┴──────────────────────────────────┴─────────────────────────────────────────────────┴─────────────────────────────────────────────────────────┴───────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * TABLA 3: INCLUSIÓN, EXCLUSIÓN Y FILTRADO (parsePatternFilter, matchesScenarioFilter)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * ┌────┬──────────────────────────────────┬─────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┬───────────────────────────────────┐
 * │ #  │ Estrategia de Selección          │ Ejemplo de CLI                                  │ Criterio de Coincidencia (Coincidence Match)            │ Uso principal                     │
 * ├────┼──────────────────────────────────┼─────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┼───────────────────────────────────┤
 * │ 1  │ Inclusión por Tag                │ -include=smoke o -include=@smoke                │ Coincidencia exacta o por subcadena sin @               │ spec testrun, suite testrun       │
 * │ 2  │ Inclusión por Feature Completo   │ -include="checkout.case.feature"                │ Incluye todos los escenarios del archivo .case.feature  │ spec testrun, suite testrun       │
 * │ 3  │ Inclusión + Exclusión Combinada  │ -include="order.case.feature" -exclude=wip      │ Incluye el feature pero omite escenarios con tag @wip   │ spec testrun, suite testrun       │
 * │ 4  │ Exclusión Pura (Global)          │ -exclude=manual o -exclude=wip,slow             │ Evalúa todos los casos y descarta los que coincidan     │ spec testrun, suite testrun       │
 * │ 5  │ Autocompletado Filtrado (-fill)  │ spec testrun -fill -target=@tr-4 -exclude=wip   │ Expande Rules vacías omitiendo los casos excluidos      │ spec testrun, suite fill          │
 * └────┴──────────────────────────────────┴─────────────────────────────────────────────────┴─────────────────────────────────────────────────────────┴───────────────────────────────────┘
 */

import { join, resolve, basename } from 'path';
import { IScope } from './types';
import { SCOPE_CONFIG, TESTCASE_STATUSES, TITLE_CLI } from './const';
import { Parser } from './parser';
import { Config } from './config';
import { VariableParser } from './variables';
import { Diag } from './diagnostics';
import { askSelect } from './prompt';
import { normalizeAddress } from './utils';

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

    const allTags = [
        ...(s.feature?.tags || []),
        ...(s.tags || []),
    ].map((t: any) => typeof t === 'string' ? t : t?.name || '');

    if (allTags.includes(cfg.tag)) {
        return true;
    }

    const prefix = scopeName === 'testcase' ? '@tc-'
        : scopeName === 'testrun' ? '@tr-'
        : scopeName === 'testplan' ? '@tp-'
        : scopeName === 'bug' ? '@bg-'
        : undefined;

    if (prefix && allTags.some(t => t.toLowerCase().startsWith(prefix))) {
        return true;
    }

    if (filePattern) {
        const fp = filePattern.trim();
        if (fp.startsWith('*') && uri.endsWith(fp.slice(1))) {
            return true;
        }
        if (uri === fp || uri.endsWith(`/${fp}`)) {
            return true;
        }
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
export function detectScopeFromTarget(target: string, config?: Config): IScope | undefined {
    const clean = target.trim().toLowerCase();
    const scopes: IScope[] = ['testplan', 'testrun', 'bug', 'testcase'];
    for (const scope of scopes) {
        if (clean === scope) return scope;
        const scopeCfg = (SCOPE_CONFIG as any)[scope];
        const ext = config ? config.getScopeExtension(scope) : scopeCfg?.ext;
        if (ext && (clean.endsWith(ext) || clean.includes(ext))) return scope;

        const idPattern = config ? config.getIdentity(scope) : (
            scope === 'testcase' ? 'tc-*' : scope === 'testrun' ? 'tr-*' : scope === 'testplan' ? 'tp-*' : 'bg-*'
        );
        const prefix = idPattern.split('*')[0].replace(/^@/, '').toLowerCase();
        if (prefix && (clean.startsWith(`@${prefix}`) || clean.includes(`.@${prefix}`) || clean.startsWith(prefix))) {
            return scope;
        }

        const tag = scopeCfg?.tag?.replace(/^@/, '').toLowerCase();
        if (tag && (clean.startsWith(`@${tag}`) || clean === tag)) {
            return scope;
        }
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

        const lowerIdentity = normIdentity.toLowerCase();
        const lowerT = normT.toLowerCase();

        // Strip trailing scenario/identity tag (e.g. .@tc-01, .@tr-1, .@tp-1) if present
        const lastDot = normIdentity.lastIndexOf('.');
        const cleanIdentity = (lastDot !== -1 && normIdentity.slice(lastDot).startsWith('.@'))
            ? normIdentity.slice(0, lastDot)
            : normIdentity;
        const lowerCleanIdentity = cleanIdentity.toLowerCase();

        // 1. Exact match on full identity or clean identity
        if (lowerIdentity === lowerT || lowerCleanIdentity === lowerT) {
            return true;
        }

        // 2. Identity tag matching (e.g. target is "@tr-4" or "tr-4" or "@tc-1" matching "@tc-01")
        if (lastDot !== -1 && normIdentity.slice(lastDot).startsWith('.@')) {
            const tagPart = normIdentity.slice(lastDot + 1).toLowerCase(); // e.g. "@tr-4"
            const normTagPart = tagPart.replace(/@?([a-z]+)-0*(\d+)/i, '$1-$2');
            const normLowerT = lowerT.replace(/@?([a-z]+)-0*(\d+)/i, '$1-$2');
            if (tagPart === lowerT || tagPart.replace(/^@/, '') === lowerT.replace(/^@/, '') || normTagPart === normLowerT) {
                return true;
            }
        }

        // 3. Target matches end of identity (e.g. "feature.@tc-01", ".@tc-01", "@tc-01", or "ParaBank/account_services.case.feature.@tc-1")
        const idNormTag = lowerIdentity.replace(/@([a-z]+)-0*(\d+)/i, '@$1-$2');
        const tNormTag = lowerT.replace(/@([a-z]+)-0*(\d+)/i, '@$1-$2');
        if (
            lowerIdentity.endsWith(`/${lowerT}`) ||
            lowerIdentity.endsWith(`.${lowerT}`) ||
            lowerIdentity.endsWith(lowerT) ||
            lowerCleanIdentity.endsWith(`/${lowerT}`) ||
            lowerCleanIdentity.endsWith(lowerT) ||
            idNormTag.endsWith(`/${tNormTag}`) ||
            idNormTag.endsWith(`.${tNormTag}`) ||
            idNormTag.endsWith(tNormTag)
        ) {
            return true;
        }

        // 4. Target matches path prefix or folder (e.g. target="testcycle" or target="testcase/ParaBank")
        if (
            lowerIdentity.startsWith(`${lowerT}.`) ||
            lowerIdentity.startsWith(`${lowerT}/`) ||
            lowerCleanIdentity.startsWith(`${lowerT}.`) ||
            lowerCleanIdentity.startsWith(`${lowerT}/`)
        ) {
            return true;
        }

        // 5. Basename matching (without path)
        const normBase = basename(cleanIdentity).replace(/(\.(case|run|plan))?\.feature$/i, '').toLowerCase();
        const normTarget = basename(normT).replace(/(\.(case|run|plan))?\.feature$/i, '').toLowerCase();
        const hasPath = normT.includes('/');

        if (!hasPath) {
            if (
                basename(cleanIdentity).toLowerCase() === lowerT ||
                basename(cleanIdentity).toLowerCase().replace(/(\.(case|run|plan))?\.feature$/i, '') === normTarget ||
                normBase === normTarget
            ) {
                return true;
            }
        }

        return false;
    });
}

/**
 * Resolves a single resource from state by selector expression, identity, or address.
 * Supports:
 * - Exact identity match
 * - Type-prefixed address (e.g. testcase.ParaBank/account_services.case.feature.@tc-1)
 * - Provider-prefixed address (e.g. github_testcase.ParaBank/account_services.case.feature.@tc-1)
 * - Scoped path suffix (e.g. ParaBank/account_services.case.feature.@tc-1)
 * - File basename + tag (e.g. account_services.case.feature.@tc-1)
 * - Identity tag (@tc-1 or tc-1 matching @tc-01)
 * - Slug / title / remoteId
 */
export function findResourceInState(resources: any[], target: string): any | undefined {
    if (!target || !Array.isArray(resources)) return undefined;
    const cleanTarget = target.trim();
    if (!cleanTarget) return undefined;

    // 1. Direct exact match (identity or type.identity)
    const exact = resources.find(r => 
        r && (
            r.identity === cleanTarget || 
            `${r.type}.${r.identity}` === cleanTarget
        )
    );
    if (exact) return exact;

    // 2. Normalized match with normalizeAddress
    const normClean = normalizeAddress(cleanTarget);
    const normMatched = resources.find(r => 
        r && (
            normalizeAddress(r.identity) === normClean ||
            normalizeAddress(`${r.type}.${r.identity}`) === normClean
        )
    );
    if (normMatched) return normMatched;

    // 3. Robust selector matching via matchesTarget
    const selectorMatched = resources.find(r => 
        r && (
            matchesTarget(r.identity, cleanTarget, r.type) ||
            matchesTarget(`${r.type}.${r.identity}`, cleanTarget, r.type)
        )
    );
    if (selectorMatched) return selectorMatched;

    // 4. Flexible suffix matching ignoring differences in root path (e.g. tests/features/)
    // or leading zero differences in @tc-01 vs @tc-1
    const normT = cleanTarget.replace(/\\/g, '/').replace(/^(?:[a-zA-Z0-9_-]+_)?(?:testcase|testrun|testplan|bug)\./i, '');
    const normTNormalizedTag = normT.replace(/@([a-z]+)-0*(\d+)/i, '@$1-$2').toLowerCase();

    const suffixMatched = resources.find(r => {
        if (!r || !r.identity) return false;
        const normId = r.identity.replace(/\\/g, '/').replace(/^(?:[a-zA-Z0-9_-]+_)?(?:testcase|testrun|testplan|bug)\./i, '');
        const normIdLower = normId.toLowerCase();
        const normTLower = normT.toLowerCase();

        if (normIdLower === normTLower || normIdLower.endsWith(`/${normTLower}`) || normTLower.endsWith(`/${normIdLower}`)) {
            return true;
        }

        const normIdNormalizedTag = normId.replace(/@([a-z]+)-0*(\d+)/i, '@$1-$2').toLowerCase();
        if (normIdNormalizedTag === normTNormalizedTag || normIdNormalizedTag.endsWith(`/${normTNormalizedTag}`) || normTNormalizedTag.endsWith(`/${normIdNormalizedTag}`)) {
            return true;
        }

        return false;
    });
    if (suffixMatched) return suffixMatched;

    // 5. Fallback: match by remoteId or issueNumber if selector is numeric or starts with '#'
    const numMatch = cleanTarget.replace(/^#/, '');
    if (/^\d+$/.test(numMatch)) {
        const idMatched = resources.find(r => 
            r && r.attributes && (
                String(r.attributes.issueNumber) === numMatch ||
                String(r.attributes.remoteId) === numMatch
            )
        );
        if (idMatched) return idMatched;
    }

    return undefined;
}

/**
 * Filters resources in state matching any of the given selectors.
 */
export function filterResourcesInState(resources: any[], selectors: string[]): any[] {
    if (!selectors || selectors.length === 0) return resources;
    return resources.filter(r => {
        if (!r) return false;
        const fullAddress = `${r.type}.${r.identity}`;
        return selectors.some(sel => {
            const cleanSel = sel.trim();
            if (!cleanSel) return false;
            return (
                r.identity === cleanSel ||
                fullAddress === cleanSel ||
                fullAddress.startsWith(cleanSel) ||
                r.identity.startsWith(cleanSel) ||
                normalizeAddress(r.identity) === normalizeAddress(cleanSel) ||
                normalizeAddress(fullAddress) === normalizeAddress(cleanSel) ||
                matchesTarget(r.identity, cleanSel, r.type) ||
                matchesTarget(fullAddress, cleanSel, r.type)
            );
        });
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
 * Normalizes a scenario reference under a Rule into a canonical testcase address or standard format.
 * Prevents path duplication when scenarioName is already canonical, file-tag, or slug-tag.
 * Supports all selector strategies from Table 1 and Table 2:
 *   1. tag: "@tc-01" -> "ruleName.@tc-01"
 *   2. tag-bare: "tc-01" -> "ruleName.@tc-01"
 *   3. canonical: "path/to/file.case.feature.@tc-01" -> "path/to/file.case.feature.@tc-01"
 *   4. file-tag: "file.case.feature.@tc-01" -> "path/to/file.case.feature.@tc-01"
 *   5. slug-tag: "file.@tc-01" -> "path/to/file.case.feature.@tc-01"
 *   6. name / title: "Scenario Title" -> "ruleName.Scenario Title"
 */
export function normalizeScenarioAddress(ruleName?: string, scenarioName?: string): string {
    if (!scenarioName) return ruleName || '';
    const cleanScenario = scenarioName.trim();
    if (!ruleName) {
        if (/^(?:tc|tr|tp|bg)-\d+$/i.test(cleanScenario)) {
            return `@${cleanScenario.toLowerCase()}`;
        }
        return cleanScenario;
    }

    const normRule = ruleName.trim().replace(/\\/g, '/');
    const normScenario = cleanScenario.replace(/\\/g, '/');

    // Case 1 & 2: Bare tag (tc-01) or @tag (@tc-01)
    const bareTagMatch = normScenario.match(/^@?([a-z0-9_-]+)$/i);
    if (bareTagMatch && /^(?:tc|tr|tp|bg)-\d+$/i.test(bareTagMatch[1])) {
        const atTag = `@${bareTagMatch[1].toLowerCase()}`;
        return `${normRule}.${atTag}`;
    }

    // Case 3: Already canonical address containing .feature or .case. or identical rule prefix
    if (normScenario.includes('.feature.@') || normScenario.includes('.feature.') || normScenario.startsWith(normRule)) {
        if (normScenario.startsWith(normRule)) {
            return normScenario;
        }
        const featMatch = normScenario.match(/^(.*?\.feature)\.(.*)$/i);
        if (featMatch) {
            const scFeat = featMatch[1];
            const scTail = featMatch[2];
            if (normRule.endsWith(scFeat) || basename(normRule) === basename(scFeat)) {
                return `${normRule}.${scTail.startsWith('@') ? scTail : (scTail.startsWith('tc-') ? '@' + scTail : scTail)}`;
            }
        }
        return normScenario;
    }

    // Case 4: File-tag, e.g. "bill_pay.case.feature.@tc-01" or "bill_pay.case.feature.tc-01"
    const fileTagMatch = normScenario.match(/^([a-zA-Z0-9_.-]+\.feature)\.(@?[a-zA-Z0-9_-]+)$/i);
    if (fileTagMatch) {
        const filePart = fileTagMatch[1];
        let tagPart = fileTagMatch[2];
        if (!tagPart.startsWith('@') && /^(?:tc|tr|tp|bg)-\d+$/i.test(tagPart)) {
            tagPart = `@${tagPart}`;
        }
        if (normRule.endsWith(filePart) || basename(normRule) === filePart) {
            return `${normRule}.${tagPart}`;
        }
        const joined = normRule.endsWith('/') ? `${normRule}${filePart}` : `${normRule}/${filePart}`;
        return `${joined}.${tagPart}`;
    }

    // Case 5: Slug-tag, e.g. "bill_pay.@tc-01" or "bill_pay.tc-01"
    const slugTagMatch = normScenario.match(/^([a-zA-Z0-9_-]+)\.(@?[a-zA-Z0-9_-]+)$/i);
    if (slugTagMatch && !slugTagMatch[1].includes('.')) {
        const slugPart = slugTagMatch[1];
        let tagPart = slugTagMatch[2];
        if (!tagPart.startsWith('@') && /^(?:tc|tr|tp|bg)-\d+$/i.test(tagPart)) {
            tagPart = `@${tagPart}`;
        }
        const ruleBase = basename(normRule).replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
        if (ruleBase.toLowerCase() === slugPart.toLowerCase()) {
            return `${normRule}.${tagPart}`;
        }
    }

    // Case 6: Title or generic scenario name under rule
    return `${normRule}.${normScenario}`;
}

/**
 * Checks whether a featurePart string matches a file path or URI.
 */
export function matchesFeatureFile(filePath: string, featurePart?: string): boolean {
    if (!featurePart) return true;
    const normFile = filePath.replace(/\\/g, '/');
    const normTarget = featurePart.replace(/\\/g, '/').replace(/\.feature$/i, '');
    const normalizedFile = normFile.replace(/\.feature$/i, '');
    const normalizedTarget = normTarget;

    return (
        normFile === normTarget ||
        normFile === featurePart ||
        normalizedFile === normalizedTarget ||
        normFile.endsWith(normTarget) ||
        normFile.endsWith('/' + normTarget) ||
        normFile.endsWith('/' + normTarget + '.feature') ||
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
    const config = new Config(workDir, false);

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
        const config = new Config(workDir, false);
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

/**
 * Matches a testrun resource in state against any selector from the selector matrix:
 * 1. Tag (@tr-1)
 * 2. Bare tag (tr-1)
 * 3. Canonical address (tests/runs/20261024.run.feature.@tr-1)
 * 4. File-tag (20261024.run.feature.@tr-1)
 * 5. Slug-tag (20261024.@tr-1)
 * 6. Title / Name (e.g. "Regresión Sprint 1")
 * 7. File path (tests/runs/20261024.run.feature)
 * 8. Basename (20261024.run.feature)
 * 9. Slug (20261024)
 */
export function matchesTestrunSelector(resource: any, selector: string): boolean {
    if (!resource || !selector) return false;
    const normSel = selector.trim().replace(/\\/g, '/');
    const lowerSel = normSel.toLowerCase();
    const normId = (resource.identity || '').replace(/\\/g, '/');
    const lowerId = normId.toLowerCase();

    // 1. Exact match on full identity
    if (lowerId === lowerSel) return true;

    // Extract parts from resource identity
    const lastDot = normId.lastIndexOf('.');
    const idPath = lastDot !== -1 ? normId.slice(0, lastDot) : normId;
    const idTag = lastDot !== -1 ? normId.slice(lastDot + 1).toLowerCase() : '';
    const cleanIdTag = idTag.replace(/^@/, '');
    const idBaseName = basename(idPath).toLowerCase();
    const idSlug = idBaseName.replace(/(\.(run|case|plan|bug))?\.feature$/i, '');

    // 2. Tag with @ or bare tag (e.g. "@tr-1" or "tr-1")
    const tagMatch = normSel.match(/^@?(tr-\d+)$/i);
    if (tagMatch) {
        const cleanSelTag = tagMatch[1].toLowerCase();
        if (cleanIdTag === cleanSelTag) return true;
        const resTags: string[] = (resource.attributes?.tags || []).map((t: any) =>
            typeof t === 'string' ? t.replace(/^@/, '').toLowerCase() : (t?.name || '').replace(/^@/, '').toLowerCase()
        );
        if (resTags.includes(cleanSelTag)) return true;
    }

    // 3. Title / Name match (case-insensitive)
    const title = (resource.attributes?.title || '').trim().toLowerCase();
    if (title && title === lowerSel) return true;

    // 4. File-tag (e.g. "20261024.run.feature.@tr-1" or "20261024.run.feature.tr-1")
    const fileTagMatch = normSel.match(/^([a-zA-Z0-9_.-]+\.feature)\.@?(tr-\d+)$/i);
    if (fileTagMatch) {
        const filePart = fileTagMatch[1].toLowerCase();
        const tagPart = fileTagMatch[2].toLowerCase();
        if (idBaseName === filePart && cleanIdTag === tagPart) return true;
    }

    // 5. Slug-tag (e.g. "20261024.@tr-1" or "20261024.tr-1")
    const slugTagMatch = normSel.match(/^([a-zA-Z0-9_-]+)\.@?(tr-\d+)$/i);
    if (slugTagMatch && !slugTagMatch[1].includes('.')) {
        const slugPart = slugTagMatch[1].toLowerCase();
        const tagPart = slugTagMatch[2].toLowerCase();
        if (idSlug === slugPart && cleanIdTag === tagPart) return true;
    }

    // 6. Path / Basename / Slug matches (without tag)
    const lowerIdPath = idPath.toLowerCase();
    if (
        lowerIdPath === lowerSel ||
        lowerIdPath.endsWith(`/${lowerSel}`) ||
        lowerIdPath.endsWith(`/${lowerSel}.run.feature`) ||
        lowerIdPath.endsWith(`/${lowerSel}.feature`) ||
        idBaseName === lowerSel ||
        idBaseName.replace(/(\.(run|case|plan|bug))?\.feature$/i, '') === lowerSel ||
        idSlug === lowerSel
    ) {
        return true;
    }

    return false;
}
