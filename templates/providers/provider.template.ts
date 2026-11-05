/**
 * ==============================================================================
 * Testform Provider Starter Template
 * ==============================================================================
 * 
 * Implement this class to connect Testform with any test tracking platform
 * (e.g. GitLab Issues, Jira, Zephyr, Qase, TestRail, or internal databases).
 *
 * Requirements:
 * 1. Export as default class or named "Provider":
 *    `export default class MyProvider` or `module.exports = MyProvider`
 * 2. Implement the required IProvider lifecycle methods below.
 */

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

export default class CustomProvider {
    public name: string = 'custom-provider';
    private config: Record<string, any>;

    /**
     * @param config - Key-value dictionary passed under `provider.<name>` in main.yml
     */
    constructor(config: Record<string, any> = {}) {
        this.config = config;
        // Example: read host, token_env, project_id from config
        // this.host = config.host || 'https://gitlab.example.com';
        // this.token = process.env[config.token_env || 'GITLAB_TOKEN'] || '';
    }

    /**
     * Formats the human-readable remote identifier shown in terminal output and state ledger.
     * Examples: '#105' (GitHub/GitLab), 'QA-402' (Jira), 'TR-99' (TestRail).
     */
    formatRemoteId(id: number | string): string {
        return `#${id}`;
    }

    /**
     * Creates a new issue, test case, or test run in the remote platform.
     * Called during `testform apply` for 'add' actions.
     */
    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        // TODO: Call your platform's REST/GraphQL API (e.g. fetch / axios)
        // const res = await fetch(`${this.host}/api/v4/projects/${this.config.project_id}/issues`, { ... });
        return {
            id: 1,
            number: 1,
            title: payload.title,
            body: payload.body,
            state: 'open',
            labels: payload.labels
        };
    }

    /**
     * Updates an existing issue with modified attributes (title, body, labels, custom fields).
     * Called during `testform apply` for 'change' actions.
     */
    async updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult> {
        // TODO: Call platform PATCH/PUT endpoint
        return {
            id: issueId,
            number: Number(issueId),
            title: payload.title || '',
            state: 'open'
        };
    }

    /**
     * Closes an issue when a testcase/testrun is destroyed or removed.
     * Called during `testform destroy` or replacing resources.
     */
    async closeIssue(issueId: number | string): Promise<void> {
        // TODO: Call platform endpoint to close / archive the issue
    }

    /**
     * Retrieves an issue by its remote ID / number.
     * Used by `testform refresh` and drift detection.
     */
    async getIssue(issueId: number | string): Promise<IProviderIssueResult | null> {
        // TODO: Return null if not found, or IProviderIssueResult if exists
        return null;
    }

    /**
     * Lists existing issues matching a given label.
     * Used for bulk state recovery and synchronization.
     */
    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        // TODO: Return array of issues matching the label
        return [];
    }

    /**
     * Resolves a milestone / sprint title to its remote ID.
     */
    async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        // TODO: Lookup milestone ID by title
        return undefined;
    }

    // ─── Optional Methods (Board / Project / Sub-issues) ─────────────────────────

    /**
     * Adds an issue to a Project Board (e.g. GitHub Projects V2 or Jira Kanban).
     */
    async addToProject?(issueId: string | number): Promise<string | undefined> {
        return undefined;
    }

    /**
     * Updates custom fields on a board project item.
     */
    async updateProjectItemFields?(itemId: string, customFields: Record<string, string>): Promise<void> {
        // Optional implementation
    }

    /**
     * Links a sub-issue / child test case to a parent test run or test plan.
     */
    async addSubIssue?(parentIssueId: number | string, subIssueId: number | string): Promise<void> {
        // Optional implementation
    }
}
