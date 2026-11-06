import { IProvider, IProviderIssuePayload, IProviderIssueResult, IProviderResourceHandler } from '@fromeroc9/testform';
import { IProviderConfig } from './types';
import { ApiClient } from './client';

export default class StarterProvider implements IProvider {
    public name = 'starter-provider';
    private client: ApiClient;

    public resources: Record<string, IProviderResourceHandler> = {
        issue: {
            create: async (data: IProviderIssuePayload) => this.createIssue(data),
            read: async (id: number | string) => this.getIssue(id),
            update: async (id: number | string, data: Partial<IProviderIssuePayload>) => this.updateIssue(id, data),
            delete: async (id: number | string) => this.closeIssue(id),
        }
    };

    constructor(public config: IProviderConfig = {}) {
        this.client = new ApiClient(config);
    }

    formatRemoteId(id: number | string): string {
        return `#${id}`;
    }

    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        const res = await this.client.post('/issues', payload);
        return {
            id: res.id,
            number: res.id,
            title: payload.title,
            body: payload.body,
            state: 'open',
            labels: payload.labels
        };
    }

    async getIssue(issueId: number | string): Promise<IProviderIssueResult | null> {
        return null;
    }

    async updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult> {
        await this.client.put(`/issues/${issueId}`, payload);
        return {
            id: issueId,
            number: Number(issueId),
            title: payload.title || '',
            state: 'open'
        };
    }

    async closeIssue(issueId: number | string): Promise<void> {
        await this.client.delete(`/issues/${issueId}`);
    }

    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        return [];
    }

    async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        return undefined;
    }

    async addSubIssue(parentIssueId: number | string, subIssueId: number | string): Promise<void> {}
}
