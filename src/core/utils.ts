/**
 * @fileoverview Pure utility functions shared across TestForm commands.
 *
 * Small, stateless helpers that eliminate common one-liner duplications
 * found across command files.
 */

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

