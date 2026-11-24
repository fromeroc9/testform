/**
 * @fileoverview Shared command context factory.
 *
 * Centralizes the repetitive boilerplate of initializing State, acquiring
 * the state lock, loading configuration, and constructing a GitHubAdapter.
 * Every command that needs GitHub access should use `createCommandContext()`
 * instead of repeating this pattern inline.
 */

import { IProvider as IProviderAdapter } from '../providers';
import { createProvider } from '../providers/loader';
import { Config } from './config';
import { State } from '../core/state';
import { Logger } from '../core/logger';
import { logger as notify } from '../core/logger';
import { TestformError } from './errors';

/**
 * The initialized context shared by commands that interact with the remote provider
 * and the local state file.
 */
export interface CommandContext {
    /** Initialized and locked state instance. */
    state: State;
    /** Authenticated provider adapter ready for API calls. */
    adapter: IProviderAdapter;
    provider: IProviderAdapter;
    github: IProviderAdapter;
    /** Loaded project configuration (main.yml). */
    config: Config;
    /** Logger configured with the command's verbosity setting. */
    logger: Logger;
}

/**
 * Options for creating a command context.
 */
interface CommandContextOptions {
    /** Working directory containing testform.yml. Defaults to `'.'`. */
    dir?: string;
    /** Enable verbose/debug logging. */
    verbose?: boolean;
    /** Custom path to the state file. */
    statePath?: string;
    /** Custom path to the state backup file. */
    backupPath?: string;
    /** Whether to acquire a state lock. Defaults to `true`. */
    lock?: boolean;
    /** How long to wait before giving up on acquiring the lock. Defaults to `'0s'`. */
    lockTimeout?: string;
    /** If `true`, GitHub config errors are silently suppressed. */
    silent?: boolean;
}

/**
 * Creates a fully initialized command context.
 *
 * Initializes the state file, acquires the lock, loads the testform.yml
 * configuration, and constructs an authenticated GitHubAdapter. Returns `null`
 * (and emits an error notification) if GitHub configuration is missing unless
 * `silent` is set.
 *
 * @param options - Context creation options.
 * @returns Initialized context, or `null` if GitHub config is absent.
 *
 * @example
 * const ctx = await createCommandContext({ dir, verbose, lock, lockTimeout });
 * if (!ctx) return;
 * try {
 *     await ctx.github.createIssue({ ... });
 * } finally {
 *     await ctx.state.releaseLock();
 * }
 */
export async function createCommandContext(
    options: CommandContextOptions = {}
): Promise<CommandContext | null> {
    const {
        dir = '.',
        verbose = false,
        statePath,
        backupPath,
        lock = true,
        lockTimeout = '0s',
        silent = false,
    } = options;

    const logger = new Logger(verbose);
    const config = new Config(dir);
    const providerType = config.getProviderType();
    let adapter: IProviderAdapter;

    try {
        adapter = await createProvider(config, dir);
    } catch (e: any) {
        if (!silent) {
            notify.push({
                type: 'error',
                title: `${providerType.charAt(0).toUpperCase() + providerType.slice(1)} configuration error`,
                detail: [e.message || String(e)],
                close: true,
            });
        }
        return null;
    }

    const state = new State(dir, statePath, backupPath);
    await state.init();
    await state.acquireLock(lock, lockTimeout);

    return { state, adapter, provider: adapter, github: adapter, config, logger };
}

/**
 * Middleware for CLI commands to automatically initialize context and manage locks.
 * 
 * @param action - The core command logic. Receives the initialized context and original options.
 * @returns A wrapped function that can be executed directly by Commander or the index router.
 */
export function withContext<T extends CommandContextOptions>(
    action: (ctx: CommandContext, options: T, ...args: any[]) => Promise<void>
) {
    return async (options: T, ...args: any[]) => {
        const ctx = await createCommandContext(options);
        if (!ctx) {
            throw new TestformError('Failed to initialize command context');
        }

        try {
            await action(ctx, options, ...args);
        } catch (error: any) {
            ctx.logger.error(error.message, error);
            throw error;
        } finally {
            await ctx.state.releaseLock();
        }
    };
}
