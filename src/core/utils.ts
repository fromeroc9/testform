/**
 * @fileoverview Pure utility functions shared across TestForm commands.
 *
 * Small, stateless helpers that eliminate common one-liner duplications
 * found across command files.
 */
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Calculates seconds elapsed since a given timestamp and returns a
 * human-readable string (e.g. `"3"`).
 *
 * @param startTime - The start timestamp as returned by `Date.now()`.
 * @returns Elapsed seconds as a fixed-point string with no decimals.
 *
 * @example
 * const start = Date.now();
 * // ... async work ...
 * console.log(`Done in ${elapsedSeconds(start)}s`);
 */
export function elapsedSeconds(startTime: number): string {
    return ((Date.now() - startTime) / 1000).toFixed(0);
}

export function resolvePath(obj: any, path: string): any {
    if (!path || !obj) return undefined;
    const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.');
    let current = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
}

export function formatIdentityDisplay(identity: string): string {
    return identity;
}

/**
 * Formats a resource address string.
 *
 * @param type     - The resource type (e.g. `'github_testcase'`).
 * @param identity - The resource identity (e.g. `'tc1.case.feature.tc-01'`).
 * @returns A formatted address like `"github_testcase.tc1.case.feature.tc-01"`.
 */
export function formatResourceAddress(type: string, identity: string): string {
    return `${type}.${identity}`;
}

export const formatHclValue = (value: any, indentLevel: number): string => {
    const indent = '    '.repeat(indentLevel);
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') {
        if (value.includes('\n')) {
            const paddedValue = value.split('\n').map(line => line ? `${indent}    ${line}` : `${indent}    `).join('\n');
            return `<<-EOT\n${paddedValue}\n${indent}EOT`;
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.map(v => formatHclValue(v, indentLevel + 1));
        return `[\n${indent}    ${items.join(`,\n${indent}    `)},\n${indent}]`;
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';

        let maxKeyLen = 0;
        for (const k of keys) {
            const strK = JSON.stringify(k);
            if (strK.length > maxKeyLen) maxKeyLen = strK.length;
        }

        let out = `{\n`;
        for (const k of keys) {
            const strK = JSON.stringify(k);
            const padding = ' '.repeat(maxKeyLen - strK.length);
            const val = Object.prototype.hasOwnProperty.call(value, k) ? value[k] : undefined;
            out += `${indent}    ${strK}${padding} = ${formatHclValue(val, indentLevel + 1)}\n`;
        }
        out += `${indent}}`;
        return out;
    }
    return JSON.stringify(value);
};

/**
 * Normalizes a resource address or identity for consistent cross-platform matching.
 * Converts Windows backslashes to forward slashes and strips leading '@' in scenario tags.
 */
export function normalizeAddress(str: string): string {
    return str.replace(/\\/g, '/').replace(/\.@/, '.').replace(/^@/, '');
}

/**
 * Checks if two resource addresses match, handling differences in slashes and tag '@' prefixes.
 */
export function addressesMatch(a: string, b: string): boolean {
    return normalizeAddress(a) === normalizeAddress(b);
}

/**
 * Recursively scans a workspace directory for YAML domain/configuration files (*.yml, *.yaml).
 * Automatically ignores build/versioning folders and standard root config files.
 */
export function findDomainConfigFiles(dir: string, extraReserved: string[] = []): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    const IGNORED_DIRS = new Set(['node_modules', '.git', '.testform', '.terraform', 'dist', 'coverage', '.system_generated']);
    const RESERVED_FILES = new Set([
        'main.yml', 'main.yaml',
        'testform.yml', 'testform.yaml',
        'variables.yml', 'variables.yaml',
        'vars.yml', 'vars.yaml',
        'locals.yml', 'locals.yaml',
        'local.yml', 'local.yaml',
        'outputs.yml', 'outputs.yaml',
        'data.yml', 'data.yaml',
        ...extraReserved.map(s => s.toLowerCase())
    ]);

    const scan = (currentDir: string) => {
        try {
            const isRoot = resolve(currentDir) === resolve(dir);
            const entries = readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                        scan(resolve(currentDir, entry.name));
                    }
                } else if (entry.isFile()) {
                    const lower = entry.name.toLowerCase();
                    if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
                        if (isRoot && RESERVED_FILES.has(lower)) {
                            continue;
                        }
                        results.push(resolve(currentDir, entry.name));
                    }
                }
            }
        } catch {
            // Ignore
        }
    };

    scan(dir);
    return results.sort();
}

export const TF_SPACE_TOKEN = '__TF_SPACE__';

/**
 * Temporarily replaces spaces inside tag parameter blocks (@module(...), @depends_on(...))
 * so that Cucumber's lexer parses tags without "A tag may not contain whitespace" syntax errors.
 */
export function sanitizeTagsWithSpaces(content: string): string {
    return content.replace(/(@(?:module|depends_on)\([^)]*\))/g, (match) => {
        return match.replace(/ /g, TF_SPACE_TOKEN);
    });
}

/**
 * Restores sanitized spaces inside tags back to normal spaces.
 */
export function restoreTagsWithSpaces(str: string): string {
    return str.split(TF_SPACE_TOKEN).join(' ');
}


/**
 * Reassembles Cucumber Gherkin tags that were split across whitespace or inner '@' symbols.
 * Example: ["@module(source=\"./auth.feature\",", "variable={user:", "\"admin\"})"]
 * becomes ["@module(source=\"./auth.feature\", variable={user: \"admin\"})"]
 */
export function reassembleSplitTags(tags: string[], prefix: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (t.startsWith(prefix) && (!t.endsWith(')') || (t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length)) {
            let combined = t;
            while (i + 1 < tags.length) {
                i++;
                const nextTag = tags[i];
                if (nextTag.startsWith('@') && !combined.endsWith(',') && !combined.endsWith('(') && !combined.endsWith(':') && !combined.endsWith('=')) {
                    combined += nextTag;
                } else {
                    combined += ' ' + nextTag;
                }
                const opens = (combined.match(/\(/g) || []).length;
                const closes = (combined.match(/\)/g) || []).length;
                if (opens === closes && closes > 0) break;
            }
            result.push(combined);
        } else {
            result.push(t);
        }
    }
    return result;
}

/**
 * Calculates Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Finds the closest matching command name for a given unknown input.
 */
export function suggestCommand(input: string, candidates: string[]): string | undefined {
    const lower = input.toLowerCase();
    let bestMatch: string | undefined;
    let minDistance = Infinity;

    for (const cmd of candidates) {
        if (cmd === lower) return cmd;
        const dist = levenshtein(lower, cmd);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = cmd;
        }
    }

    if (bestMatch && minDistance <= 2) {
        return bestMatch;
    }
    return undefined;
}

/**
 * Calculates a consolidated verdict/status from a list of child statuses.
 * Precedence:
 *   1. 'failed' (if at least one child is failed)
 *   2. 'pending' (if at least one child is pending, blocked, skipped, or if list is empty)
 *   3. 'passed' (if all children are passed)
 */
export function calculateRollupVerdict(statuses: string[]): 'passed' | 'failed' | 'pending' {
    if (!statuses || statuses.length === 0) return 'pending';
    const cleanStatuses = statuses.map(s => String(s || '').trim().toLowerCase());
    if (cleanStatuses.some(s => s === 'failed')) return 'failed';
    if (cleanStatuses.some(s => s === 'pending' || s === 'blocked' || s === 'skipped' || s === 'in_progress' || !s)) return 'pending';
    if (cleanStatuses.every(s => s === 'passed')) return 'passed';
    return 'pending';
}



