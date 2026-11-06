import { IProvider, IProviderIssuePayload, IProviderIssueResult, IProviderResourceHandler } from '@fromeroc9/testform';

export interface ICustomProviderConfig {
    host?: string;
    token?: string;
    tokenEnv?: string;
    [key: string]: any;
}

export default class CustomProvider implements IProvider {
    public name = 'custom-provider';

    public resources: Record<string, IProviderResourceHandler> = {
        issue: {
            create: async (data: IProviderIssuePayload, _context?: any) => this.createIssue(data),
            read: async (id: number | string) => this.getIssue(id),
            update: async (id: number | string, data: Partial<IProviderIssuePayload>, _context?: any) => this.updateIssue(id, data),
            delete: async (id: number | string) => this.closeIssue(id),
        }
    };

    constructor(public config: ICustomProviderConfig = {}) {}

    formatRemoteId(id: number | string): string {
        return `#${id}`;
    }

    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        return {
            id: 1,
            number: 1,
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
        return {
            id: issueId,
            number: Number(issueId),
            title: payload.title || '',
            state: 'open'
        };
    }

    async closeIssue(issueId: number | string): Promise<void> {}

    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        return [];
    }

    async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        return undefined;
    }

    async addSubIssue(parentIssueId: number | string, subIssueId: number | string): Promise<void> {}
}
