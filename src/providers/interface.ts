/**
 * Data Transfer Object (DTO) for creating or updating an issue or work item.
 */
export interface IProviderIssuePayload {
    title: string;
    body: string;
    labels: string[];
    assignees?: string[];
    milestone?: number | string; // GitLab can use strings or IDs
    state?: string;
}

/**
 * Normalized result returned by issue lifecycle operations.
 */
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

/**
 * Resource handler exposing standard CRUD lifecycle methods, REST aliases, and custom methods.
 */
export interface IProviderResourceHandler<TAttrs = any, TResult = any> {
    // ─── Standard Lifecycle Methods (CRUD / Terraform Parity) ───
    create?(attributes: TAttrs, context?: any): Promise<TResult>;
    read?(id: string | number, context?: any): Promise<TResult | null>;
    update?(id: string | number, attributes: Partial<TAttrs>, context?: any): Promise<TResult>;
    delete?(id: string | number, context?: any): Promise<void>;

    // ─── REST Verb Aliases ───
    post?(attributes: TAttrs, context?: any): Promise<TResult>;
    get?(id: string | number, context?: any): Promise<TResult | null>;
    patch?(id: string | number, attributes: Partial<TAttrs>, context?: any): Promise<TResult>;
    put?(id: string | number, attributes: TAttrs, context?: any): Promise<TResult>;

    // ─── Arbitrary Custom Actions & RPC Methods ───
    [customAction: string]: ((...args: any[]) => Promise<any>) | undefined;
}

/**
 * Backward compatibility alias for IProviderResourceHandler.
 */
export type IProviderApiService<TData = any, TResult = any> = IProviderResourceHandler<TData, TResult>;

/**
 * Master interface contract for all Testform providers.
 */
export interface IProvider {
    name?: string;

    /**
     * Formats the human-readable remote identifier shown in terminal output and state ledger.
     * Examples: '#105' (GitHub), 'GL#105' (GitLab), 'QA-402' (Jira), 'PK#25' (Pokedex), 'local:1'.
     */
    formatRemoteId(id: number | string): string;

    /**
     * Map of resources managed by this provider (e.g. { 'register-pokemon', testcase, project, defect }).
     * Each handler exposes standard CRUD methods (create, read, update, delete) and custom functions.
     */
    resources: Record<string, IProviderResourceHandler>;

    /**
     * Optional alias for `resources`.
     */
    apis?: Record<string, IProviderResourceHandler>;

    /**
     * Arbitrary custom provider actions, SDK clients, and helper methods.
     */
    [customProperty: string]: any;
}

/** Backward compatibility alias */
export type IProviderAdapter = IProvider;
