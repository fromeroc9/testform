/**
 * Common Types and Contracts for Testform Providers
 */

export interface IProviderConfig {
    host?: string;
    token_env?: string;
    token?: string;
    project_id?: string | number;
    [key: string]: any;
}

export interface IProviderIssuePayload {
    title: string;
    body: string;
    labels: string[];
    assignees?: string[];
    milestone?: number | string;
    state?: string;
}

export interface IProviderIssueResult {
    id: number | string;
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

export interface IProvider {
    name: string;
    formatRemoteId(id: number | string): string;
    createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult>;
    updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult>;
    closeIssue(issueId: number | string): Promise<void>;
    getIssue(issueId: number | string): Promise<IProviderIssueResult | null>;
    listIssuesByLabel(label: string): Promise<IProviderIssueResult[]>;
    getMilestoneByTitle(title: string): Promise<number | string | undefined>;
    addToProject?(issueId: string | number): Promise<string | undefined>;
    updateProjectItemFields?(itemId: string, customFields: Record<string, string>): Promise<void>;
    addSubIssue?(parentIssueId: number | string, subIssueId: number | string): Promise<void>;
}
