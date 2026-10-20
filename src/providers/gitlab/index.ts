import { IProvider, IProviderIssuePayload, IProviderIssueResult } from '../interface';
import { logger } from '../../core/logger';

export interface IGitLabConfig {
    host?: string;
    projectId: string | number;
    tokenEnv?: string;
    boardId?: number;
    [key: string]: any;
}

export class GitLabProvider implements IProvider {
    private host: string;
    private projectId: string | number;
    private token: string;
    private boardId?: number;

    constructor(private config: IGitLabConfig) {
        this.host = config.host || 'https://gitlab.com';
        this.projectId = config.projectId;
        const envVar = config.tokenEnv || 'GITLAB_TOKEN';
        this.token = process.env[envVar] || '';
        this.boardId = config.boardId;
    }

    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        throw new Error('GitLab provider createIssue is not yet fully implemented.');
    }

    async updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult> {
        throw new Error('GitLab provider updateIssue is not yet fully implemented.');
    }

    async closeIssue(issueId: number | string): Promise<void> {
        throw new Error('GitLab provider closeIssue is not yet fully implemented.');
    }

    async getIssue(issueId: number | string): Promise<IProviderIssueResult | null> {
        return null;
    }

    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        return [];
    }

    async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        return undefined;
    }

    async createIssueComment(issueId: number | string, body: string): Promise<{ id: number | string }> {
        throw new Error('GitLab provider createIssueComment is not yet fully implemented.');
    }

    async updateIssueComment(commentId: number | string, body: string): Promise<void> {
        throw new Error('GitLab provider updateIssueComment is not yet fully implemented.');
    }

    async listIssueComments(issueId: number | string): Promise<{ id: number | string, body: string }[]> {
        return [];
    }

    formatRemoteId(issueId: number | string): string {
        return `GL#${issueId}`;
    }
}
