import { IProvider, IProviderIssuePayload, IProviderIssueResult, IProviderApiService, IProviderResourceHandler } from '../interface';
import { logger } from '../../core/logger';

export interface IGitLabConfig {
    host?: string;
    projectId: string | number;
    tokenEnv?: string;
    token?: string;
    boardId?: number;
    [key: string]: any;
}

export class GitLabProvider implements IProvider {
    public name = 'gitlab';

    // ──────────────────────────────────────────────────────────────────────────
    // Configuration & State Fields
    // ──────────────────────────────────────────────────────────────────────────

    private host: string;
    private projectId: string | number;
    private token: string;
    private boardId?: number;

    // ──────────────────────────────────────────────────────────────────────────
    // Agnostic Multi-Resource Bus (Mode 2)
    // ──────────────────────────────────────────────────────────────────────────

    public resources: Record<string, IProviderResourceHandler> = {
        issue: {
            create: async (data: IProviderIssuePayload, _context?: any) => this.createIssue(data),
            read: async (id: number | string) => this.getIssue(id),
            update: async (id: number | string, data: Partial<IProviderIssuePayload>, _context?: any) => this.updateIssue(id, data),
            delete: async (id: number | string) => this.closeIssue(id),
            post: async (data: IProviderIssuePayload, _context?: any) => this.createIssue(data),
            get: async (id: number | string) => this.getIssue(id),
            patch: async (id: number | string, data: Partial<IProviderIssuePayload>, _context?: any) => this.updateIssue(id, data),
            put: async (id: number | string, data: IProviderIssuePayload, _context?: any) => this.updateIssue(id, data),
        }
    };

    /**
     * Backward compatibility alias for resources.
     */
    public get apis(): Record<string, IProviderResourceHandler> {
        return this.resources;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────────

    constructor(private config: IGitLabConfig) {
        this.host = (config.host || 'https://gitlab.com').replace(/\/+$/, '');
        this.projectId = config.projectId;
        const envVar = config.tokenEnv || 'GITLAB_TOKEN';
        this.token = config.token || process.env[envVar] || '';
        this.boardId = config.boardId;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Identity & Formatting
    // ──────────────────────────────────────────────────────────────────────────

    formatRemoteId(issueId: number | string): string {
        return `GL#${issueId}`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Primary Issue Lifecycle (Mode 1: Issue-based)
    // ──────────────────────────────────────────────────────────────────────────

    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        const reqBody: Record<string, any> = {
            title: payload.title,
            description: payload.body,
        };

        if (payload.labels && payload.labels.length > 0) {
            reqBody.labels = payload.labels.join(',');
        }

        if (payload.milestone) {
            reqBody.milestone_id = payload.milestone;
        }

        const data = await this.request('POST', `/projects/${this.encodedProjectId}/issues`, reqBody);
        return this.formatIssueResult(data);
    }

    async getIssue(issueId: number | string): Promise<IProviderIssueResult | null> {
        try {
            const data = await this.request('GET', `/projects/${this.encodedProjectId}/issues/${issueId}`);
            return this.formatIssueResult(data);
        } catch (error: any) {
            if (error.status === 404 || error.message?.includes('404')) {
                return null;
            }
            throw error;
        }
    }

    async updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult> {
        const reqBody: Record<string, any> = {};

        if (payload.title !== undefined) reqBody.title = payload.title;
        if (payload.body !== undefined) reqBody.description = payload.body;
        if (payload.labels !== undefined) reqBody.labels = payload.labels.join(',');
        if (payload.milestone !== undefined) reqBody.milestone_id = payload.milestone;
        if (payload.state !== undefined) {
            reqBody.state_event = payload.state === 'closed' ? 'close' : 'reopen';
        }

        const data = await this.request('PUT', `/projects/${this.encodedProjectId}/issues/${issueId}`, reqBody);
        return this.formatIssueResult(data);
    }

    async closeIssue(issueId: number | string): Promise<void> {
        await this.request('PUT', `/projects/${this.encodedProjectId}/issues/${issueId}`, {
            state_event: 'close'
        });
    }

    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        try {
            const data = await this.request(
                'GET',
                `/projects/${this.encodedProjectId}/issues?labels=${encodeURIComponent(label)}&per_page=100`
            );
            if (Array.isArray(data)) {
                return data.map(d => this.formatIssueResult(d));
            }
            return [];
        } catch {
            return [];
        }
    }

    async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        try {
            const data = await this.request(
                'GET',
                `/projects/${this.encodedProjectId}/milestones?title=${encodeURIComponent(title)}`
            );
            if (Array.isArray(data) && data.length > 0 && data[0].id) {
                return data[0].id;
            }
        } catch {}
        return undefined;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Hierarchical Relationships
    // ──────────────────────────────────────────────────────────────────────────

    async addSubIssue(parentIssueId: number | string, subIssueId: number | string): Promise<void> {
        try {
            await this.request('POST', `/projects/${this.encodedProjectId}/issues/${parentIssueId}/links`, {
                target_project_id: this.projectId,
                target_issue_iid: subIssueId,
                link_type: 'relates_to'
            });
        } catch {
            // Non-blocking fallback for link creation
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Private Transport Helpers
    // ──────────────────────────────────────────────────────────────────────────

    private get encodedProjectId(): string {
        return encodeURIComponent(String(this.projectId));
    }

    private async request(method: string, endpoint: string, body?: any): Promise<any> {
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const url = `${this.host}/api/v4${cleanEndpoint}`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        if (this.token) {
            headers['PRIVATE-TOKEN'] = this.token;
        }

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            let errorDetail = '';
            try {
                const errJson = await response.json();
                errorDetail = errJson.message || errJson.error || JSON.stringify(errJson);
            } catch {
                errorDetail = await response.text();
            }
            const err = new Error(`GitLab API error [${response.status}]: ${errorDetail}`);
            (err as any).status = response.status;
            throw err;
        }

        if (response.status === 204) return null;
        return await response.json();
    }

    private formatIssueResult(data: any): IProviderIssueResult {
        return {
            id: data.id,
            number: data.iid,
            title: data.title,
            body: data.description || '',
            state: data.state === 'opened' ? 'open' : data.state,
            node_id: `gl_node_${data.id}`,
            labels: Array.isArray(data.labels)
                ? data.labels
                : (typeof data.labels === 'string' ? data.labels.split(',').map((l: string) => l.trim()).filter(Boolean) : []),
            assignees: Array.isArray(data.assignees) ? data.assignees.map((a: any) => a.username) : [],
            milestone: data.milestone ? String(data.milestone.title || data.milestone.id) : undefined,
            created_at: data.created_at,
            updated_at: data.updated_at,
        };
    }
}

/** Backward-compatibility alias */
export const GitLabAdapter = GitLabProvider;
export type GitLabAdapter = GitLabProvider;
