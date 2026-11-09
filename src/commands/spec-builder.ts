import { join, basename, dirname } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { bold, green, yellow, red } from 'chalk';
import { GherkinEditor, findNextIdentity } from '../core/editor';
import { Parser } from '../core/parser';
import { Config } from '../core/config';
import { Diag } from '../core/diagnostics';
import { VariableParser } from '../core/variables';
import { matchesScope, matchesFeatureFile, resolveTargetScenario } from '../core/selector';

export interface PatternFilter {
    filePattern?: string;
    tags: string[];
}

/**
 * Parses include/exclude patterns into structured filters:
 *   - "smoke" -> { filePattern: undefined, tags: ["@smoke"] }
 *   - "smoke, critical" -> [{ tags: ["@smoke"] }, { tags: ["@critical"] }]
 *   - "checkout.case.feature" -> { filePattern: "checkout.case.feature", tags: [] }
 *   - "checkout.case.feature:smoke" -> { filePattern: "checkout.case.feature", tags: ["@smoke"] }
 */
export function parsePatternFilter(input?: string | string[]): PatternFilter[] {
    if (!input) return [];
    const list = Array.isArray(input) ? input : [input];
    const filters: PatternFilter[] = [];

    for (const raw of list) {
        if (!raw) continue;
        const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
        for (const item of parts) {
            // 1. Colon separator for file:tag (checkout.case.feature:smoke)
            if (item.includes(':')) {
                const parts = item.split(':');
                const filePattern = parts[0].trim();
                const rawTags = parts.slice(1).join(':').split(',').map(t => t.trim()).filter(Boolean);
                const tags = rawTags.map(t => t.startsWith('@') ? t : `@${t}`);
                filters.push({ filePattern, tags });
                continue;
            }

            // 2. Feature file pattern without tags
            if (item.endsWith('.feature') || item.includes('.case.') || item.includes('.run.') || item.includes('/') || item.includes('\\')) {
                filters.push({ filePattern: item, tags: [] });
                continue;
            }

            // 3. Tag name (smoke, @smoke, "one tag")
            const clean = item.replace(/^\[+|\]+$/g, '');
            const tag = clean.startsWith('@') ? clean : `@${clean}`;
            filters.push({ filePattern: undefined, tags: [tag] });
        }
    }

    return filters;
}

export function matchesScenarioFilter(scenario: any, filter: PatternFilter): boolean {
    if (filter.filePattern) {
        if (!matchesFeatureFile(scenario.uri, filter.filePattern)) {
            return false;
        }
    }
    if (filter.tags.length > 0) {
        const cleanTerms = filter.tags.map(t => t.replace(/^@/, '').toLowerCase().trim()).filter(Boolean);
        const scenarioTags: string[] = [
            ...(scenario.tags || []),
            ...(scenario.feature?.tags || [])
        ].map((t: any) => {
            if (typeof t === 'string') return t;
            return t?.name || t?.value || String(t);
        }).map(t => t.replace(/^@/, '').toLowerCase().trim());

        const hasCoincidence = cleanTerms.some(term =>
            scenarioTags.some(st => st === term || st.includes(term) || term.includes(st))
        );
        if (!hasCoincidence) {
            return false;
        }
    }
    return true;
}

/**
 * Autocompletes empty Rule blocks in a target testrun with scenarios from matching .case.feature files.
 */
export async function runAutocomplete(options: {
    dir: string;
    target?: string;
    testDirectory?: string;
    variables?: VariableParser;
    include?: string | string[];
    exclude?: string | string[];
}) {
    const { dir, target, testDirectory, variables, include, exclude } = options;
    if (!target) {
        Diag.error({
            title: 'Missing target testrun file.',
            detail: ['Specify the testrun to autocomplete using -target=<@tr-N|file>.'],
        }).abort();
        return;
    }

    const { absolutePath: absoluteRunPath } = await resolveTargetScenario(
        target,
        dir,
        'testrun',
        testDirectory,
        variables
    );

    // Read the target .run.feature file
    const doc = GherkinEditor.parseRawDocument(absoluteRunPath);
    if (!doc.feature) {
        Diag.error({
            title: `Invalid feature file: ${target}`,
            detail: ['The file does not contain a valid Gherkin Feature definition.'],
        }).abort();
        return;
    }

    const ruleChildren = (doc.feature.children || []).filter((c: any) => c.rule);
    if (ruleChildren.length === 0) {
        Diag.error({
            title: `No Rule blocks found in ${target}.`,
            detail: [
                `Autocomplete requires at least one 'Rule: <source.case.feature>' in the file.`,
                `Example:`,
                `  Rule: checkout.case.feature`,
            ],
        }).abort();
        return;
    }

    const searchDir = testDirectory ? join(dir, testDirectory) : dir;
    const caseParser = new Parser(searchDir, variables);
    const caseDocs = caseParser.content() || [];
    const allCases = caseDocs.filter(s => matchesScope(s, 'testcase'));
    const allCaseFiles = Array.from(new Set(allCases.map(s => s.uri)));

    let expandedCount = 0;

    const includeFilters = parsePatternFilter(include);
    const excludeFilters = parsePatternFilter(exclude);

    for (const child of ruleChildren) {
        const rule = child?.rule;
        if (!rule) continue;

        const ruleName: string = typeof rule === 'string' ? rule : (rule.name || '');

        // If Rule already has explicit scenarios → skip (respect manual control)
        const ruleChildrenNodes = typeof rule === 'object' && rule.children ? rule.children : [];
        const ruleScenarios = ruleChildrenNodes.filter((c: any) => c.scenario);
        if (ruleScenarios.length > 0) {
            console.log(`  ${yellow('~')} Rule '${ruleName}': already has ${ruleScenarios.length} explicit scenario(s). Skipping.`);
            continue;
        }

        // Find the .case.feature referenced by this Rule
        const normalized = ruleName.replace(/\.feature$/i, '');
        const matchingFile = allCaseFiles.find(f => {
            return (
                f === ruleName ||
                f.replace(/\.feature$/i, '') === normalized ||
                basename(f).replace(/\.feature$/i, '') === normalized ||
                f.endsWith('/' + ruleName) ||
                f.endsWith('/' + ruleName + '.feature')
            );
        });

        if (!matchingFile) {
            console.log(`  ${red('!')} Rule '${ruleName}': source file not found in workspace. Skipping.`);
            continue;
        }

        const caseScenarios = allCases.filter(s => s.uri === matchingFile);

        if (caseScenarios.length === 0) {
            console.log(`  ${red('!')} Rule '${ruleName}': no scenarios parsed from source file. Skipping.`);
            continue;
        }

        // Build testcases list: "ruleName.scenarioIdentity"
        const config = new Config(dir, false);
        const caseData = { identity: config.getIdentity('testcase'), fields: config.getFields('testcase') };
        let filteredCases = caseParser.filter(caseScenarios, caseData, 'testcase') || [];

        // Apply include and exclude criteria
        if (includeFilters.length > 0 || excludeFilters.length > 0) {
            filteredCases = filteredCases.filter((s: any) => {
                const isInc = includeFilters.length === 0 || includeFilters.some(f => matchesScenarioFilter(s, f));
                const isExc = excludeFilters.length > 0 && excludeFilters.some(f => matchesScenarioFilter(s, f));
                return isInc && !isExc;
            });
        }

        const testcases = filteredCases.map((s: any) => {
            const id = s.custom?.identity || s.name;
            return `${ruleName}.${id}`;
        });

        GherkinEditor.expandScenarios(absoluteRunPath, testcases, 'pending');
        console.log(`  ${green('✓')} Rule '${ruleName}': expanded ${testcases.length} scenario(s).`);
        expandedCount += testcases.length;
    }

    if (expandedCount === 0) {
        console.log('No scenarios were expanded. All Rules already have explicit scenarios or source files were not found.');
    } else {
        console.log(green(bold(`\nAutocomplete complete! ${expandedCount} scenario(s) expanded.`)));
    }
}

/**
 * Generates a new .run.feature file based on include and exclude criteria.
 */
export async function runTagsSuite(options: {
    dir: string;
    include?: string | string[];
    exclude?: string | string[];
    title?: string;
    testDirectory?: string;
    variables?: VariableParser;
}) {
    const { dir, include, exclude, title, testDirectory, variables } = options;
    const searchDir = testDirectory ? join(dir, testDirectory) : dir;
    const config = new Config(dir, false);

    if (!include && !exclude) {
        Diag.error({
            title: `No testcases specified to include or exclude.`,
            detail: [
                `Specify criteria using -include=<tag|file> and optional -exclude=<tag|file>`,
                `Examples:`,
                `  -include=smoke`,
                `  -include="checkout.case.feature" -exclude=wip`,
                `  -exclude=manual`,
            ]
        }).abort();
        return;
    }

    const includeFilters = parsePatternFilter(include);
    const excludeFilters = parsePatternFilter(exclude);

    // Load all testcases
    const parser = new Parser(searchDir, variables);
    const documents = parser.content() || [];
    const allCases = documents.filter(s => matchesScope(s, 'testcase'));

    // Filter scenarios that match inclusion and do NOT match exclusion
    const matchedScenarios = allCases.filter(s => {
        const isInc = includeFilters.length === 0 || includeFilters.some(f => matchesScenarioFilter(s, f));
        const isExc = excludeFilters.length > 0 && excludeFilters.some(f => matchesScenarioFilter(s, f));
        return isInc && !isExc;
    });

    if (matchedScenarios.length === 0) {
        Diag.error({
            title: `No testcase scenarios found matching criteria (include: ${include || 'all'}, exclude: ${exclude || 'none'}).`,
            detail: [
                testDirectory ? `Search scope limited to: ${testDirectory}` : `Searched across entire workspace.`,
                `Total testcases evaluated: ${allCases.length}`,
                `Hint: Verify tags in your .case.feature files or adjust -test-directory.`
            ].filter(Boolean)
        }).abort();
        return;
    }

    // Group scenarios by source feature file URI
    const grouped = new Map<string, typeof matchedScenarios>();
    for (const s of matchedScenarios) {
        const fileKey = s.uri;
        if (!grouped.has(fileKey)) {
            grouped.set(fileKey, []);
        }
        grouped.get(fileKey)!.push(s);
    }

    // Determine filename and directory using convention
    const convention = config.getConvention('testrun');
    const scopeConf = config.getScopeConf('testrun');
    const identityPattern = config.getIdentity('testrun');
    const outDir = convention?.directory || scopeConf?.directory || 'tests/runs';
    const fileTpl = convention?.filename || `{YYYYMMDD}_{HHmmss}.run.feature`;

    const now = new Date();
    const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
    const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const timestamp = now.getTime().toString();
    const allIncludeTags = includeFilters.flatMap(f => f.tags);
    const cleanTagSlug = allIncludeTags.map(t => t.replace('@', '')).join('_').toLowerCase();

    let slug = 'run';
    const firstFile = includeFilters.find(f => f.filePattern)?.filePattern;
    if (firstFile) {
        const baseName = basename(firstFile).replace(/\.feature$/i, '').replace(/\.case$/i, '');
        slug = cleanTagSlug ? `${baseName}_${cleanTagSlug}` : baseName;
    } else if (cleanTagSlug) {
        slug = cleanTagSlug;
    }

    const filename = fileTpl
        .replace('{YYYYMMDD}', YYYYMMDD)
        .replace('{HHmmss}', HHmmss)
        .replace('{timestamp}', timestamp)
        .replace('{slug}', slug);

    const generatedTitle = title || (slug !== 'run' ? `Test Run ${slug}` : `Test Run ${YYYYMMDD}_${HHmmss}`);
    const fullPath = join(dir, outDir, filename);
    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
    }

    const nextIdentityTag = identityPattern ? findNextIdentity(dir, identityPattern) : null;

    let content = `@testrun`;
    if (nextIdentityTag) {
        content += ` ${nextIdentityTag}`;
    }
    content += `\nFeature: ${generatedTitle}\n\n`;

    let totalCases = 0;
    for (const [fileUri, scenarios] of grouped.entries()) {
        const ruleName = basename(fileUri);
        content += `  Rule: ${ruleName}\n`;
        for (const sc of scenarios) {
            const scName = sc.name || 'Unnamed Scenario';
            content += `    Scenario: ${scName}\n`;
            content += `      * set status = pending\n\n`;
            totalCases++;
        }
    }

    writeFileSync(fullPath, content.trim() + '\n', 'utf-8');

    console.log(green(bold(`\nGenerated testrun specification file: ${fullPath}`)));
    console.log(`  ${green('✓')} Included ${totalCases} scenario(s) matching criteria across ${grouped.size} file(s).`);
}
