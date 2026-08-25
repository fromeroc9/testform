import * as fs from 'fs';
import * as path from 'path';
import { IProviderAdapter, IProviderIssuePayload, IProviderIssueResult } from './interface';
import { FILE_DATA } from '../core/const';

interface LocalComment {
    id: number;
    body: string;
}

interface LocalIssue extends IProviderIssueResult {
    comments: LocalComment[];
    custom_fields: Record<string, string>;
}

interface LocalDB {
    issues: LocalIssue[];
    next_issue_number: number;
    next_comment_id: number;
}

export class LocalAdapter implements IProviderAdapter {
    private dbPath: string;
    private db: LocalDB;

    constructor(dir: string = '.') {
        this.dbPath = path.resolve(dir, FILE_DATA);
        this.db = this.loadDB();
    }

    private loadDB(): LocalDB {
        if (fs.existsSync(this.dbPath)) {
            try {
                const content = fs.readFileSync(this.dbPath, 'utf8');
                return JSON.parse(content);
            } catch (error) {
                console.error(`Error reading ${this.dbPath}`, error);
            }
        }
        return {
            issues: [],
            next_issue_number: 1,
            next_comment_id: 1,
        };
    }

    private saveDB() {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2), 'utf8');
    }

    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        const issueNumber = this.db.next_issue_number++;
        const now = new Date().toISOString();
        const newIssue: LocalIssue = {
            id: issueNumber,
            number: issueNumber,
            title: payload.title,
            body: payload.body,
            state: payload.state || 'open',
            node_id: `local_node_${issueNumber}`,
            labels: payload.labels,
            assignees: payload.assignees,
            milestone: payload.milestone ? String(payload.milestone) : undefined,
            created_at: now,
            updated_at: now,
            comments: [],
            custom_fields: {},
        };
        this.db.issues.push(newIssue);
        this.saveDB();
        return newIssue;
    }

    async updateIssue(issueId: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult> {
        const issue = this.db.issues.find(i => String(i.number) === String(issueId));
        if (!issue) {
            throw new Error(`Issue #${issueId} not found`);
        }
        if (payload.title !== undefined) issue.title = payload.title;
        if (payload.body !== undefined) issue.body = payload.body;
        if (payload.state !== undefined) issue.state = payload.state;
        if (payload.labels !== undefined) issue.labels = payload.labels;
        if (payload.assignees !== undefined) issue.assignees = payload.assignees;
        if (payload.milestone !== undefined) issue.milestone = String(payload.milestone);
        issue.updated_at = new Date().toISOString();

        this.saveDB();
        return issue;
    }

    async closeIssue(issueId: number | string): Promise<void> {
        await this.updateIssue(issueId, { state: 'closed' });
    }

    async getIssue(issueId: number | string): Promise<IProviderIssueResult | null> {
        const issue = this.db.issues.find(i => String(i.number) === String(issueId));
        return issue || null;
    }

    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        return this.db.issues.filter(i => i.labels?.includes(label));
    }

    async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        // Mock milestone returning the title as ID for local purposes
        return title;
    }

    async createIssueComment(issueId: number | string, body: string): Promise<{ id: number | string }> {
        const issue = this.db.issues.find(i => String(i.number) === String(issueId));
        if (!issue) {
            throw new Error(`Issue #${issueId} not found`);
        }
        const commentId = this.db.next_comment_id++;
        issue.comments.push({ id: commentId, body });
        this.saveDB();
        return { id: commentId };
    }

    async updateIssueComment(commentId: number | string, body: string): Promise<void> {
        for (const issue of this.db.issues) {
            const comment = issue.comments.find(c => String(c.id) === String(commentId));
            if (comment) {
                comment.body = body;
                this.saveDB();
                return;
            }
        }
        throw new Error(`Comment #${commentId} not found`);
    }

    async listIssueComments(issueId: number | string): Promise<{ id: number | string, body: string }[]> {
        const issue = this.db.issues.find(i => String(i.number) === String(issueId));
        if (!issue) {
            throw new Error(`Issue #${issueId} not found`);
        }
        return issue.comments;
    }

    async addToProject(issueId: string | number): Promise<string | undefined> {
        // Return the issueId (node_id) as the project item ID so we can update fields later
        return String(issueId);
    }

    async updateProjectItemFields(itemId: string, customFields: Record<string, string>): Promise<void> {
        // itemId here is the node_id returned by addToProject
        const issue = this.db.issues.find(i => String(i.node_id) === String(itemId) || String(i.number) === String(itemId));
        if (issue) {
            issue.custom_fields = { ...issue.custom_fields, ...customFields };
            this.saveDB();
        }
    }

    async getProjectItemFields(issueId: string | number): Promise<Record<string, string>> {
        const issue = this.db.issues.find(i => String(i.node_id) === String(issueId) || String(i.number) === String(issueId));
        return issue?.custom_fields || {};
    }

    formatRemoteId(issueId: number | string): string {
        return `local:${issueId}`;
    }

    async addSubIssue(parentIssueId: number | string, subIssueId: number | string): Promise<void> {
        // No-op for local adapter right now
    }
}
