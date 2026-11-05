/**
 * Testform Custom Provider Implementation
 */

import { ApiClient } from './client';
import {
    IProvider,
    IProviderConfig,
    IProviderIssuePayload,
    IProviderIssueResult
} from './types';

export default class StarterProvider implements IProvider {
    public name: string = 'starter-provider';
    private client: ApiClient;
    private projectId: string | number;

    constructor(public config: IProviderConfig = {}) {
        this.client = new ApiClient(config);
        this.projectId = config.project_id || '';
    }

    /**
     * Formats remote ticket IDs shown in console and state ledger.
     * Example: '#105' (GitLab/GitHub) or 'QA-105' (Jira).
     */
    public formatRemoteId(id: number | string): string {
        return `#${id}`;
    }

    /**
     * Creates a new issue / testcase / testrun in the remote tracker.
     */
    public async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        // Example implementation for REST API:
        // const res = await this.client.post(`/projects/${this.projectId}/issues`, {
        //     title: payload.title,
        //     description: payload.body,
        //     labels: payload.labels
        // });
        // return { id: res.id, number: res.iid, title: res.title, state: res.state };

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
     * Updates an existing issue (title, description, tags, custom fields).
     */
    public async updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult> {
        // Example:
        // const res = await this.client.put(`/projects/${this.projectId}/issues/${issueId}`, { ... });
        return {
            id: issueId,
            number: Number(issueId),
            title: payload.title || '',
            state: 'open'
        };
    }

    /**
     * Closes or archives an issue when destroyed.
     */
    public async closeIssue(issueId: number | string): Promise<void> {
        // Example:
        // await this.client.put(`/projects/${this.projectId}/issues/${issueId}`, { state_event: 'close' });
    }

    /**
     * Fetches an issue by remote ID for drift detection.
     */
    public async getIssue(issueId: number | string): Promise<IProviderIssueResult | null> {
        // Example:
        // try {
        //     const res = await this.client.get(`/projects/${this.projectId}/issues/${issueId}`);
        //     return { id: res.id, number: res.iid, title: res.title, state: res.state };
        // } catch { return null; }
        return null;
    }

    /**
     * Lists existing issues matching a label.
     */
    public async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        return [];
    }

    /**
     * Resolves a milestone / sprint title to its remote ID.
     */
    public async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        return undefined;
    }

    /**
     * Optional: Links an issue to a Project Board.
     */
    public async addToProject(issueId: string | number): Promise<string | undefined> {
        return undefined;
    }
}
