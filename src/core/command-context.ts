/**
 * @fileoverview Shared command context factory.
 *
 * Centralizes the repetitive boilerplate of initializing State, acquiring
 * the state lock, loading configuration, and constructing a GitHubAdapter.
 * Every command that needs GitHub access should use `createCommandContext()`
 * instead of repeating this pattern inline.
 */

import { GitHubAdapter } from '../adapters/github';
import { Config } from './config';
import { State } from './state';
import { Logger } from '../logger';
import { notify } from '../notify';
import { ERR_GITHUB_CONFIG_NOT_FOUND } from '../const';

/**
 * The initialized context shared by commands that interact with GitHub
 * and the local state file.
 */
export interface CommandContext {
    /** Initialized and locked state instance. */
    state: State;
    /** Authenticated GitHub adapter ready for API calls. */
    github: GitHubAdapter;
    /** Loaded project configuration (testform.json). */
    config: Config;
    /** Logger configured with the command's verbosity setting. */
    logger: Logger;
}

/**
 * Options for creating a command context.
 */
interface CommandContextOptions {
    /** Working directory containing testform.json. Defaults to `'.'`. */
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
 * Initializes the state file, acquires the lock, loads the testform.json
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
    const ghConfig = config.getGitHub();

    if (!ghConfig) {
        if (!silent) {
            notify.push({
                type: 'error',
                title: 'GitHub configuration not found',
                detail: [ERR_GITHUB_CONFIG_NOT_FOUND],
                close: true,
            });
        }
        return null;
    }

    const state = new State(dir, statePath, backupPath);
    await state.init();
    await state.acquireLock(lock, lockTimeout);

    const github = new GitHubAdapter(ghConfig);

    return { state, github, config, logger };
}
