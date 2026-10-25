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
    return str.replace(/\\/g, '/').replace(/\.@/, '.');
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
 * Example: ["@module(source=\"./auth.feature\",", "vars={user:", "\"admin\"})"]
 * becomes ["@module(source=\"./auth.feature\", vars={user: \"admin\"})"]
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


