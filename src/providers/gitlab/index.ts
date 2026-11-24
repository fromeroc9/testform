import { basename, resolve, extname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { IProvider, IProviderIssuePayload, IProviderIssueResult, IProviderResourceHandler } from '../interface';
import { Credentials } from '../../core/credentials';
import { matchesTestrunSelector } from '../../core/selector';

export interface IGitLabConfig {
    host?: string;
    projectId?: string | number;
    project_id?: string | number;
    project?: string | number;
    tokenEnv?: string;
    token_env?: string;
    token?: string;
    boardId?: number;
    board_id?: number;
    dir?: string;
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
    private dir: string;
    private userIdCache: Map<string, number> = new Map();
    private uploadedAssetsCache: Map<string, string> = new Map();

    private resolveLocalFile(filePath: string): string | null {
        if (!filePath) return null;
        const clean = filePath.trim().replace(/^['"]|['"]$/g, '');
        const root = this.dir || process.cwd();
        const candidates = [
            resolve(root, clean),
            resolve(root, 'attachments', clean),
            resolve(root, 'attachments', basename(clean)),
            resolve(root, 'attachments', 'bugs', basename(clean)),
            resolve(root, 'attachments', 'testruns', basename(clean))
        ];
        for (const c of candidates) {
            if (existsSync(c)) return c;
        }
        return null;
    }

    private getContentType(filePath: string): string {
        const ext = extname(filePath).toLowerCase();
        switch (ext) {
            case '.png': return 'image/png';
            case '.jpg':
            case '.jpeg': return 'image/jpeg';
            case '.gif': return 'image/gif';
            case '.webp': return 'image/webp';
            case '.svg': return 'image/svg+xml';
            case '.pdf': return 'application/pdf';
            case '.txt':
            case '.log': return 'text/plain';
            default: return 'application/octet-stream';
        }
    }

    public async uploadAttachment(filePath: string): Promise<string | null> {
        const resolved = this.resolveLocalFile(filePath);
        if (!resolved) return null;

        if (this.uploadedAssetsCache.has(resolved)) {
            return this.uploadedAssetsCache.get(resolved)!;
        }

        try {
            const fileName = basename(resolved);
            const contentType = this.getContentType(resolved);
            const fileBytes = readFileSync(resolved);

            const formData = new FormData();
            const blob = new Blob([fileBytes], { type: contentType });
            formData.append('file', blob, fileName);

            const uploadUrl = `${this.host}/api/v4/projects/${this.encodedProjectId}/uploads`;
            const headers: Record<string, string> = {};
            if (this.token) {
                headers['PRIVATE-TOKEN'] = this.token;
            }

            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers,
                body: formData
            });

            if (res.ok) {
                const resData: any = await res.json();
                if (resData?.url) {
                    this.uploadedAssetsCache.set(resolved, resData.url);
                    console.log(`  -> Uploaded attachment ${fileName} to GitLab`);
                    return resData.url;
                }
            } else {
                const errText = await res.text();
                console.log(`  -> Failed to upload attachment ${fileName} to GitLab (HTTP ${res.status}): ${errText}`);
            }
        } catch (err: any) {
            console.log(`  -> Error uploading attachment ${basename(resolved)} to GitLab: ${err.message}`);
        }
        return null;
    }

    private async prepareIssuePayload(data: any): Promise<IProviderIssuePayload> {
        let body = data.body || '';

        // 1. Scan for images: ![alt](path)
        const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const matches = [...body.matchAll(imgRegex)];
        for (const m of matches) {
            const alt = m[1];
            const rawPath = m[2];
            if (!rawPath.startsWith('http://') && !rawPath.startsWith('https://') && !rawPath.startsWith('/uploads/')) {
                const uploadedUrl = await this.uploadAttachment(rawPath);
                if (uploadedUrl) {
                    body = body.replace(m[0], `![${alt}](${uploadedUrl})`);
                }
            }
        }

        // 2. Scan for attachment marks: 📎 **Attachment:** `path`
        const attRegex = /📎 \*\*Attachment:\*\* `([^`]+)`/g;
        const attMatches = [...body.matchAll(attRegex)];
        for (const m of attMatches) {
            const rawPath = m[1];
            if (!rawPath.startsWith('http://') && !rawPath.startsWith('https://') && !rawPath.startsWith('/uploads/')) {
                const uploadedUrl = await this.uploadAttachment(rawPath);
                if (uploadedUrl) {
                    body = body.replace(m[0], `📎 **Attachment:** [${basename(rawPath)}](${uploadedUrl})`);
                }
            }
        }

        // 3. Scan for evidence lines in testruns: - 📎 **Evidence:** `path`
        const evidenceRegex = /- 📎 \*\*Evidence:\*\* `([^`]+)`/g;
        const evMatches = [...body.matchAll(evidenceRegex)];
        for (const m of evMatches) {
            const rawPath = m[1];
            if (!rawPath.startsWith('http://') && !rawPath.startsWith('https://') && !rawPath.startsWith('/uploads/')) {
                const uploadedUrl = await this.uploadAttachment(rawPath);
                if (uploadedUrl) {
                    body = body.replace(m[0], `- 📎 **Evidence:** [${basename(rawPath)}](${uploadedUrl})`);
                }
            }
        }

        if (data && data.body) {
            data.body = body;
        }

        return {
            ...data,
            body
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Agnostic Multi-Resource Bus (Mode 2)
    // ──────────────────────────────────────────────────────────────────────────

    private createDomainHandler(resourceType: string): IProviderResourceHandler {
        return {
            create: async (data: any, context?: any) => {
                const result = await this.createIssue(data);
                const issueId = result?.number ?? result?.id;
                if (issueId && context) {
                    await this.linkRelatedResources(resourceType, issueId, context);
                }
                return result;
            },
            read: async (id: number | string) => {
                return this.getIssue(id);
            },
            update: async (id: number | string, data: any, context?: any) => {
                const result = await this.updateIssue(id, data);
                if (context) {
                    await this.linkRelatedResources(resourceType, id, context);
                }
                return result;
            },
            delete: async (id: number | string) => {
                return this.closeIssue(id);
            }
        };
    }

    public resources: Record<string, IProviderResourceHandler> = {
        testcase: this.createDomainHandler('testcase'),
        testrun: this.createDomainHandler('testrun'),
        testplan: this.createDomainHandler('testplan'),
        bug: this.createDomainHandler('bug'),
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

    constructor(config: IGitLabConfig) {
        this.host = (config.host || 'https://gitlab.com').replace(/\/+$/, '');
        this.projectId = config.projectId || config.project_id || config.project || '';
        this.dir = config.dir || process.cwd();
        const envVar = config.tokenEnv || config.token_env || 'GITLAB_TOKEN';
        let storedToken: string | undefined;
        try {
            const creds = new Credentials();
            const hostDomain = this.host.replace(/^https?:\/\//, '').split('/')[0];
            storedToken = creds.getToken(hostDomain) || creds.getToken('gitlab.com') || creds.getToken('gitlab');
        } catch {
            // credentials lookup is best-effort
        }
        this.token = config.token || process.env[envVar] || storedToken || '';
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

    private async resolveAssigneeIds(assignees: string[]): Promise<number[]> {
        if (!assignees || assignees.length === 0) return [];
        const ids: number[] = [];

        for (const a of assignees) {
            const clean = String(a).trim().replace(/^@/, '');
            if (!clean) continue;

            if (/^\d+$/.test(clean)) {
                ids.push(parseInt(clean, 10));
                continue;
            }

            const lower = clean.toLowerCase();
            if (this.userIdCache.has(lower)) {
                ids.push(this.userIdCache.get(lower)!);
                continue;
            }

            try {
                const users = await this.request('GET', `/users?username=${encodeURIComponent(clean)}`);
                if (Array.isArray(users) && users.length > 0 && users[0]?.id) {
                    const uid = users[0].id;
                    this.userIdCache.set(lower, uid);
                    ids.push(uid);
                    continue;
                }
            } catch {
                // Best effort via /users endpoint
            }

            try {
                const members = await this.request('GET', `/projects/${this.encodedProjectId}/members/all?query=${encodeURIComponent(clean)}`);
                if (Array.isArray(members) && members.length > 0) {
                    const match = members.find((m: any) => m.username?.toLowerCase() === lower) || members[0];
                    if (match?.id) {
                        this.userIdCache.set(lower, match.id);
                        ids.push(match.id);
                        continue;
                    }
                }
            } catch {
                // Best effort via project members
            }
        }

        return ids;
    }

    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        const prepared = await this.prepareIssuePayload(payload);
        let body = prepared.body || '';
        const reqBody: Record<string, any> = {
            title: prepared.title,
            description: body,
        };

        if (prepared.labels && prepared.labels.length > 0) {
            reqBody.labels = prepared.labels.join(',');
        }

        if (prepared.milestone) {
            reqBody.milestone_id = prepared.milestone;
        }

        if (prepared.assignees && prepared.assignees.length > 0) {
            const resolvedIds = await this.resolveAssigneeIds(prepared.assignees);
            if (resolvedIds.length > 0) {
                reqBody.assignee_ids = resolvedIds;
            } else {
                // Resilient fallback: GitLab quick actions work even when user-lookup endpoints are restricted
                const qa = '\n\n/assign ' + prepared.assignees.map(u => `@${String(u).replace(/^@/, '')}`).join(' ');
                reqBody.description = (reqBody.description || '') + qa;
            }
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
        const prepared = await this.prepareIssuePayload(payload as any);
        const reqBody: Record<string, any> = {};

        if (prepared.title !== undefined) reqBody.title = prepared.title;
        if (prepared.body !== undefined) reqBody.description = prepared.body;
        if (prepared.labels !== undefined) reqBody.labels = prepared.labels.join(',');
        if (prepared.milestone !== undefined) reqBody.milestone_id = prepared.milestone;
        if (prepared.assignees !== undefined) {
            const resolvedIds = await this.resolveAssigneeIds(prepared.assignees);
            if (resolvedIds.length > 0) {
                reqBody.assignee_ids = resolvedIds;
            } else if (prepared.assignees.length > 0) {
                // Quick action fallback
                const qa = '\n\n/assign ' + prepared.assignees.map(u => `@${String(u).replace(/^@/, '')}`).join(' ');
                reqBody.description = (reqBody.description || '') + qa;
            }
        }
        if (prepared.state !== undefined) {
            reqBody.state_event = prepared.state === 'closed' ? 'close' : 'reopen';
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

    private async linkRelatedResources(resourceType: string, parentNumberOrId: number | string, context: { scenario?: any; state?: any; logger?: any }): Promise<void> {
        // 1. Testplan -> Testruns
        if (resourceType === 'testplan' && context.scenario?.custom?.testruns && context.state) {
            for (const tr of context.scenario.custom.testruns) {
                const runResources = context.state.getResources('testrun')?.filter((r: any) =>
                    matchesTestrunSelector(r, String(tr))
                ) || [];

                if (runResources.length > 1 && context.logger) {
                    const uris = Array.from(new Set(runResources.map((r: any) => r.address)));
                    context.logger.warn(`Rule '${tr}' in Testplan matches multiple Testruns. Linking all of them:\n` + uris.map((u: any) => `  - ${u}`).join('\n') + `\nIf this was unintentional, specify the full file path.`);
                }

                for (const runResource of runResources) {
                    if (runResource?.attributes?.issueNumber) {
                        try {
                            await this.addSubIssue(parentNumberOrId, runResource.attributes.issueNumber);
                            console.log(`  -> Linked testrun #${runResource.attributes.issueNumber} (${runResource.address}) to testplan #${parentNumberOrId}`);
                        } catch (e: any) {
                            console.log(`  -> Failed to link testrun ${runResource.address}: ${e.message}`);
                        }
                    }
                }
            }
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

export * from './templates';
export * from './resources';

