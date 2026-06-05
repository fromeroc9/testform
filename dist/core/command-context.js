"use strict";
/**
 * @fileoverview Shared command context factory.
 *
 * Centralizes the repetitive boilerplate of initializing State, acquiring
 * the state lock, loading configuration, and constructing a GitHubAdapter.
 * Every command that needs GitHub access should use `createCommandContext()`
 * instead of repeating this pattern inline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCommandContext = createCommandContext;
const github_1 = require("../adapters/github");
const config_1 = require("./config");
const state_1 = require("./state");
const logger_1 = require("../logger");
const notify_1 = require("../notify");
const const_1 = require("../const");
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
async function createCommandContext(options = {}) {
    const { dir = '.', verbose = false, statePath, backupPath, lock = true, lockTimeout = '0s', silent = false, } = options;
    const logger = new logger_1.Logger(verbose);
    const config = new config_1.Config(dir);
    const ghConfig = config.getGitHub();
    if (!ghConfig) {
        if (!silent) {
            notify_1.notify.push({
                type: 'error',
                title: 'GitHub configuration not found',
                detail: [const_1.ERR_GITHUB_CONFIG_NOT_FOUND],
                close: true,
            });
        }
        return null;
    }
    const state = new state_1.State(dir, statePath, backupPath);
    await state.init();
    await state.acquireLock(lock, lockTimeout);
    const github = new github_1.GitHubAdapter(ghConfig);
    return { state, github, config, logger };
}
