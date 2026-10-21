/**
 * @fileoverview Reusable CLI helpers and lifecycle managers.
 *
 * Centralizes argument normalization, scope resolution, input approval assertions,
 * and state lock execution lifecycle to eliminate boilerplate across commands.
 */

import { resolve } from 'path';
import { State } from './state';
import { IScope } from './types';
import { VariableParser } from './variables';
import { ERR_NO_INPUT_ALLOWED } from './const';

// ─── Scope Resolution ─────────────────────────────────────────────────────────

export const ALL_SCOPES: IScope[] = ['testcase', 'testrun', 'testplan'];

/**
 * Resolves a scope option (e.g. 'all', undefined, or a single scope) into an array of IScope.
 */
export function resolveScopes(scope?: IScope | 'all' | string): IScope[] {
    if (!scope || (scope as string) === 'all') {
        return [...ALL_SCOPES];
    }
    return [scope as IScope];
}

/**
 * Normalizes scope input for CLI commands that support both 'all' and single-scope execution.
 */
export function normalizeScope(scopeVal?: string): { scope: IScope | 'all'; singleScope: IScope } {
    const scope: IScope | 'all' = (scopeVal as IScope | 'all') || 'all';
    const singleScope: IScope = scope === 'all' ? 'testcase' : scope;
    return { scope, singleScope };
}

// ─── Approval & Interactive Assertions ────────────────────────────────────────

/**
 * Asserts that interactive input is permitted when auto-approval is not enabled.
 * Throws a standardized error matching Testform approval requirements.
 */
export function assertApprovalAllowed(autoApprove: boolean, input: boolean): void {
    if (!autoApprove && !input) {
        const error = new Error(`${ERR_NO_INPUT_ALLOWED}\nUse the -auto-approve flag to bypass approval.`);
        error.name = 'No input allowed';
        console.error(`${error.name}: ${error.message}`);
        throw error;
    }
}

// ─── CLI Options & Argument Parsing ───────────────────────────────────────────

/**
 * Resolves the effective working directory from CLI options.
 */
export function resolveWorkDir(options: { chdir?: string }): string {
    const workDirRaw = String(options.chdir || '.');
    return resolve(process.env.INIT_CWD || process.cwd(), workDirRaw);
}

/**
 * Constructs a VariableParser instance from CLI options.
 */
export function resolveVariableParser(
    options: { var?: string | string[]; varFile?: string | string[] },
    workDir: string
): VariableParser {
    const varArr = options.var ? (Array.isArray(options.var) ? options.var : [options.var]) : undefined;
    const varFileArr = options.varFile ? (Array.isArray(options.varFile) ? options.varFile : [options.varFile]) : undefined;
    return new VariableParser(varArr, varFileArr, workDir);
}

/**
 * Normalizes Terraform-style single-dash flags (e.g. -chdir=foo, -auto-approve)
 * to standard double-dash flags (--chdir=foo, --auto-approve) for CLI parser compatibility.
 */
export function normalizeCliArgs(argv: string[]): string[] {
    const shortFlags = new Set(['C', 's', 'h', 'v', 'a', 'o']);

    return argv.map((arg) => {
        const match = arg.match(/^-([a-zA-Z][a-zA-Z0-9-]*)(=(.*))?$/);
        if (!match) return arg;

        const flag = match[1];
        const suffix = match[2] || '';

        // If it's a known single-character short flag, keep it as is
        if (shortFlags.has(flag)) {
            return arg;
        }

        // Convert single dash word flags to double dash
        return `--${flag}${suffix}`;
    });
}

/**
 * Compares two semantic version strings (e.g. "1.0.1" vs "1.1.0").
 */
export function compareCliVersions(a: string, b: string): number {
    const pa = a.split('.').map((v) => Number(v));
    const pb = b.split('.').map((v) => Number(v));
    const size = Math.max(pa.length, pb.length);

    for (let i = 0; i < size; i++) {
        const av = pa.at(i) ?? 0;
        const bv = pb.at(i) ?? 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }

    return 0;
}

// ─── State Lock Lifecycle ─────────────────────────────────────────────────────

export interface StateLockOptions {
    dir?: string;
    statePath?: string;
    backupPath?: string;
    lock?: boolean;
    lockTimeout?: string;
}

/**
 * Executes a function within an initialized and locked State context,
 * guaranteeing lock release even if errors occur.
 */
export async function withStateLock<T>(
    options: StateLockOptions,
    fn: (state: State) => Promise<T>
): Promise<T> {
    const {
        dir = '.',
        statePath,
        backupPath,
        lock = true,
        lockTimeout = '0s',
    } = options;

    const state = new State(dir, statePath, backupPath);
    await state.init();
    await state.acquireLock(lock, lockTimeout);

    try {
        return await fn(state);
    } finally {
        await state.releaseLock();
    }
}
