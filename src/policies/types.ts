import { IScope, ParserScenario } from '../core/types';

export type PolicySeverity = 'error' | 'warning' | 'advisory';

export interface PolicyRule {
    id: string;
    type?: PolicySeverity;
    title: string;
    detail: string;
    uri: string;
    scenario?: string;
    line?: number;
    fix?: () => void | Promise<void>;
}

export type PolicyAction = (scenarios: ParserScenario[], rules: PolicyRule[], scope: IScope) => void | Promise<void>;

export interface PolicyDefinition {
    id: string;
    scope: IScope[];
    description?: string;
    severity?: PolicySeverity;
    action: PolicyAction;
}

export interface PolicyInfo {
    id: string;
    type: 'system' | 'user';
    scope: IScope[];
    description: string;
    enabled: boolean;
    severity?: PolicySeverity;
}

export interface PolicyScanOptions {
    severity?: PolicySeverity;
    include?: string | string[];
    exclude?: string | string[];
    strict?: boolean;
    compactWarnings?: boolean;
    isJson?: boolean;
    fix?: boolean;
}

export interface PolicyScanResult {
    hasErrors: boolean;
    hasWarnings: boolean;
    errorCount: number;
    warningCount: number;
    advisoryCount: number;
    fixedCount: number;
    rules: PolicyRule[];
}
