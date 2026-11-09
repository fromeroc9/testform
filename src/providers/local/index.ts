import * as fs from 'fs';
import * as path from 'path';
import { IProvider, IProviderIssuePayload, IProviderIssueResult, IProviderResourceHandler } from '../interface';
import { FILE_DATA } from '../../core/const';

interface LocalComment {
    id: number;
    body: string;
}

interface LocalIssue extends IProviderIssueResult {
    comments: LocalComment[];
    custom_fields: Record<string, any>;
    sub_issues?: (number | string)[];
}

interface LocalDB {
    issues: LocalIssue[];
    next_issue_number: number;
    next_comment_id: number;
}

export class LocalProvider implements IProvider {
    public name = 'local';

    // ──────────────────────────────────────────────────────────────────────────
    // Configuration & State Fields
    // ──────────────────────────────────────────────────────────────────────────

    private dbPath: string;
    private db: LocalDB;

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
        },
        project: {
            create: async (data: { fields?: Record<string, any> }, context?: any) => {
                const issueId = context?.issueResult?.number ?? context?.issueResult?.id;
                if (issueId && data.fields) {
                    await this.updateProjectItemFields(issueId, data.fields);
                }
                return issueId ? String(issueId) : undefined;
            },
            update: async (itemId: string, data: { fields?: Record<string, any> }) => {
                if (itemId && data.fields) {
                    await this.updateProjectItemFields(itemId, data.fields);
                }
            },
            post: async (data: { fields?: Record<string, any> }, context?: any) => {
                const issueId = context?.issueResult?.number ?? context?.issueResult?.id;
                if (issueId && data.fields) {
                    await this.updateProjectItemFields(issueId, data.fields);
                }
                return issueId ? String(issueId) : undefined;
            },
            patch: async (itemId: string, data: { fields?: Record<string, any> }) => {
                if (itemId && data.fields) {
                    await this.updateProjectItemFields(itemId, data.fields);
                }
            }
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

    constructor(dir: string = '.') {
        this.dbPath = path.resolve(dir, FILE_DATA);
        this.db = this.loadDB();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Identity & Formatting
    // ──────────────────────────────────────────────────────────────────────────

    formatRemoteId(issueId: number | string): string {
        return `local:${issueId}`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Primary Issue Lifecycle (Mode 1: Issue-based)
    // ──────────────────────────────────────────────────────────────────────────

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

    async getIssue(issueId: number | string): Promise<IProviderIssueResult | null> {
        const issue = this.db.issues.find(i => String(i.number) === String(issueId) || String(i.id) === String(issueId));
        return issue || null;
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

    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        return this.db.issues.filter(i => i.labels?.includes(label));
    }

    async getMilestoneByTitle(title: string): Promise<number | string | undefined> {
        return title;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Hierarchical Relationships
    // ──────────────────────────────────────────────────────────────────────────

    async addSubIssue(parentIssueId: number | string, subIssueId: number | string): Promise<void> {
        const parent = this.db.issues.find(i => String(i.number) === String(parentIssueId) || String(i.id) === String(parentIssueId));
        if (parent) {
            parent.sub_issues ??= [];
            if (!parent.sub_issues.includes(subIssueId)) {
                parent.sub_issues.push(subIssueId);
                this.saveDB();
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Project Boards & Custom Fields
    // ──────────────────────────────────────────────────────────────────────────

    async addToProject(issueId: string | number): Promise<string | undefined> {
        return String(issueId);
    }

    async updateProjectItemFields(itemId: string, customFields: Record<string, any>): Promise<void> {
        const issue = this.db.issues.find(i => String(i.node_id) === String(itemId) || String(i.number) === String(itemId));
        if (issue) {
            issue.custom_fields = { ...issue.custom_fields, ...customFields };
            this.saveDB();
        }
    }

    async getProjectItemFields(issueId: string | number): Promise<Record<string, any>> {
        const issue = this.db.issues.find(i => String(i.node_id) === String(issueId) || String(i.number) === String(issueId));
        return issue?.custom_fields || {};
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. Deprecated Comment Methods (Backward Compatibility)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @deprecated Create an issue comment
     */
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

    /**
     * @deprecated Update an existing comment
     */
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

    /**
     * @deprecated List comments on an issue
     */
    async listIssueComments(issueId: number | string): Promise<{ id: number | string, body: string }[]> {
        const issue = this.db.issues.find(i => String(i.number) === String(issueId));
        if (!issue) {
            throw new Error(`Issue #${issueId} not found`);
        }
        return issue.comments;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. Database Persistence Helpers
    // ──────────────────────────────────────────────────────────────────────────

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
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2), 'utf8');
    }
}

/** Backward-compatibility alias */
export const LocalAdapter = LocalProvider;
export type LocalAdapter = LocalProvider;
