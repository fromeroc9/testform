import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { IScope, ParserScenario } from '../core/types';
import { PolicyRule } from './types';
import { CONFIG_FILE_NAMES } from '../core/const';

export interface FeatureFileInfo {
    absPath: string;
    relPath: string; // forward-slash normalized relative path to rootDir
    fileName: string; // e.g. "products.case.feature"
    content?: string;
}

/**
 * Finds the project workspace root by locating main.yml / testform.yml / package.json.
 */
export function findProjectRoot(startUri?: string): string {
    const candidateDirs: string[] = [];
    if (startUri) {
        candidateDirs.push(dirname(resolve(startUri)));
    }
    candidateDirs.push(process.cwd());

    for (const start of candidateDirs) {
        let curr = start;
        while (curr) {
            for (const cfg of [...CONFIG_FILE_NAMES, 'package.json']) {
                if (existsSync(join(curr, cfg))) {
                    return curr;
                }
            }
            const parent = dirname(curr);
            if (parent === curr) break;
            curr = parent;
        }
    }
    return process.cwd();
}

/**
 * Scans the project workspace and returns an array of all feature files found.
 */
export function scanProjectFeatureFiles(rootDir: string): FeatureFileInfo[] {
    const results: FeatureFileInfo[] = [];
    const IGNORED = new Set([
        'node_modules',
        '.git',
        '.testform',
        '.terraform',
        'dist',
        'coverage',
        '.system_generated',
        '.next',
        '.cache',
    ]);

    function walk(dir: string) {
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.feature')) {
                    const normRel = fullPath.replace(rootDir, '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
                    results.push({
                        absPath: fullPath,
                        relPath: normRel,
                        fileName: entry.name,
                    });
                }
            }
        } catch {
            // Ignore unreadable dirs
        }
    }

    walk(rootDir);
    return results;
}

/**
 * Tries to resolve a referenced path or filename to a concrete feature file in the workspace.
 */
export function resolveFeatureFile(
    ref: string,
    rootDir: string,
    allFeatures: FeatureFileInfo[],
    fromUri?: string
): FeatureFileInfo | undefined {
    if (!ref || typeof ref !== 'string') return undefined;
    const cleanRef = ref.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!cleanRef) return undefined;

    // 1. Direct path from project root
    const absDirect = resolve(rootDir, cleanRef);
    if (existsSync(absDirect) && statSync(absDirect).isFile()) {
        const found = allFeatures.find(f => f.absPath === absDirect);
        if (found) return found;
        return {
            absPath: absDirect,
            relPath: cleanRef,
            fileName: basename(absDirect),
        };
    }

    // 2. Relative to the referencing file (fromUri)
    if (fromUri) {
        const fromDir = dirname(resolve(rootDir, fromUri));
        const absFrom = resolve(fromDir, cleanRef);
        if (existsSync(absFrom) && statSync(absFrom).isFile()) {
            const found = allFeatures.find(f => f.absPath === absFrom);
            if (found) return found;
            return {
                absPath: absFrom,
                relPath: absFrom.replace(rootDir, '').replace(/^[\\/]+/, '').replace(/\\/g, '/'),
                fileName: basename(absFrom),
            };
        }
    }

    // 3. Common subdirectories (testcase, testcases, testruns, testcycle, testplans, bugs)
    const COMMON_DIRS = ['testcase', 'testcases', 'tests', 'tests/cases', 'testruns', 'testcycle', 'testplans', 'bugs'];
    for (const sub of COMMON_DIRS) {
        const absSub = resolve(rootDir, sub, cleanRef);
        if (existsSync(absSub) && statSync(absSub).isFile()) {
            const found = allFeatures.find(f => f.absPath === absSub);
            if (found) return found;
            return {
                absPath: absSub,
                relPath: absSub.replace(rootDir, '').replace(/^[\\/]+/, '').replace(/\\/g, '/'),
                fileName: basename(absSub),
            };
        }
    }

    // 4. Match among allFeatures by relative path suffix or filename
    const lowerRef = cleanRef.toLowerCase();
    const baseRef = basename(lowerRef);

    // Exact or suffix relative path match
    const byRel = allFeatures.find(f => {
        const lowerRel = f.relPath.toLowerCase();
        return lowerRel === lowerRef || lowerRel.endsWith(`/${lowerRef}`);
    });
    if (byRel) return byRel;

    // Match by basename (e.g. "products.case.feature")
    const byBase = allFeatures.find(f => f.fileName.toLowerCase() === baseRef);
    if (byBase) return byBase;

    // Match by slug/prefix before generated random hash suffix (e.g. "SauceDemo-20260612_120002" matching "SauceDemo-20260612_120002_gp1yim.run.feature")
    const cleanPrefix = baseRef.replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
    const byPrefix = allFeatures.find(f => {
        const fClean = f.fileName.toLowerCase().replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
        return fClean === cleanPrefix || fClean.startsWith(`${cleanPrefix}_`) || cleanPrefix.startsWith(`${fClean}_`);
    });
    if (byPrefix) return byPrefix;

    // Match by base name without .feature extension if extension was omitted
    if (!baseRef.endsWith('.feature')) {
        const byBaseWithoutExt = allFeatures.find(f =>
            f.fileName.toLowerCase().replace(/\.(case|run|plan|bug)?\.feature$/i, '') === baseRef
        );
        if (byBaseWithoutExt) return byBaseWithoutExt;
    }

    return undefined;
}

/**
 * Checks if a specific scenario (by identity tag, title, or wildcard) exists in a feature file.
 */
export function scenarioExistsInFeature(feature: FeatureFileInfo, scenarioRef: string): boolean {
    if (!scenarioRef || scenarioRef.trim() === '*' || scenarioRef.trim() === '') {
        return true;
    }

    if (!feature.content) {
        try {
            feature.content = readFileSync(feature.absPath, 'utf-8');
        } catch {
            return false;
        }
    }

    const trimmed = scenarioRef.trim();

    // Check if target is an identity tag (e.g. "@tc-01" or "@tc-02")
    if (trimmed.startsWith('@')) {
        const tagPattern = new RegExp(`(?:^|\\s)${escapeRegex(trimmed)}(?:\\s|$)`, 'm');
        if (tagPattern.test(feature.content)) return true;

        // Also check if tag matches without leading zero (e.g. @tc-1 vs @tc-01)
        const match = trimmed.match(/^@([a-zA-Z]+)-0*(\d+)$/);
        if (match) {
            const altTag = `@${match[1]}-${parseInt(match[2], 10)}`;
            const altPattern = new RegExp(`(?:^|\\s)${escapeRegex(altTag)}(?:\\s|$)`, 'm');
            if (altPattern.test(feature.content)) return true;
        }
    }

    // Check scenario title: "Scenario: <name>" or "Scenario Outline: <name>" or Spanish
    const lowerRef = trimmed.toLowerCase();
    const lines = feature.content.split(/\r?\n/);
    for (const line of lines) {
        const scMatch = line.match(/^\s*(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
        if (scMatch) {
            const title = scMatch[1].trim();
            if (title.toLowerCase() === lowerRef || title.toLowerCase().includes(lowerRef)) {
                return true;
            }
            // If the line has tags like "@tc-01 Scenario: ..."
            if (title.startsWith('@') && trimmed.startsWith('@')) {
                const parts = title.split(/\s+/);
                if (parts.some(p => p.toLowerCase() === lowerRef)) return true;
            }
        }
        // Also check standalone tag line preceding a scenario
        if (trimmed.startsWith('@') && line.includes(trimmed)) {
            return true;
        }
    }

    return false;
}

/**
 * Checks if an attachment file exists on disk.
 */
export function resolveAttachment(attachPath: string, rootDir: string, fromUri?: string): boolean {
    if (!attachPath || typeof attachPath !== 'string') return false;
    const clean = attachPath.trim().replace(/\\/g, '/');
    if (!clean) return false;

    // 1. Direct from root
    if (existsSync(resolve(rootDir, clean))) return true;

    // 2. Relative to bug file
    if (fromUri) {
        const fromDir = dirname(resolve(rootDir, fromUri));
        if (existsSync(resolve(fromDir, clean))) return true;
    }

    // 3. In attachments/ or attachments/bugs/
    if (existsSync(resolve(rootDir, 'attachments', clean))) return true;
    if (existsSync(resolve(rootDir, 'attachments', 'bugs', basename(clean)))) return true;
    if (existsSync(resolve(rootDir, 'attachments', basename(clean)))) return true;

    return false;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Policy Action: Validates that testruns referenced in testplan Rules exist in the project.
 */
export function testplanPathIntegrityAction(
    scenarios: ParserScenario[],
    rules: PolicyRule[],
    _scope: IScope
): void {
    if (!scenarios || scenarios.length === 0) return;
    const rootDir = findProjectRoot(scenarios[0]?.uri);
    const allFeatures = scanProjectFeatureFiles(rootDir);

    for (const scenario of scenarios) {
        const testruns = scenario.custom?.testruns || [];
        for (const trRef of testruns) {
            if (!trRef || trRef.trim() === '') continue;

            const trimmed = trRef.trim();
            const found = resolveFeatureFile(trimmed, rootDir, allFeatures, scenario.uri);

            if (!found) {
                // If it's an identity tag like @tr-20, check if any feature declares it
                let foundByTag = false;
                if (trimmed.startsWith('@')) {
                    for (const f of allFeatures) {
                        if (!f.content) {
                            try { f.content = readFileSync(f.absPath, 'utf-8'); } catch { continue; }
                        }
                        if (new RegExp(`(?:^|\\s)${escapeRegex(trimmed)}(?:\\s|$)`, 'm').test(f.content)) {
                            foundByTag = true;
                            break;
                        }
                    }
                }

                if (!foundByTag) {
                    rules.push({
                        id: "testplan-path-integrity",
                        type: 'error',
                        title: `Referenced testrun not found: "${trimmed}"`,
                        detail: `The testrun "${trimmed}" declared in Rule does not exist in the project. Check the path and file name.`,
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location,
                    });
                }
            }
        }
    }
}

/**
 * Policy Action: Validates that testcase files and scenarios referenced in testrun Rules exist in the project.
 */
export function testrunPathIntegrityAction(
    scenarios: ParserScenario[],
    rules: PolicyRule[],
    _scope: IScope
): void {
    if (!scenarios || scenarios.length === 0) return;
    const rootDir = findProjectRoot(scenarios[0]?.uri);
    const allFeatures = scanProjectFeatureFiles(rootDir);

    for (const scenario of scenarios) {
        const groupScenarios = scenario.custom?.groupScenarios || [];

        // If groupScenarios is empty, check custom.testcases (fallback)
        if (groupScenarios.length === 0 && Array.isArray(scenario.custom?.testcases)) {
            for (const tcAddr of scenario.custom.testcases) {
                const parts = String(tcAddr).split('.');
                const rulePart = parts[0];
                const found = resolveFeatureFile(rulePart, rootDir, allFeatures, scenario.uri);
                if (!found) {
                    rules.push({
                        id: "testrun-path-integrity",
                        type: 'error',
                        title: `Referenced testcase file not found: "${rulePart}"`,
                        detail: `The testcase feature file "${rulePart}" declared in Rule could not be resolved in the workspace.`,
                        uri: scenario.uri,
                        line: scenario.location,
                    });
                }
            }
            continue;
        }

        // Group by Rule name to avoid duplicate file errors
        const ruleMap = new Map<string, Array<{ name: string; location?: number }>>();
        for (const gs of groupScenarios) {
            const ruleName = gs.rule?.name?.trim();
            if (!ruleName) continue;
            if (!ruleMap.has(ruleName)) {
                ruleMap.set(ruleName, []);
            }
            ruleMap.get(ruleName)!.push({ name: gs.name, location: gs.location });
        }

        for (const [ruleName, entries] of ruleMap.entries()) {
            const feature = resolveFeatureFile(ruleName, rootDir, allFeatures, scenario.uri);
            if (!feature) {
                rules.push({
                    id: "testrun-path-integrity",
                    type: 'error',
                    title: `Referenced testcase file not found: "${ruleName}"`,
                    detail: `The testcase feature file "${ruleName}" declared in Rule does not exist in the project. Check the path and file name.`,
                    uri: scenario.uri,
                    line: entries[0]?.location || scenario.location,
                });
                continue;
            }

            // Feature file exists; now validate each referenced scenario inside it
            for (const entry of entries) {
                const scenName = entry.name?.trim();
                if (!scenName || scenName === '*') continue;

                const exists = scenarioExistsInFeature(feature, scenName);
                if (!exists) {
                    rules.push({
                        id: "testrun-path-integrity",
                        type: 'error',
                        title: `Scenario "${scenName}" not found in "${ruleName}"`,
                        detail: `Scenario with identity or name "${scenName}" was not found in testcase file "${ruleName}".`,
                        uri: scenario.uri,
                        line: entry.location || scenario.location,
                    });
                }
            }
        }
    }
}

/**
 * Policy Action: Validates that target testcases, linked testruns, and attachments in bug specifications exist.
 */
export function bugPathIntegrityAction(
    scenarios: ParserScenario[],
    rules: PolicyRule[],
    _scope: IScope
): void {
    if (!scenarios || scenarios.length === 0) return;
    const rootDir = findProjectRoot(scenarios[0]?.uri);
    const allFeatures = scanProjectFeatureFiles(rootDir);

    for (const scenario of scenarios) {
        // 1. Target testcase validation
        const targetRaw = scenario.custom?.fields?.target ||
            (scenario.tags || []).find(t => t.startsWith('@tc-'));

        if (targetRaw && typeof targetRaw === 'string') {
            const target = targetRaw.trim();
            if (target.includes('.case.feature') || target.includes('.feature') || target.includes('/') || target.includes('\\')) {
                // Address format: e.g. "testcase/SauceDemo/products.case.feature.@tc-01" or "products.case.feature"
                let targetFile = target;
                let targetTag = '';

                if (target.includes('.@')) {
                    const dotAt = target.lastIndexOf('.@');
                    targetFile = target.substring(0, dotAt).trim();
                    targetTag = '@' + target.substring(dotAt + 2).trim();
                } else if (target.includes('@')) {
                    const atIdx = target.lastIndexOf('@');
                    targetFile = target.substring(0, atIdx).replace(/\.$/, '').trim();
                    targetTag = target.substring(atIdx).trim();
                }

                const feature = resolveFeatureFile(targetFile, rootDir, allFeatures, scenario.uri);
                if (!feature) {
                    rules.push({
                        id: "bug-path-integrity",
                        type: 'error',
                        title: `Referenced target testcase file not found: "${targetFile}"`,
                        detail: `The target file "${targetFile}" referenced in bug does not exist in the project.`,
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location,
                    });
                } else if (targetTag) {
                    const tagExists = scenarioExistsInFeature(feature, targetTag);
                    if (!tagExists) {
                        rules.push({
                            id: "bug-path-integrity",
                            type: 'error',
                            title: `Target identity "${targetTag}" not found in "${targetFile}"`,
                            detail: `Target tag "${targetTag}" was not found inside testcase file "${targetFile}".`,
                            uri: scenario.uri,
                            scenario: scenario.name,
                            line: scenario.location,
                        });
                    }
                }
            } else if (target.startsWith('@')) {
                // Only tag given (e.g. "@tc-01") -> check if ANY feature file has this tag
                let foundAny = false;
                for (const f of allFeatures) {
                    if (scenarioExistsInFeature(f, target)) {
                        foundAny = true;
                        break;
                    }
                }
                if (!foundAny) {
                    rules.push({
                        id: "bug-path-integrity",
                        type: 'error',
                        title: `Target testcase identity not found: "${target}"`,
                        detail: `The testcase identity "${target}" does not match any scenario in the workspace.`,
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location,
                    });
                }
            }
        }

        // 2. Linked testrun validation
        const runRaw = scenario.custom?.fields?.run ||
            (scenario.feature?.name && (scenario.feature.name.includes('.run.feature') || scenario.feature.name.startsWith('testcycle/') || scenario.feature.name.startsWith('testruns/')) ? scenario.feature.name : undefined) ||
            (scenario.tags || []).find(t => t.startsWith('@tr-')) ||
            (scenario.feature?.tags || []).find(t => t.startsWith('@tr-'));

        if (runRaw && typeof runRaw === 'string') {
            const runRef = runRaw.trim();
            const runFound = resolveFeatureFile(runRef, rootDir, allFeatures, scenario.uri);
            if (!runFound) {
                let foundByTag = false;
                if (runRef.startsWith('@')) {
                    for (const f of allFeatures) {
                        if (scenarioExistsInFeature(f, runRef)) {
                            foundByTag = true;
                            break;
                        }
                    }
                }
                if (!foundByTag) {
                    rules.push({
                        id: "bug-path-integrity",
                        type: 'error',
                        title: `Referenced testrun not found for bug: "${runRef}"`,
                        detail: `The testrun "${runRef}" referenced by this bug could not be found in the workspace.`,
                        uri: scenario.uri,
                        scenario: scenario.name,
                        line: scenario.location,
                    });
                }
            }
        }

        // 3. Attachment validation
        const attachRaw = scenario.custom?.fields?.attach;
        if (attachRaw) {
            const attachList = Array.isArray(attachRaw) ? attachRaw : [attachRaw];
            for (const att of attachList) {
                if (typeof att === 'string' && att.trim()) {
                    const exists = resolveAttachment(att.trim(), rootDir, scenario.uri);
                    if (!exists) {
                        rules.push({
                            id: "bug-path-integrity",
                            type: 'warning',
                            title: `Attachment file not found: "${att.trim()}"`,
                            detail: `The attachment file "${att.trim()}" does not exist on disk.`,
                            uri: scenario.uri,
                            scenario: scenario.name,
                            line: scenario.location,
                        });
                    }
                }
            }
        }
    }
}
