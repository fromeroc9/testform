"use strict";
/**
 * @fileoverview Core constants for the testform CLI.
 *
 * Centralizes all string literals, maps, and enumerations used across
 * the application to avoid duplication and provide a single source of truth.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSG_APPROVE_ONLY_YES = exports.MSG_ACQUIRING_LOCK = exports.ERR_NO_INPUT_ALLOWED = exports.ERR_GITHUB_CONFIG_NOT_FOUND = exports.SCOPE_CONFIG = exports.SCOPE_RESOURCE_MAP = exports.FILE_STATE = exports.FILE_CONFIG = exports.VERSION_STATE = exports.VERSION_CONFIG = exports.VERSION_CLI = exports.TITLE_CLI = exports.TITLE_APP = void 0;
// ─── App Identity ─────────────────────────────────────────────────────────────
/** Human-readable application name used in output messages. */
exports.TITLE_APP = "Testform";
/** CLI binary name used in usage strings. */
exports.TITLE_CLI = "testform";
/** Current CLI semver version. Keep in sync with package.json. */
exports.VERSION_CLI = "1.0.0-beta";
/** Version token written into testform.json config files. */
exports.VERSION_CONFIG = "1.0";
/** Version token written into testform.state files. */
exports.VERSION_STATE = "1.0";
// ─── File Names ───────────────────────────────────────────────────────────────
/** Default configuration file name. */
exports.FILE_CONFIG = "testform.json";
/** Default state file name. */
exports.FILE_STATE = "testform.state";
// ─── Scope Maps ───────────────────────────────────────────────────────────────
/**
 * Maps each scope name to its corresponding GitHub resource type string.
 * Used to eliminate hardcoded resource type strings across commands.
 */
exports.SCOPE_RESOURCE_MAP = {
    testcase: 'github_testcase',
    testrun: 'github_testrun',
    testplan: 'github_testplan',
    testreport: 'github_testreport',
};
/**
 * Maps each scope to the Gherkin tag used to identify feature files.
 * A feature file with this tag (or the matching extension) belongs to the scope.
 */
const SCOPE_TAG_MAP = {
    testcase: '@testcase',
    testrun: '@testrun',
    testplan: '@testplan',
    testreport: '@testreport',
};
/**
 * Maps each scope to the file extension convention used to identify feature files.
 * A file ending in this extension automatically belongs to the scope.
 */
const SCOPE_EXT_MAP = {
    testcase: '.case.feature',
    testrun: '.run.feature',
    testplan: '.plan.feature',
    testreport: '.report.feature',
};
/**
 * Full scope configuration map combining resource type, tag and extension.
 * Exported for use in plan, parser and other modules that need all three values.
 */
exports.SCOPE_CONFIG = {
    testcase: {
        tag: SCOPE_TAG_MAP.testcase,
        ext: SCOPE_EXT_MAP.testcase,
        resource: exports.SCOPE_RESOURCE_MAP.testcase,
    },
    testrun: {
        tag: SCOPE_TAG_MAP.testrun,
        ext: SCOPE_EXT_MAP.testrun,
        resource: exports.SCOPE_RESOURCE_MAP.testrun,
    },
    testplan: {
        tag: SCOPE_TAG_MAP.testplan,
        ext: SCOPE_EXT_MAP.testplan,
        resource: exports.SCOPE_RESOURCE_MAP.testplan,
    },
};
// ─── Testcase Execution Statuses ──────────────────────────────────────────────
/**
 * All valid execution statuses for a test case result comment.
 * Aligned with Cucumber's built-in statuses plus common QA states.
 */
const TESTCASE_STATUSES = ['pending', 'passed', 'failed', 'blocked', 'skipped', 'undefined'];
/**
 * Emoji representation for each testcase execution status.
 * Used when rendering the status table inside testrun issue comments.
 */
const TESTCASE_STATUS_EMOJI = {
    pending: '⏳',
    passed: '✅',
    failed: '❌',
    blocked: '⚠️',
    skipped: '⏭️',
    undefined: '❓',
};
// ─── Error Messages ───────────────────────────────────────────────────────────
/** Error shown when testform.json has no "github" section. */
exports.ERR_GITHUB_CONFIG_NOT_FOUND = `GitHub configuration not found. Add a "github" section to your ${exports.FILE_CONFIG} with owner, repository, and tokenEnv.`;
/** Error shown when a command requires input but input is disabled. */
exports.ERR_NO_INPUT_ALLOWED = `This command requires manual approval, but input is disabled. Use the -auto-approve flag to bypass approval.`;
// ─── UI Messages ──────────────────────────────────────────────────────────────
/** Message displayed while acquiring the state lock before remote operations. */
exports.MSG_ACQUIRING_LOCK = 'Acquiring state lock. This may take a few moments...';
/** Approval prompt instructions shown to the user before applying changes. */
exports.MSG_APPROVE_ONLY_YES = `Only 'yes' will be accepted to approve.`;
