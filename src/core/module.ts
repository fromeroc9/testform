import { resolve, dirname } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { Parser as Parse, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { ParserStep } from './types';

export interface ModuleTarget {
    source: string;
    scenario?: string; // Optional: e.g. "@tc-1" or "Login con credenciales"
}

/**
 * Parses @module tags at Feature or Scenario level with optional scenario selection.
 * Examples:
 *   @module(source="./auth.case.feature")
 *   @module(source="./auth.case.feature",scenario="@tc-1")
 *   @module(source="./auth.case.feature",id="@tc-1")
 *   @module(source="./auth.case.feature::@tc-1")
 *   @module("./auth.case.feature::@tc-1")
 *   @module(source=["./m1.feature::@tc-1","./m2.feature"])
 */
export function parseModuleTargets(tag: string): ModuleTarget[] | null {
    if (!tag.startsWith('@module')) return null;

    // Check for named scenario/id parameter: scenario="..." or id="..."
    const scenarioArgMatch = tag.match(/[,;]\s*(?:scenario|id)=['"]([^'"]+)['"]/i);
    const scenarioArg = scenarioArgMatch ? scenarioArgMatch[1].trim() : undefined;

    // 1. Array format: @module(source=["...", "..."])
    const arrayMatch = tag.match(/@module\(source=\[([^\]]+)\]/i);
    if (arrayMatch) {
        return arrayMatch[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
            .map(item => {
                if (item.includes('::')) {
                    const [src, sc] = item.split('::');
                    return { source: src.trim(), scenario: sc.trim() };
                }
                return { source: item, scenario: scenarioArg };
            });
    }

    // 2. Single source: @module(source="...") or @module(source='...')
    const singleMatch = tag.match(/@module\(source=['"]([^'"]+)['"]/i);
    if (singleMatch) {
        let src = singleMatch[1].trim();
        let sc = scenarioArg;
        if (src.includes('::')) {
            const parts = src.split('::');
            src = parts[0].trim();
            sc = parts[1].trim();
        }
        return [{ source: src, scenario: sc }];
    }

    // 3. Shorthand: @module("...")
    const directMatch = tag.match(/@module\(['"]([^'"]+)['"]/i);
    if (directMatch) {
        let src = directMatch[1].trim();
        let sc = scenarioArg;
        if (src.includes('::')) {
            const parts = src.split('::');
            src = parts[0].trim();
            sc = parts[1].trim();
        }
        return [{ source: src, scenario: sc }];
    }

    return null;
}

/** Backward compatibility helper */
export function parseModuleTag(tag: string): string[] | null {
    const targets = parseModuleTargets(tag);
    if (!targets) return null;
    return targets.map(t => t.scenario ? `${t.source}::${t.scenario}` : t.source);
}

/**
 * Resolves a module file path relative to the current feature file's directory or workspace.
 */
export function resolveModulePath(currentFilePath: string, sourcePath: string, workspaceRoot: string = process.cwd()): string | null {
    // 1. Try relative to current feature file
    const relToFeature = resolve(dirname(currentFilePath), sourcePath);
    if (existsSync(relToFeature) && statSync(relToFeature).isFile()) {
        return relToFeature;
    }

    // 2. Try relative to workspace root
    const relToRoot = resolve(workspaceRoot, sourcePath);
    if (existsSync(relToRoot) && statSync(relToRoot).isFile()) {
        return relToRoot;
    }

    return null;
}

/**
 * Reads and parses steps from a module feature file for scenario-level composition.
 * If targetScenario is specified, only steps from that scenario (plus background) are loaded.
 */
export function loadModuleSteps(moduleFilePath: string, targetScenario?: string): ParserStep[] {
    try {
        const content = readFileSync(moduleFilePath, 'utf-8');
        const parser = new Parse(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
        const doc = parser.parse(content);
        const steps: ParserStep[] = [];

        if (doc.feature) {
            const bgSteps: ParserStep[] = [];
            for (const child of doc.feature.children || []) {
                if (child.background) {
                    for (const s of child.background.steps || []) {
                        bgSteps.push({ keyword: s.keyword, keywordType: s.keywordType, text: s.text });
                    }
                }
            }

            for (const child of doc.feature.children || []) {
                if (child.scenario) {
                    const s = child.scenario;
                    if (targetScenario) {
                        const targetNorm = targetScenario.toLowerCase().trim();
                        const targetNoAt = targetNorm.startsWith('@') ? targetNorm.slice(1) : targetNorm;
                        const scenarioTags = (s.tags || []).map((t: any) => t.name.toLowerCase().trim());
                        const hasMatchingTag = scenarioTags.some(t => t === targetNorm || t === `@${targetNoAt}` || t === targetNoAt);
                        const hasMatchingName = s.name.toLowerCase().trim() === targetNorm;

                        if (!hasMatchingTag && !hasMatchingName) {
                            continue;
                        }
                    }

                    if (steps.length === 0 && bgSteps.length > 0) {
                        steps.push(...bgSteps);
                    }
                    for (const step of s.steps || []) {
                        steps.push({ keyword: step.keyword, keywordType: step.keywordType, text: step.text });
                    }

                    if (targetScenario) break;
                }
            }
        }
        return steps;
    } catch {
        return [];
    }
}
