// ─── Scope ───────────────────────────────────────────────────────────────────
export type IScope = 'testcase' | 'testrun' | 'testplan' | 'testreport' | 'bug';

// ─── Config ──────────────────────────────────────────────────────────────────
export interface IProviderConfig {
    type: 'github' | 'local';
    config?: any;
}

export interface IBackendConfig {
    type: 'local' | 's3' | 'azurerm' | 'gcs' | 'github' | 'oci' | 'http' | 'rest' | 'custom';
    config: Record<string, any>;
}

export interface IGitHubConfig {
    owner: string;
    repository: string;
    projectId?: number | string;
    tokenEnv: string;
}

export interface IScaffold {
    directory?: string;
    filename?: string;
    attach?: string;
}

export type IConvention = IScaffold;

export interface IField {
    name: string;
    source: 'step' | 'tag';
    enum?: string | string[];
    required?: boolean;
    default?: string | string[];
}

export interface ISetStatusConfig {
    success?: string | string[];
    failure?: string | string[];
    pending?: string | string[];
    skipped?: string | string[];
    open?: string | string[];
    in_progress?: string | string[];
    resolved?: string | string[];
    closed?: string | string[];
    [key: string]: any;
}

export interface ISetConfig {
    status?: ISetStatusConfig;
    attach?: string;
    trace?: any;
    [key: string]: any;
}

export interface IScopeConfig {
    match?: string;
    identity?: string;
    fields?: IField[] | Record<string, any>;
    scaffold?: IScaffold;
    directory?: string;
    filename?: string;
    set?: ISetConfig;
}

export interface ITest {
    match?: string;
    identity?: string;
    fields?: IField[];
    scaffold?: IScaffold;
}

export interface IConfig {
    version?: string;
    testform?: {
        required_version?: string;
        version?: string;
        required_providers?: Record<string, string | { source: string; version?: string; constraints?: string }>;
        backend?: any;
    };
    required_providers?: Record<string, string | { source: string; version?: string; constraints?: string }>;
    provider?: IProviderConfig;
    backend?: IBackendConfig | string | Record<string, any>;
    resource?: {
        global?: IScopeConfig;
        testcase?: IScopeConfig;
        testrun?: IScopeConfig;
        testplan?: IScopeConfig;
        [key: string]: any;
    };
    locals?: Record<string, any>;
    module?: Record<string, any>;
    variable?: Record<string, any>;
    output?: Record<string, any>;
    data?: Record<string, any>;
    report_mapping?: Record<string, string>;
    policy?: {
        disabled?: string[];
        enabled?: string[];
        [key: string]: any;
    } | Record<string, any>;
}

// ─── Parser ──────────────────────────────────────────────────────────────────
export interface ParserFeature {
    tags: string[];
    keyword: string;
    name: string;
    description: string;
    location: number;
    custom?: Record<string, any>;
}

interface ParserPolicy {
    type: 'undeclared-field' | 'required-field' | 'attach-governance' | 'invalid-set-mark' | 'tag-field-as-step';
    field?: string;
    message?: string;
}

/**
 * Represents a parsed Gherkin scenario with extracted domain metadata.
 * This is the primary data structure (`s`) supplied to ResourceTemplate evaluators.
 */
export interface ParserScenario {
    /** File path or URI of the `.feature` file where this scenario is declared. */
    uri: string;
    /** Parent feature metadata (name, tags, description, line location). */
    feature: ParserFeature;
    /** Line number where the scenario keyword appears. */
    location: number;
    /** Gherkin keyword used (e.g. 'Scenario' or 'Scenario Outline'). */
    keyword: string;
    /** Human-readable scenario name/title. */
    name: string;
    /** Optional scenario description block. */
    description: string;
    /** Ordered list of executable Gherkin steps (Given, When, Then, And, But). */
    steps: ParserStep[];
    /** Direct scenario tags (e.g. ['@tc-01', '@smoke', '@priority=high']). */
    tags: string[];
    /** Optional background section associated with the scenario. */
    background?: ParserBackground;
    /** Optional containing Rule block (e.g. 'Rule: Magento/catalog.case.feature'). */
    rule?: ParserRule;
    /**
     * Enriched domain metadata extracted and evaluated by Testform parsers.
     */
    custom?: {
        /** Associated testcase identities or file references. */
        testcases?: string[];
        /** Associated testrun identities or file references (used in testplans). */
        testruns?: string[];
        /** Canonical scenario identity tag (e.g. 'tc-01', 'tr-02', 'bg-01'). */
        identity?: string;
        /** Merged metadata fields (from global defaults, resource defaults, and scenario steps). */
        fields?: Record<string, string>;
        /** Explicitly written fields in the scenario (allows distinguishing overrides from defaults). */
        explicitFields?: Record<string, any>;
        /** Runtime execution marks (* set status, attach, trace, run). */
        set?: Record<string, any>;
        /** Policy validation warnings and violations detected on this scenario. */
        policy?: ParserPolicy[];
        /** Child scenarios grouped under this scenario (e.g., testcases executed in a testrun). */
        groupScenarios?: ParserScenario[];
        /** Dynamic metadata key-values. */
        metadata?: Record<string, any>;
        /** Unfiltered raw tag strings. */
        rawTags?: string[];
        /** Unfiltered raw steps. */
        rawSteps?: ParserStep[];
        [key: string]: any;
    };
}

export interface ParserBackground {
    keyword: string;
    name: string;
    steps: ParserStep[];
}

export interface ParserStep {
    keyword: string;
    keywordType?: string;
    text: string;
}

export interface ParserRule {
    keyword: string;
    name: string;
    description: string;
}

// ─── State model ─────────────────────────────────────────────────────────────
export interface StateOutput {
    value: any;
    type?: string;
    description?: string;
    sensitive?: boolean;
}

export interface IState {
    version: string;
    serial: number;
    lineage: string;
    lastSync: string;
    provider?: string;
    resources: StateResource[];
    outputs?: Record<string, StateOutput>;
}

export interface StateResource {
    type: string;
    address: string;
    path: string;
    tag?: string;
    namespace?: string;
    physicalAddress?: string;
    identity?: string;
    attributes: StateAttributes;
    lastApplied: string;
    tainted?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface StateAttributes {
    localHash: string;
    remoteId: string;
    issueNumber?: number;
    title?: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    milestone?: string;
    custom_fields?: Record<string, any>;
    status?: string;
    testcases?: Record<string, string>;
    testruns?: Record<string, string> | string[];
    metadata?: Record<string, any>;
    testcaseCommentIds?: Record<string, number | string>;
    testcaseStatuses?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
}

// ─── Plan ────────────────────────────────────────────────────────────────────
export type PlanAction = 'add' | 'change' | 'destroy' | 'replace';

export interface PlanChange {
    action: PlanAction;
    address: string;
    path: string;
    tag?: string;
    namespace?: string;
    physicalAddress?: string;
    identity?: string;
    resourceType: string;
    provider?: string;
    scenario: ParserScenario;
    remoteId?: string;
    issueNumber?: number;
    localHash: string;
    oldAttributes?: any;
}

export interface PlanResult {
    changes: PlanChange[];
    hasChanges: boolean;
    state?: any;
}

// ─── Policy ──────────────────────────────────────────────────────────────────
export interface PolicyRule {
    id: string;
    type?: 'error' | 'warning';
    title: string;
    detail: string;
    uri: string;
    scenario?: string;
    line?: number;
}

export type PolicyAction = (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => void;

export interface PolicyDefinition {
    id: string;
    scope: IScope[];
    description?: string;
    action: PolicyAction;
}

// ─── Resources ───────────────────────────────────────────────────────────────
export interface ResourceField {
    name: string;
    value: ((scenario: ParserScenario, context?: any) => any) | string | string[] | number | boolean | Record<string, any>;
    knownAfterApply?: boolean;
}

export interface ResourceLifecycleHooks {
    /** Runs before resource creation (e.g. pre-validation, token acquisition). */
    beforeCreate?(args: { attributes: any; scenario: ParserScenario; context: any }): Promise<void> | void;
    /** Runs after resource creation; receives remote ID and live provider instance for custom functions. */
    afterCreate?(args: { id: string | number; attributes: any; provider: any; scenario: ParserScenario; context: any }): Promise<void> | void;
    /** Runs before resource modification. */
    beforeUpdate?(args: { id: string | number; attributes: any; provider: any; scenario: ParserScenario; context: any }): Promise<void> | void;
    /** Runs after resource modification. */
    afterUpdate?(args: { id: string | number; attributes: any; diff?: any; provider: any; scenario: ParserScenario; context: any }): Promise<void> | void;
    /** Runs before resource deletion. */
    beforeDelete?(args: { id: string | number; provider: any; context: any }): Promise<void> | void;
    /** Runs after resource deletion. */
    afterDelete?(args: { id: string | number; provider: any; context: any }): Promise<void> | void;
}

/**
 * Evaluation runtime context passed to ResourceTemplate evaluators (`attributes`, `state`, `api`).
 * Provides access to the active Testform engine services, configuration, and state.
 */
export interface ResourceContext {
    /**
     * Active Testform configuration manager (main.yml), including scopes, custom fields, and status category resolvers.
     */
    config?: any;
    /**
     * Active Testform state manager, allowing cross-resource lookups (e.g., resolving testruns in testplan rollup).
     */
    state?: any;
    /**
     * Root directory of the test workspace on disk.
     */
    testDirectory?: string;
    /**
     * Provider type name currently active (e.g. 'github', 'gitlab', 'local').
     */
    provider?: string;
    /**
     * Resolved local variables or execution variables.
     */
    variables?: Record<string, any>;
    /**
     * Path to the target state file.
     */
    statePath?: string;
    /**
     * Allow custom or user-injected context properties.
     */
    [key: string]: any;
}

export type ResourceAttributesDefinition =
    | ((scenario: ParserScenario, context?: ResourceContext) => Record<string, any>)
    | Record<string, ((scenario: ParserScenario, context?: ResourceContext) => any) | any>;

export type ResourceApiDefinition = Record<
    string,
    ((scenario: ParserScenario, context?: ResourceContext) => any) | Record<string, ((scenario: ParserScenario, context?: ResourceContext) => any) | any> | any
>;

export type ResourceStateDefinition = Record<
    string,
    ((scenario: ParserScenario, context?: ResourceContext) => any) | any
>;

export interface ResourceTemplate {
    type: string;
    /**
     * Canonical attributes extracted from the Gherkin scenario.
     * Can be an evaluator function returning attributes, or an attributes dictionary.
     */
    attributes?: ResourceAttributesDefinition;
    /**
     * Optional lifecycle hooks to orchestrate provider actions before/after CRUD events.
     */
    lifecycle?: ResourceLifecycleHooks;
    /**
     * @deprecated Legacy dictionary of payloads mapping directly to the provider's exposed APIs. Prefer `attributes`.
     */
    api?: ResourceApiDefinition;
    /**
     * Internal attributes to be persisted directly into testform.state
     * (e.g. { status, testcases, testcaseTraces, metadata }).
     */
    state?: ResourceStateDefinition;
    /** Legacy flat field definitions (backward compatibility). */
    fields?: ResourceField[];
}

export interface ResourceFormat {
    remoteId?: string;
    scenario: ParserScenario;
    type: PlanAction;
    resource: string;
}

// ─── Notify ──────────────────────────────────────────────────────────────────
export interface INotify {
    title: string;
    detail?: string[];
    extra?: string[];
    type?: 'error' | 'warning';
    close?: boolean;
}

// ─── Logger ──────────────────────────────────────────────────────────────────
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogOptions {
    prefix?: boolean;
    data?: unknown;
    bold?: boolean;
    dim?: boolean;
}

// ─── GitHub Adapter ──────────────────────────────────────────────────────────
export interface GitHubIssuePayload {
    title: string;
    body: string;
    labels: string[];
    assignees?: string[];
    milestone?: number | string;
    state?: string;
}

export interface GitHubIssueResult {
    id: number;
    number: number;
    title: string;
    body?: string;
    state: string;
    node_id?: string;
    labels?: string[];
    assignees?: string[];
    milestone?: string;
    created_at?: string;
    updated_at?: string;
}

// ─── Diff ────────────────────────────────────────────────────────────────────
export type DiffStatus = 'synced' | 'modified_locally' | 'orphaned_remote' | 'new_local';

export interface DiffEntry {
    address: string;
    identity?: string;
    status: DiffStatus;
    localHash?: string;
    stateHash?: string;
    remoteId?: string;
}
