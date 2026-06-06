// ─── Scope ───────────────────────────────────────────────────────────────────
export type IScope = 'testcase' | 'testrun' | 'testplan' | 'testreport';

// ─── Config ──────────────────────────────────────────────────────────────────
export interface IConfig {
    version?: string;
    github?: IGitHubConfig;
    backend?: IBackendConfig;
    scope?: {
        global?: ITest;
        testcase?: ITest;
        testrun?: ITest;
        testplan?: ITest;
    };
    report_mapping?: Record<string, string>;
}

interface IBackendConfig {
    type: 'local' | 's3' | 'azurerm';
    config: Record<string, string>;
}

export interface IGitHubConfig {
    owner: string;
    repository: string;
    projectId?: number;
    tokenEnv: string;
    appId?: string;
    privateKey?: string;
    installationId?: string;
}

interface IConvention {
    directory?: string;
    filename?: string;
}

export interface ITest {
    identity?: string;
    fields?: IField[];
    convention?: IConvention;
}

export interface IField {
    name: string;
    type: 'keywords' | 'tags';
    values?: string | string[];
    required?: boolean;
    default?: string | string[];
}

// ─── Parser ──────────────────────────────────────────────────────────────────
export interface ParserFeature {
    tags: string[];
    keyword: string;
    name: string;
    description: string;
    location: number;
}

interface ParserPolicy {
    type: 'undeclared-field' | 'required-field';
    field: string;
}

export interface ParserScenario {
    uri: string;
    feature: ParserFeature;
    location: number;
    keyword: string;
    name: string;
    description: string;
    steps: ParserStep[];
    tags: string[];
    background?: ParserBackground;
    rule?: ParserRule;
    custom?: {
        testcases?: string[];
        testruns?: string[];
        identity?: string;
        fields?: Record<string, string>;
        policy?: ParserPolicy[];
        groupScenarios?: ParserScenario[];
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
export interface IState {
    version: string;
    serial: number;
    lineage: string;
    lastSync: string;
    resources: StateResource[];
}

export interface StateResource {
    type: string;
    identity: string;
    attributes: StateAttributes;
    lastApplied: string;
    tainted?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

interface StateAttributes {
    localHash: string;
    remoteId: string;
    issueNumber: number;
    title: string;
    body: string;
    labels: string[];
    testcaseCommentIds?: Record<string, number>;
    testcaseStatuses?: Record<string, string>;
    [key: string]: unknown;
}

// ─── Plan ────────────────────────────────────────────────────────────────────
export type PlanAction = 'add' | 'change' | 'destroy' | 'replace';

export interface PlanChange {
    action: PlanAction;
    identity: string;
    resourceType: string;
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
    action: PolicyAction;
}

// ─── Resources ───────────────────────────────────────────────────────────────
export interface ResourceField {
    name: string;
    value: ((scenario: any, context?: any) => string | string[]) | string | string[];
    knownAfterApply?: boolean;
}

export interface ResourceTemplate {
    type: string;
    fields: ResourceField[];
    comments?: (s: any, context?: any) => { identity: string; status: string; body: string; title: string }[];
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
    milestone?: number;
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
    identity: string;
    status: DiffStatus;
    localHash?: string;
    stateHash?: string;
    remoteId?: string;
}
