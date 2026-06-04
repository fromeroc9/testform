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
    const parts = identity.split('::');
    if (parts.length > 0) {
        let filePath = parts[0];
        const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        if (lastSlash !== -1) {
            filePath = filePath.substring(lastSlash + 1);
        }
        const lastDot = filePath.lastIndexOf('.');
        if (lastDot !== -1) {
            filePath = filePath.substring(0, lastDot);
        }
        parts[0] = filePath;
        return parts.join('::');
    }
    return identity;
}

/**
 * Formats a resource address string.
 *
 * @param type     - The resource type (e.g. `'github_testcase'`).
 * @param identity - The resource identity (e.g. `'tc1.case.feature::@[tc1]'`).
 * @returns A formatted address like `"github_testcase.tc1::@[tc1]"`.
 */
export function formatResourceAddress(type: string, identity: string): string {
    return `${type}.${formatIdentityDisplay(identity)}`;
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
 * Parses a `--set-status` flag value into its identity and status parts.
 *
 * The expected format is: `"<run-file>::<case-identity>=<status>"`
 *
 * @param value - Raw flag value string.
 * @returns Parsed object with `runIdentity`, `caseIdentity`, and `status`,
 *          or `null` if the format is invalid.
 *
 * @example
 * parseSetStatus('test1.run.feature::@[tc1]=passed')
 * // → { runIdentity: 'test1.run.feature', caseIdentity: '@[tc1]', status: 'passed' }
 */
export function parseSetStatus(value: string): {
    runIdentity: string;
    caseIdentity: string;
    status: string;
} | null {
    const eqIdx = value.lastIndexOf('=');
    if (eqIdx === -1) return null;

    const address = value.slice(0, eqIdx);
    const status = value.slice(eqIdx + 1).trim().toLowerCase();

    const colonIdx = address.indexOf('::');
    if (colonIdx === -1) return null;

    const runIdentity = address.slice(0, colonIdx).trim();
    const caseIdentity = address.slice(colonIdx + 2).trim();

    if (!runIdentity || !caseIdentity || !status) return null;

    return { runIdentity, caseIdentity, status };
}
