export interface IProviderIssuePayload {
    title: string;
    body: string;
    labels: string[];
    assignees?: string[];
    milestone?: number | string; // GitLab can use strings or IDs
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

export interface IProviderApiService<TData = any, TResult = any> {
    create?(data: TData, context?: any): Promise<TResult>;
    update?(id: string | number, data: TData, context?: any): Promise<TResult>;
    delete?(id: string | number, context?: any): Promise<void>;
    get?(id: string | number, context?: any): Promise<TResult | null>;
}

export interface IProvider {
    name?: string;

    /**
     * Dictionary of service APIs exposed by this provider (e.g. { issue, project, pokemon, trainer }).
     * Enables generic, agnostic execution where Resource.api maps directly to these services.
     */
    apis?: Record<string, IProviderApiService>;

    /** Create an issue in the provider */
    createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult>;

    /** Update an existing issue in the provider */
    updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult>;

    /** Close an issue */
    closeIssue(issueId: number | string): Promise<void>;

    /** Get an issue by its ID/number */
    getIssue(issueId: number | string): Promise<IProviderIssueResult | null>;

    /** List issues by label */
    listIssuesByLabel(label: string): Promise<IProviderIssueResult[]>;

    /** Lookup milestone ID by title */
    getMilestoneByTitle(title: string): Promise<number | string | undefined>;

    /** @deprecated Issue comments are deprecated. */
    createIssueComment?(issueId: number | string, body: string): Promise<{ id: number | string }>;

    /** @deprecated Issue comments are deprecated. */
    updateIssueComment?(commentId: number | string, body: string): Promise<void>;

    /** @deprecated Issue comments are deprecated. */
    listIssueComments?(issueId: number | string): Promise<{ id: number | string, body: string }[]>;

    /** Add issue to a Project / Board */
    addToProject?(issueId: string | number): Promise<string | undefined>;

    /** Update custom fields on a Project Item */
    updateProjectItemFields?(itemId: string, customFields: Record<string, string>): Promise<void>;

    /** Get custom fields of a Project Item */
    getProjectItemFields?(issueId: string | number): Promise<Record<string, string>>;

    /** Format remote ID string */
    formatRemoteId(issueId: number | string): string;

    /** Add a sub-issue / child issue */
    addSubIssue?(parentIssueId: number | string, subIssueId: number | string): Promise<void>;
}

/** Backward compatibility alias */
export type IProviderAdapter = IProvider;
