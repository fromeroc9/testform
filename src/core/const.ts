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

/** Version token written into testform.yml config files. */
export const VERSION_CONFIG = "1.0";

/** Version token written into testform.state files. */
export const VERSION_STATE = "1.0";

// ─── File Names ───────────────────────────────────────────────────────────────

/** Supported configuration file names in resolution priority order. */
export const CONFIG_FILE_NAMES = [
    "main.yml",
    "main.yaml",
    "testform.yml",
    "testform.yaml",
    "testform.config.yml",
    "testform.config.yaml"
];

/** Default configuration file name. */
export const FILE_CONFIG = "main.yml";

/** Directory for auto-generated temporary and runtime cache files. */
export const DIR_CACHE = ".testform/cache";

/** Default state file name. */
export const FILE_STATE = "testform.state";

/** Default local provider database file name. */
export const FILE_DATA = ".testform/data.json";

/** Legacy local provider database file name (for backward compatibility migration). */
export const FILE_DATA_LEGACY = ".testform/cache/data.json";

/** Default dependency lock file name (stored in dedicated cache folder). */
export const FILE_LOCK = ".testform/cache/lock.json";

/** Default root dependency lock file name. */
export const FILE_ROOT_LOCK = ".testform.lock";

/** Default active backend metadata file name (stored in dedicated cache folder). */
export const FILE_BACKEND = ".testform/cache/backend.json";

// ─── Scope Maps ───────────────────────────────────────────────────────────────

/**
 * Maps each scope name to its corresponding resource type string.
 * Used to eliminate hardcoded resource type strings across commands.
 */
export const SCOPE_RESOURCE_MAP = {
    testcase: 'testcase',
    testrun: 'testrun',
    testplan: 'testplan',
    testreport: 'testreport',
    bug: 'bug',
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
    bug: '@bug',
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
    bug: '.bug.feature',
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
    testreport: {
        tag: SCOPE_TAG_MAP.testreport,
        ext: SCOPE_EXT_MAP.testreport,
        resource: SCOPE_RESOURCE_MAP.testreport,
    },
    bug: {
        tag: SCOPE_TAG_MAP.bug,
        ext: SCOPE_EXT_MAP.bug,
        resource: SCOPE_RESOURCE_MAP.bug,
    },
} as const;

// ─── Testcase Execution Statuses ──────────────────────────────────────────────

/**
 * All valid execution statuses for a test case result comment.
 * Aligned with Cucumber's 6 Gherkin execution statuses (passed, failed,
 * pending, skipped, undefined, ambiguous) plus legacy blocked.
 */
export const TESTCASE_STATUSES = ['pending', 'passed', 'failed', 'blocked', 'skipped', 'undefined', 'ambiguous'] as const;

/** Union type of all valid testcase statuses. */
export type TestcaseStatus = typeof TESTCASE_STATUSES[number];

/**
 * Emoji representation for each testcase execution status.
 * Used when rendering status summaries inside testrun issue comments and reports.
 */
export const TESTCASE_STATUS_EMOJI: Record<TestcaseStatus, string> = {
    pending: '⏳',
    passed: '✅',
    failed: '❌',
    blocked: '⚠️',
    skipped: '⏭️',
    undefined: '❓',
    ambiguous: '🔀',
};

// ─── Bug Defect Statuses ──────────────────────────────────────────────────────

/**
 * Valid resolution statuses for a bug defect resource.
 * - open: Defect is actively reported and unassigned/unresolved.
 * - in_progress: Resolution or retest is actively underway.
 * - resolved: Defect has been verified and resolved.
 * - reopened: Previously resolved defect reproduced or failed retest.
 * - discarded: Defect was rejected, won't fix, or not reproducible.
 * - duplicate: Defect tracks an identical root cause already reported.
 */
export const BUG_STATUSES = [
    'open',
    'in_progress',
    'resolved',
    'reopened',
    'discarded',
    'duplicate',
    'failed',
    'pending',
    'passed',
] as const;

export type BugStatus = typeof BUG_STATUSES[number];

// ─── Error Messages ───────────────────────────────────────────────────────────

/** Error shown when configuration has no GitHub provider section. */
export const ERR_GITHUB_CONFIG_NOT_FOUND =
    `GitHub provider configuration not found. Add a 'provider: github' or 'github:' block to your ${FILE_CONFIG} with owner, repository, and tokenEnv.`;

/** Error shown when a command requires input but input is disabled. */
export const ERR_NO_INPUT_ALLOWED =
    `This command requires manual approval, but input is disabled. Use the -auto-approve flag to bypass approval.`;

// ─── UI Messages ──────────────────────────────────────────────────────────────

/** Message displayed while acquiring the state lock before remote operations. */
export const MSG_ACQUIRING_LOCK = 'Acquiring state lock. This may take a few moments...';

/** Approval prompt instructions shown to the user before applying changes. */
export const MSG_APPROVE_ONLY_YES = `Only 'yes' will be accepted to approve.`;
