import { version } from "../../package.json";
/**
 * @fileoverview Core constants for the testform CLI.
 *
 * Centralizes all string literals, maps, and enumerations used across
 * the application to avoid duplication and provide a single source of truth.
 */

// ─── App Identity ─────────────────────────────────────────────────────────────

/** Human-readable application name used in output messages. */
export const TITLE_APP = "Testform";

/** CLI binary name used in usage strings. */
export const TITLE_CLI = "testform";

/** Current CLI semver version. Keep in sync with package.json. */
export const VERSION_CLI = version;

/** Version token written into testform.json config files. */
export const VERSION_CONFIG = "1.0";

/** Version token written into testform.state files. */
export const VERSION_STATE = "1.0";

// ─── File Names ───────────────────────────────────────────────────────────────

/** Default configuration file name. */
export const FILE_CONFIG = "testform.json";

/** Default state file name. */
export const FILE_STATE = "testform.state";

// ─── Scope Maps ───────────────────────────────────────────────────────────────

/**
 * Maps each scope name to its corresponding GitHub resource type string.
 * Used to eliminate hardcoded resource type strings across commands.
 */
export const SCOPE_RESOURCE_MAP = {
    testcase: 'github_testcase',
    testrun: 'github_testrun',
    testplan: 'github_testplan',
    testreport: 'github_testreport',
} as const;

/**
 * Maps each scope to the Gherkin tag used to identify feature files.
 * A feature file with this tag (or the matching extension) belongs to the scope.
 */
const SCOPE_TAG_MAP = {
    testcase: '@testcase',
    testrun: '@testrun',
    testplan: '@testplan',
    testreport: '@testreport',
} as const;

/**
 * Maps each scope to the file extension convention used to identify feature files.
 * A file ending in this extension automatically belongs to the scope.
 */
const SCOPE_EXT_MAP = {
    testcase: '.case.feature',
    testrun: '.run.feature',
    testplan: '.plan.feature',
    testreport: '.report.feature',
} as const;

/**
 * Full scope configuration map combining resource type, tag and extension.
 * Exported for use in plan, parser and other modules that need all three values.
 */
export const SCOPE_CONFIG = {
    testcase: {
        tag: SCOPE_TAG_MAP.testcase,
        ext: SCOPE_EXT_MAP.testcase,
        resource: SCOPE_RESOURCE_MAP.testcase,
    },
    testrun: {
        tag: SCOPE_TAG_MAP.testrun,
        ext: SCOPE_EXT_MAP.testrun,
        resource: SCOPE_RESOURCE_MAP.testrun,
    },
    testplan: {
        tag: SCOPE_TAG_MAP.testplan,
        ext: SCOPE_EXT_MAP.testplan,
        resource: SCOPE_RESOURCE_MAP.testplan,
    },
} as const;

// ─── Testcase Execution Statuses ──────────────────────────────────────────────

/**
 * All valid execution statuses for a test case result comment.
 * Aligned with Cucumber's built-in statuses plus common QA states.
 */
export const TESTCASE_STATUSES = ['pending', 'passed', 'failed', 'blocked', 'skipped', 'undefined'] as const;

/** Union type of all valid testcase statuses. */
type TestcaseStatus = typeof TESTCASE_STATUSES[number];

/**
 * Emoji representation for each testcase execution status.
 * Used when rendering the status table inside testrun issue comments.
 */
const TESTCASE_STATUS_EMOJI: Record<TestcaseStatus, string> = {
    pending: '⏳',
    passed: '✅',
    failed: '❌',
    blocked: '⚠️',
    skipped: '⏭️',
    undefined: '❓',
};

// ─── Error Messages ───────────────────────────────────────────────────────────

/** Error shown when testform.json has no "github" section. */
export const ERR_GITHUB_CONFIG_NOT_FOUND =
    `GitHub configuration not found. Add a "github" section to your ${FILE_CONFIG} with owner, repository, and tokenEnv.`;

/** Error shown when a command requires input but input is disabled. */
export const ERR_NO_INPUT_ALLOWED =
    `This command requires manual approval, but input is disabled. Use the -auto-approve flag to bypass approval.`;

// ─── UI Messages ──────────────────────────────────────────────────────────────

/** Message displayed while acquiring the state lock before remote operations. */
export const MSG_ACQUIRING_LOCK = 'Acquiring state lock. This may take a few moments...';

/** Approval prompt instructions shown to the user before applying changes. */
export const MSG_APPROVE_ONLY_YES = `Only 'yes' will be accepted to approve.`;