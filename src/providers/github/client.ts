import chalk from 'chalk';
import { existsSync, readFileSync, statSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { IGitHubConfig } from '../../core/types';
import { logger } from '../../core/logger';
import { Credentials } from '../../core/credentials';
import { IProvider, IProviderIssuePayload, IProviderIssueResult, IProviderResourceHandler } from '../interface';
import { TITLE_CLI, VERSION_CLI } from '../../core/const';
import { matchesTestrunSelector } from '../../core/selector';

class Mutex {
    private mutex = Promise.resolve();
    lock(): Promise<() => void> {
        let begin: (unlock: () => void) => void = () => { };
        this.mutex = this.mutex.then(() => new Promise(begin));
        return new Promise(res => { begin = res; });
    }
}
const projectMutex = new Mutex();

export class GitHubProvider implements IProvider {
    public name = 'github';

    // ──────────────────────────────────────────────────────────────────────────
    // Configuration & State Fields
    // ──────────────────────────────────────────────────────────────────────────

    private token: string;
    private owner: string;
    private repo: string;
    private projectId?: number | string;
    private config: IGitHubConfig;

    private projectNodeId?: string;
    private projectFields?: any[];
    private repoId?: number | string;
    private uploadedAssetsCache = new Map<string, string>();

    // ──────────────────────────────────────────────────────────────────────────
    // Agnostic Multi-Resource Bus (Mode 2)
    // ──────────────────────────────────────────────────────────────────────────

    private extractIssueNumber(id: number | string): string {
        const str = String(id);
        return str.includes(':') ? str.split(':').pop()! : str;
    }

    private async getRepoId(): Promise<number | string | null> {
        if (this.repoId !== undefined) return this.repoId;
        try {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}`);
            if (data?.id !== undefined) {
                this.repoId = data.id;
                return this.repoId as number | string;
            }
        } catch (err: any) {
            logger.warn(`Failed to fetch repo ID for asset uploads: ${err.message}`);
        }
        return null;
    }

    private resolveLocalFile(filePath: string): string | null {
        if (!filePath || filePath.startsWith('http://') || filePath.startsWith('https://')) return null;
        const clean = filePath.trim().replace(/\\/g, '/');
        const root = process.cwd();
        const candidates = [
            resolve(root, clean),
            resolve(root, 'attachments', clean),
            resolve(root, 'attachments', basename(clean)),
            resolve(root, 'attachments', 'bugs', basename(clean)),
            resolve(root, 'attachments', 'testruns', basename(clean))
        ];
        for (const c of candidates) {
            try {
                if (existsSync(c) && statSync(c).isFile()) {
                    return c;
                }
            } catch { }
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
            case '.mp4': return 'video/mp4';
            case '.mov': return 'video/quicktime';
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

        const repoId = await this.getRepoId();
        if (!repoId) return null;

        try {
            await this.ensureToken();
            const fileName = basename(resolved);
            const contentType = this.getContentType(resolved);
            const fileBytes = readFileSync(resolved);

            const uploadUrl = `https://uploads.github.com/user-attachments/assets?name=${encodeURIComponent(fileName)}&content_type=${encodeURIComponent(contentType)}&repository_id=${repoId}`;
            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Accept': 'application/json',
                    'Content-Type': contentType,
                    'User-Agent': `${TITLE_CLI}/${VERSION_CLI}`
                },
                body: fileBytes
            });

            if (res.ok) {
                const resData: any = await res.json();
                if (resData?.url) {
                    this.uploadedAssetsCache.set(resolved, resData.url);
                    logger.info(`Uploaded attachment ${fileName} -> ${resData.url}`);
                    return resData.url;
                }
            } else {
                const errText = await res.text();
                logger.warn(`Failed to upload attachment ${fileName} (HTTP ${res.status}): ${errText}`);
            }
        } catch (err: any) {
            logger.warn(`Error uploading attachment ${basename(resolved)}: ${err.message}`);
        }
        return null;
    }

    private async prepareIssuePayload(data: any): Promise<IProviderIssuePayload> {
        let body = data.body || '';

        // Scan for images: ![alt](path)
        const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const matches = [...body.matchAll(imgRegex)];
        for (const m of matches) {
            const alt = m[1];
            const rawPath = m[2];
            if (!rawPath.startsWith('http://') && !rawPath.startsWith('https://')) {
                const uploadedUrl = await this.uploadAttachment(rawPath);
                if (uploadedUrl) {
                    body = body.replace(m[0], `![${alt}](${uploadedUrl})`);
                }
            }
        }

        // Scan for evidence lines in testruns: - 📎 **Evidence:** `path`
        const evidenceRegex = /- 📎 \*\*Evidence:\*\* `([^`]+)`/g;
        const evMatches = [...body.matchAll(evidenceRegex)];
        for (const m of evMatches) {
            const rawPath = m[1];
            if (!rawPath.startsWith('http://') && !rawPath.startsWith('https://')) {
                const uploadedUrl = await this.uploadAttachment(rawPath);
                if (uploadedUrl) {
                    body = body.replace(m[0], `- 📎 **Evidence:** [${basename(rawPath)}](${uploadedUrl})`);
                }
            }
        }

        if (data && data.body) {
            data.body = body;
        }

        const payload: any = {
            title: data.title || '',
            body: body,
            labels: data.labels,
            assignees: data.assignees,
            state: data.state,
        };
        if (typeof data.milestone === 'string' && data.milestone) {
            const msId = await this.getMilestoneByTitle(data.milestone);
            if (msId) payload.milestone = msId;
        } else if (data.milestone) {
            payload.milestone = data.milestone;
        }
        return payload;
    }

    private async syncProjectFields(issueNodeId: string, metadata?: Record<string, any>) {
        if (!issueNodeId || !this.projectId || !metadata || Object.keys(metadata).length === 0) return;
        try {
            const itemId = await this.addToProject(issueNodeId);
            if (itemId) {
                await this.updateProjectItemFields(itemId, metadata);
            }
        } catch {
            // graceful fallback if projects v2 permissions not available
        }
    }

    private async linkTestplanSubIssues(parentIssueNumber: number | string, testruns: any[], state: any) {
        if (!testruns || !Array.isArray(testruns) || !state) return;
        const parentNum = this.extractIssueNumber(parentIssueNumber);
        for (const tr of testruns) {
            const runResources = state.getResources('testrun').filter((r: any) =>
                matchesTestrunSelector(r, String(tr))
            );
            for (const runResource of runResources) {
                const runIssueNum = runResource?.attributes?.issueNumber || runResource?.attributes?.remoteId;
                if (runIssueNum) {
                    try {
                        const rawNum = this.extractIssueNumber(runIssueNum);
                        const issueDetails = await this.getIssue(rawNum);
                        if (issueDetails && issueDetails.id) {
                            await this.addSubIssue(parentNum, issueDetails.id);
                        }
                    } catch {
                        // ignore link errors
                    }
                }
            }
        }
    }

    private extractBugRunSelectors(scenario?: any, data?: any): string[] {
        const rawCandidates = [
            scenario?.custom?.set?.run,
            scenario?.custom?.set?.testrun,
            scenario?.custom?.fields?.run,
            scenario?.custom?.fields?.testrun,
            scenario?.custom?.run,
            scenario?.custom?.testrun,
            data?.metadata?.linked,
        ];
        const selectors = new Set<string>();
        for (const raw of rawCandidates) {
            if (raw === undefined || raw === null) continue;
            const list = Array.isArray(raw) ? raw : [raw];
            for (const item of list) {
                const val = String(item).trim();
                if (val && val.toLowerCase() !== 'not applicable') {
                    selectors.add(val);
                }
            }
        }
        return Array.from(selectors);
    }

    private async linkBugToTestruns(
        bugIssueNumber: number | string,
        bugIssueId: number | string | undefined,
        data: any,
        context?: { scenario?: any; state?: any }
    ) {
        if (!context?.state) return;
        const runSelectors = this.extractBugRunSelectors(context.scenario, data);
        if (runSelectors.length === 0) return;

        let subIssueDbId = bugIssueId;
        if (!subIssueDbId) {
            try {
                const bugDetails = await this.getIssue(this.extractIssueNumber(bugIssueNumber));
                subIssueDbId = bugDetails?.id;
            } catch {
                // ignore lookup failure
            }
        }
        if (!subIssueDbId) return;

        const allRuns = context.state.getResources('testrun') || [];
        const linkedParentNums = new Set<string>();

        for (const selector of runSelectors) {
            const matchedRuns = allRuns.filter((r: any) => matchesTestrunSelector(r, selector));
            for (const runResource of matchedRuns) {
                const runIssueNum = runResource?.attributes?.issueNumber || runResource?.attributes?.remoteId;
                if (!runIssueNum) continue;
                const parentNum = this.extractIssueNumber(runIssueNum);
                if (linkedParentNums.has(parentNum)) continue;
                linkedParentNums.add(parentNum);
                try {
                    await this.addSubIssue(parentNum, subIssueDbId);
                } catch {
                    // ignore link errors
                }
            }
        }
    }

    private async linkTestrunBugSubIssues(
        runIssueNumber: number | string,
        scenario: any,
        state: any
    ) {
        if (!state || !scenario) return;
        const parentNum = this.extractIssueNumber(runIssueNumber);
        const allRuns = state.getResources('testrun') || [];
        const allBugs = state.getResources('bug') || [];
        if (allBugs.length === 0) return;

        const scenarioUri = String(scenario.uri || '').replace(/\\/g, '/');
        const scenarioTag = scenario.custom?.identity ? String(scenario.custom.identity) : '';
        const runCandidates = allRuns.filter((r: any) => {
            const rAddr = String(r.address || '').replace(/\\/g, '/');
            const rPath = String(r.path || '').replace(/\\/g, '/');
            const rPhys = String(r.physicalAddress || '').replace(/\\/g, '/');
            const sameParent =
                r?.attributes?.issueNumber !== undefined &&
                this.extractIssueNumber(r.attributes.issueNumber) === parentNum;
            const sameUri =
                Boolean(scenarioUri) &&
                (rAddr === scenarioUri || rPath === scenarioUri || rPhys === scenarioUri);
            const sameTag =
                Boolean(scenarioTag) &&
                r.tag &&
                String(r.tag).toLowerCase() === scenarioTag.toLowerCase();
            return sameParent || sameUri || sameTag;
        });

        runCandidates.push({
            address: scenarioUri,
            path: scenarioUri,
            physicalAddress: scenarioUri,
            tag: scenarioTag,
            attributes: { title: scenario.feature?.name || scenario.name || '' }
        });

        const linkedBugNums = new Set<string>();
        for (const bugResource of allBugs) {
            const rawBugRun =
                bugResource?.attributes?.testrun ||
                bugResource?.attributes?.run ||
                bugResource?.attributes?.metadata?.linked ||
                '';
            const bodyMatch = !rawBugRun && typeof bugResource?.attributes?.body === 'string'
                ? bugResource.attributes.body.match(/-\s+\*\*Testrun:\*\*\s+(?:#\d+\s+\()?`([^`]+)`\)?/)
                : null;
            const runSelector = String(rawBugRun || bodyMatch?.[1] || '').trim();
            if (!runSelector || runSelector.toLowerCase() === 'not applicable') continue;

            const matchesThisRun = runCandidates.some((cand: any) =>
                matchesTestrunSelector(cand, runSelector)
            );
            if (!matchesThisRun) continue;

            const bugIssueNum = bugResource?.attributes?.issueNumber || bugResource?.attributes?.remoteId;
            if (!bugIssueNum) continue;
            const rawBugNum = this.extractIssueNumber(bugIssueNum);
            if (linkedBugNums.has(rawBugNum)) continue;
            linkedBugNums.add(rawBugNum);

            try {
                const bugDetails = await this.getIssue(rawBugNum);
                if (bugDetails?.id) {
                    await this.addSubIssue(parentNum, bugDetails.id);
                }
            } catch {
                // ignore link errors
            }
        }
    }

    private createDomainResourceHandler(resourceType: string): IProviderResourceHandler {
        return {
            create: async (data: any, context?: any) => {
                const issuePayload = await this.prepareIssuePayload(data);
                if (issuePayload.body && data) {
                    data.body = issuePayload.body;
                }
                const result = await this.createIssue(issuePayload);
                if (result?.node_id) {
                    const meta = data.metadata || data.custom_fields || data.fields;
                    await this.syncProjectFields(result.node_id, meta);
                }
                const issueNum = result?.number ?? result?.id;
                if (resourceType === 'testplan' && context?.scenario?.custom?.testruns && context?.state) {
                    await this.linkTestplanSubIssues(issueNum, context.scenario.custom.testruns, context.state);
                } else if (resourceType === 'bug') {
                    await this.linkBugToTestruns(issueNum, result?.id, data, context);
                } else if (resourceType === 'testrun' && context?.scenario && context?.state) {
                    await this.linkTestrunBugSubIssues(issueNum, context.scenario, context.state);
                }
                return result;
            },
            read: async (id: number | string) => {
                const rawNum = this.extractIssueNumber(id);
                const issue = await this.getIssue(rawNum);
                if (!issue) return null;
                const result: any = { ...issue };
                if (issue.node_id && this.projectId) {
                    try {
                        const projectFields = await this.getProjectItemFields(issue.node_id);
                        if (projectFields && Object.keys(projectFields).length > 0) {
                            result.metadata = projectFields;
                        }
                    } catch {
                        // ignore project field read errors
                    }
                }
                return result;
            },
            update: async (id: number | string, data: any, context?: any) => {
                const rawNum = this.extractIssueNumber(id);
                const issuePayload = await this.prepareIssuePayload(data);
                if (issuePayload.body && data) {
                    data.body = issuePayload.body;
                }
                const result = await this.updateIssue(rawNum, issuePayload);
                const nodeId = result?.node_id || (await this.getIssueNodeId(rawNum));
                if (nodeId) {
                    const meta = data.metadata || data.custom_fields || data.fields;
                    await this.syncProjectFields(nodeId, meta);
                }
                if (resourceType === 'testplan' && context?.scenario?.custom?.testruns && context?.state) {
                    await this.linkTestplanSubIssues(rawNum, context.scenario.custom.testruns, context.state);
                } else if (resourceType === 'bug') {
                    await this.linkBugToTestruns(rawNum, result?.id, data, context);
                } else if (resourceType === 'testrun' && context?.scenario && context?.state) {
                    await this.linkTestrunBugSubIssues(rawNum, context.scenario, context.state);
                }
                return result;
            },
            delete: async (id: number | string) => {
                const rawNum = this.extractIssueNumber(id);
                return this.deleteIssue(rawNum);
            }
        };
    }

    public resources: Record<string, IProviderResourceHandler> = {
        testcase: this.createDomainResourceHandler('testcase'),
        testrun: this.createDomainResourceHandler('testrun'),
        testplan: this.createDomainResourceHandler('testplan'),
        bug: this.createDomainResourceHandler('bug'),
        issue: {
            create: async (data: IProviderIssuePayload, _context?: any) => this.createIssue(data),
            read: async (id: number | string) => this.getIssue(id),
            update: async (id: number | string, data: Partial<IProviderIssuePayload>, _context?: any) => this.updateIssue(id, data),
            delete: async (id: number | string) => this.deleteIssue(this.extractIssueNumber(id)),
            post: async (data: IProviderIssuePayload, _context?: any) => this.createIssue(data),
            get: async (id: number | string) => this.getIssue(id),
            patch: async (id: number | string, data: Partial<IProviderIssuePayload>, _context?: any) => this.updateIssue(id, data),
            put: async (id: number | string, data: IProviderIssuePayload, _context?: any) => this.updateIssue(id, data),
        },
        project: {
            create: async (data: { fields?: Record<string, any> }, context?: any) => {
                const issueNodeId = context?.issueResult?.node_id;
                if (!issueNodeId || !this.projectId) return undefined;
                const itemId = await this.addToProject(issueNodeId);
                if (itemId && data.fields) {
                    await this.updateProjectItemFields(itemId, data.fields);
                }
                return itemId;
            },
            update: async (targetId: string | number, data: { fields?: Record<string, any> }, context?: any) => {
                if (!targetId || !data.fields || !this.projectId) return;
                const idStr = String(targetId);
                let itemId: string | undefined;

                if (idStr.startsWith('PVTI_')) {
                    itemId = idStr;
                } else {
                    let issueNodeId = context?.issueResult?.node_id || context?.node_id;
                    if (!issueNodeId) {
                        if (idStr.startsWith('I_')) {
                            issueNodeId = idStr;
                        } else {
                            try {
                                const issue = await this.getIssue(targetId);
                                issueNodeId = issue?.node_id;
                            } catch {
                                // fallback fetch failed
                            }
                        }
                    }
                    if (issueNodeId) {
                        itemId = await this.addToProject(issueNodeId);
                    }
                }

                if (itemId && data.fields) {
                    await this.updateProjectItemFields(itemId, data.fields);
                }
            },
            post: async (data: { fields?: Record<string, any> }, context?: any) => {
                const issueNodeId = context?.issueResult?.node_id;
                if (!issueNodeId || !this.projectId) return undefined;
                const itemId = await this.addToProject(issueNodeId);
                if (itemId && data.fields) {
                    await this.updateProjectItemFields(itemId, data.fields);
                }
                return itemId;
            },
            patch: async (targetId: string | number, data: { fields?: Record<string, any> }, context?: any) => {
                if (!targetId || !data.fields || !this.projectId) return;
                const idStr = String(targetId);
                let itemId: string | undefined;

                if (idStr.startsWith('PVTI_')) {
                    itemId = idStr;
                } else {
                    let issueNodeId = context?.issueResult?.node_id || context?.node_id;
                    if (!issueNodeId) {
                        if (idStr.startsWith('I_')) {
                            issueNodeId = idStr;
                        } else {
                            try {
                                const issue = await this.getIssue(targetId);
                                issueNodeId = issue?.node_id;
                            } catch {
                                // fallback fetch failed
                            }
                        }
                    }
                    if (issueNodeId) {
                        itemId = await this.addToProject(issueNodeId);
                    }
                }

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

    constructor(config: IGitHubConfig) {
        this.config = config;
        const creds = new Credentials();
        const envToken = Object.prototype.hasOwnProperty.call(process.env, config.tokenEnv) ? process.env[config.tokenEnv] : undefined;
        let token = creds.getToken('github.com') || creds.getToken('github') || envToken || process.env.GITHUB_TOKEN;

        // Allow user to provide token directly instead of env var name
        if (!token && (config.tokenEnv.startsWith('ghp_') || config.tokenEnv.startsWith('github_pat_') || config.tokenEnv.startsWith('ghs_'))) {
            token = config.tokenEnv;
        }

        this.token = token || '';
        this.owner = config.owner;
        this.repo = config.repository;
        this.projectId = config.projectId;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Identity & Formatting
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Get the remote ID format: "owner/repo:issueNumber"
     */
    formatRemoteId(issueNumber: number | string): string {
        return `${this.repo}:${issueNumber}`;
    }

    /**
     * Get the node_id of an issue (needed for GraphQL Project v2 operations).
     */
    async getIssueNodeId(issueNumber: number | string): Promise<string | null> {
        try {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`);
            return data.node_id ?? null;
        } catch {
            return null;
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Primary Issue Lifecycle (Mode 1: Issue-based)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Create a GitHub Issue.
     */
    async createIssue(payload: IProviderIssuePayload): Promise<IProviderIssueResult> {
        const prepared = await this.prepareIssuePayload(payload);
        if (payload && prepared.body) {
            payload.body = prepared.body;
        }
        const data = await this.request('POST', `/repos/${this.owner}/${this.repo}/issues`, {
            title: prepared.title,
            body: prepared.body,
            labels: prepared.labels,
            assignees: prepared.assignees,
            milestone: prepared.milestone,
        });

        if (payload.state === 'closed') {
            try {
                const closedData = await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${data.number}`, {
                    state: 'closed',
                    state_reason: 'completed'
                });
                data.state = closedData.state || 'closed';
            } catch (err: any) {
                logger.warn(`Failed to auto-close issue #${data.number}: ${err.message}`);
            }
        }

        return {
            id: data.id,
            number: data.number,
            title: data.title ?? '',
            state: data.state,
            node_id: data.node_id,
            created_at: data.created_at,
            updated_at: data.updated_at,
        };
    }

    /**
     * Get a specific issue by number (for refresh and reading).
     */
    async getIssue(issueNumber: number | string): Promise<IProviderIssueResult | null> {
        try {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`);
            return {
                id: data.id,
                number: data.number,
                title: data.title ?? '',
                body: data.body ?? '',
                state: data.state,
                node_id: data.node_id,
                labels: data.labels?.map((l: any) => l.name) ?? [],
                assignees: data.assignees?.map((a: any) => a.login) ?? [],
                milestone: data.milestone?.title ?? '',
            };
        } catch {
            return null;
        }
    }

    /**
     * Update an existing GitHub Issue.
     */
    async updateIssue(issueNumber: number | string, payload: Partial<IProviderIssuePayload>): Promise<IProviderIssueResult> {
        const prepared = await this.prepareIssuePayload(payload);
        if (payload && prepared.body) {
            payload.body = prepared.body;
        }
        const patchBody: any = {
            title: prepared.title,
            body: prepared.body,
            labels: prepared.labels,
            assignees: prepared.assignees,
            milestone: prepared.milestone,
        };

        if (payload.state) {
            patchBody.state = payload.state;
            if (payload.state === 'closed') {
                patchBody.state_reason = 'completed';
            } else if (payload.state === 'open') {
                patchBody.state_reason = 'reopened';
            }
        }

        const data = await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, patchBody);

        return {
            id: data.id,
            number: data.number,
            title: data.title ?? '',
            state: data.state,
            node_id: data.node_id,
            created_at: data.created_at,
            updated_at: data.updated_at,
        };
    }

    private isNotFoundError(error: any): boolean {
        const name = String(error?.name || '');
        const msg = String(error?.message || '');
        return name.includes('[404]') || name.includes('[410]') || /\b(404|410|NOT_FOUND)\b|Could not resolve to a node/i.test(msg);
    }

    /**
     * Permanently delete a GitHub Issue via GraphQL `deleteIssue` (also removes it from Projects V2).
     * Falls back to closing the issue + removing its Project V2 item if deletion is not permitted.
     */
    async deleteIssue(issueNumber: number | string): Promise<void> {
        const rawNum = this.extractIssueNumber(issueNumber);
        let issueData: any;
        try {
            issueData = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${rawNum}`);
        } catch (err: any) {
            if (this.isNotFoundError(err)) return;
            throw err;
        }

        const issueNodeId = issueData?.node_id;
        if (issueNodeId) {
            try {
                await this.graphql(`
                    mutation($issueId: ID!) {
                        deleteIssue(input: { issueId: $issueId }) {
                            clientMutationId
                        }
                    }
                `, { issueId: issueNodeId });
                return;
            } catch (err: any) {
                if (this.isNotFoundError(err)) return;
                logger.warn(`Failed to permanently delete GitHub issue #${rawNum}; falling back to closing and unlinking from project: ${err.message}`);
            }
        }

        await this.closeIssue(rawNum);
        if (issueNodeId && this.projectId) {
            try {
                await this.removeFromProject(issueNodeId);
            } catch (err: any) {
                logger.warn(`Failed to remove issue #${rawNum} from GitHub Project: ${err.message}`);
            }
        }
    }

    /**
     * Close a GitHub Issue (soft delete).
     */
    async closeIssue(issueNumber: number | string): Promise<void> {
        try {
            await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
                state: 'closed',
            });
        } catch (err: any) {
            if (this.isNotFoundError(err)) return;
            throw err;
        }
    }

    /**
     * List all issues with a specific label (for refresh/diff).
     */
    async listIssuesByLabel(label: string): Promise<IProviderIssueResult[]> {
        const results: IProviderIssueResult[] = [];
        let page = 1;

        while (true) {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100&page=${page}`);
            if (data.length === 0) break;

            for (const issue of data) {
                results.push({
                    id: issue.id,
                    number: issue.number,
                    title: issue.title ?? '',
                    state: issue.state,
                });
            }

            if (data.length < 100) break;
            page++;
        }

        return results;
    }

    /**
     * Look up a milestone's ID by its title (case-insensitive).
     */
    async getMilestoneByTitle(title: string): Promise<number | undefined> {
        if (!title) return undefined;
        try {
            const milestones = await this.request('GET', `/repos/${this.owner}/${this.repo}/milestones?state=all&per_page=100`);
            const match = milestones.find((m: any) => m.title.toLowerCase() === title.toLowerCase());
            return match ? match.number : undefined;
        } catch {
            return undefined;
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Hierarchical Relationships
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Add a sub-issue to a parent issue (REST API).
     */
    async addSubIssue(parentIssueNumber: number | string, subIssueId: number | string): Promise<void> {
        try {
            await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${parentIssueNumber}/sub_issues`, {
                sub_issue_id: subIssueId,
                replace_parent: true
            });
        } catch (error: any) {
            if (!error.message?.includes('422')) {
                throw error;
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Project Boards (GitHub Projects V2)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Resolve the GraphQL node ID for a Project V2 and cache its fields.
     */
    private async resolveProjectMetadata(): Promise<{ id: string, fields: any[] } | undefined> {
        if (this.projectNodeId && this.projectFields) return { id: this.projectNodeId, fields: this.projectFields };
        if (!this.projectId) return undefined;

        const fieldsQuery = `
            id
            fields(first: 100) {
                nodes {
                    ... on ProjectV2Field { id name dataType }
                    ... on ProjectV2SingleSelectField { id name dataType options { id name } }
                    ... on ProjectV2IterationField { id name dataType configuration { iterations { id title } } }
                }
            }
        `;

        // 1. Direct Node ID resolution (e.g. PVT_kwDOB12345)
        if (typeof this.projectId === 'string' && this.projectId.startsWith('PVT_')) {
            try {
                const nodeResult = await this.graphql(`
                    query($id: ID!) {
                        node(id: $id) {
                            ... on ProjectV2 {
                                ${fieldsQuery}
                            }
                        }
                    }
                `, { id: this.projectId });

                if (nodeResult?.node?.id) {
                    this.projectNodeId = nodeResult.node.id;
                    this.projectFields = nodeResult.node.fields?.nodes || [];
                    return { id: this.projectNodeId!, fields: this.projectFields! };
                }
            } catch {
                // Not a valid node ID or inaccessible
            }
        }

        // 2. Simple human-readable web project number (e.g. 1, 2, "1")
        const projectNumber = typeof this.projectId === 'number'
            ? this.projectId
            : parseInt(String(this.projectId), 10);

        if (!isNaN(projectNumber)) {
            try {
                // Try as a user first
                const userResult = await this.graphql(`
                    query($login: String!, $number: Int!) {
                        user(login: $login) {
                            projectV2(number: $number) {
                                ${fieldsQuery}
                            }
                        }
                    }
                `, { login: this.owner, number: projectNumber });

                if (userResult?.user?.projectV2?.id) {
                    this.projectNodeId = userResult.user.projectV2.id;
                    this.projectFields = userResult.user.projectV2.fields.nodes;
                    return { id: this.projectNodeId!, fields: this.projectFields! };
                }
            } catch {
                // Not a user or project not found
            }

            try {
                // Fallback to organization
                const orgResult = await this.graphql(`
                    query($login: String!, $number: Int!) {
                        organization(login: $login) {
                            projectV2(number: $number) {
                                ${fieldsQuery}
                            }
                        }
                    }
                `, { login: this.owner, number: projectNumber });

                if (orgResult?.organization?.projectV2?.id) {
                    this.projectNodeId = orgResult.organization.projectV2.id;
                    this.projectFields = orgResult.organization.projectV2.fields.nodes;
                    return { id: this.projectNodeId!, fields: this.projectFields! };
                }
            } catch {
                // Not an org or project not found
            }
        }

        console.warn(chalk.yellow(`\n⚠️ Warning: Could not resolve GitHub Project V2 with ID ${this.projectId} for owner "${this.owner}".`));
        console.warn(chalk.yellow(`   If "${this.owner}" is a User account and you are authenticating via a GitHub App,`));
        console.warn(chalk.yellow(`   note that GitHub Apps are technically not allowed to access User-level Projects.`));
        console.warn(chalk.yellow(`   Please use a Personal Access Token (PAT) instead.\n`));

        return undefined;
    }

    /**
     * Remove an issue from the configured GitHub Project v2 (GraphQL).
     */
    async removeFromProject(issueNodeId: string): Promise<void> {
        const meta = await this.resolveProjectMetadata();
        if (!meta) return;

        const res = await this.graphql(`
            query($issueId: ID!) {
                node(id: $issueId) {
                    ... on Issue {
                        projectItems(first: 20) {
                            nodes {
                                id
                                project { id }
                            }
                        }
                    }
                }
            }
        `, { issueId: issueNodeId });

        const items = res?.node?.projectItems?.nodes || [];
        const matchingItems = items.filter((item: any) => item?.id && item?.project?.id === meta.id);

        for (const item of matchingItems) {
            const unlock = await projectMutex.lock();
            try {
                await this.graphql(`
                    mutation($projectId: ID!, $itemId: ID!) {
                        deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
                            deletedItemId
                        }
                    }
                `, {
                    projectId: meta.id,
                    itemId: item.id,
                });
            } finally {
                unlock();
            }
        }
    }

    /**
     * Add an issue to a GitHub Project v2 (GraphQL).
     */
    async addToProject(issueNodeId: string | number): Promise<string | undefined> {
        const meta = await this.resolveProjectMetadata();
        if (!meta) return undefined;

        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts) {
            const unlock = await projectMutex.lock();
            try {
                const res = await this.graphql(`
                    mutation($projectId: ID!, $contentId: ID!) {
                        addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
                            item { id }
                        }
                    }
                `, {
                    projectId: meta.id,
                    contentId: issueNodeId,
                });
                unlock();
                return res?.addProjectV2ItemById?.item?.id;
            } catch (e: any) {
                unlock();
                attempt++;
                if (attempt >= maxAttempts) {
                    const error = new Error(`Failed to link issue to GitHub Project: ${e.message}`);
                    error.name = 'GitHubProjectError';
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
            }
        }
    }

    /**
     * Update fields of a Project V2 item (GraphQL).
     */
    async updateProjectItemFields(itemId: string, customFields: Record<string, string>): Promise<void> {
        const meta = await this.resolveProjectMetadata();
        if (!meta || !meta.fields) return;

        const mutations: string[] = [];
        const variables: any = {
            projectId: meta.id,
            itemId: itemId
        };

        let fieldIndex = 0;

        for (const [key, val] of Object.entries(customFields)) {
            const field = meta.fields.find(f => f.name && f.name.toLowerCase() === key.toLowerCase());
            if (!field) continue;

            let fieldValue: any = undefined;

            if (field.dataType === 'TEXT') {
                if (val !== undefined && val !== null) {
                    fieldValue = { text: String(val) };
                }
            } else if (field.dataType === 'NUMBER') {
                if (val !== undefined && val !== null) {
                    const parsedNumber = Number(val);
                    if (!isNaN(parsedNumber)) {
                        fieldValue = { number: parsedNumber };
                    }
                }
            } else if (field.dataType === 'DATE') {
                if (val !== undefined && val !== null) {
                    const dateStr = String(val).split('T')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                        fieldValue = { date: dateStr };
                    } else {
                        fieldValue = { date: String(val) };
                    }
                }
            } else if (field.dataType === 'SINGLE_SELECT' && field.options) {
                if (typeof val === 'string') {
                    const cleanVal = val.startsWith('@') ? val.substring(1) : val;
                    const valLower = cleanVal.toLowerCase();
                    // 1. Direct match (e.g. "pending" matches "Pending", "failed" matches "Failed")
                    let opt = field.options.find((o: any) => o.name && o.name.toLowerCase() === valLower);
                    // 2. Intelligent semantic fallback for QA status options in candidate priority order
                    if (!opt) {
                        const matchSemantic = (candidates: string[]) => {
                            for (const c of candidates) {
                                const found = field.options.find((o: any) => o.name?.toLowerCase() === c);
                                if (found) return found;
                            }
                            return undefined;
                        };

                        if (valLower === 'passed' || valLower === 'success') {
                            opt = matchSemantic(['passed', 'done', 'completed', 'resolved', 'closed', 'success']);
                        } else if (valLower === 'pending' || valLower === 'unexecuted' || valLower === 'todo') {
                            opt = matchSemantic(['pending', 'todo', 'to do', 'backlog', 'unexecuted', 'in progress']);
                        } else if (valLower === 'failed' || valLower === 'error') {
                            opt = matchSemantic(['failed', 'error', 'bug', 'in progress', 'todo']);
                        } else if (valLower === 'open') {
                            opt = matchSemantic(['open', 'todo', 'to do', 'backlog', 'in progress']);
                        } else if (valLower === 'closed' || valLower === 'resolved') {
                            opt = matchSemantic(['closed', 'done', 'completed', 'resolved']);
                        } else if (valLower === 'ambiguous' || valLower === 'blocked' || valLower === 'undefined' || valLower === 'skipped') {
                            opt = matchSemantic(['blocked', 'skipped', 'ambiguous', 'pending', 'todo', 'in progress', 'failed']);
                        }
                    }
                    if (opt) {
                        fieldValue = { singleSelectOptionId: opt.id };
                    } else {
                        logger.warn(`Option "${val}" not found for Single Select field "${field.name}".`);
                    }
                }
            } else if (field.dataType === 'ITERATION' && field.configuration?.iterations) {
                if (typeof val === 'string') {
                    const cleanVal = val.startsWith('@') ? val.substring(1) : val;
                    const opt = field.configuration.iterations.find((o: any) => o.title.toLowerCase() === cleanVal.toLowerCase());
                    if (opt) {
                        fieldValue = { iterationId: opt.id };
                    } else {
                        logger.warn(`Iteration "${val}" not found for Iteration field "${field.name}".`);
                    }
                }
            }

            if (!fieldValue) continue;

            const fieldVarName = `fieldId${fieldIndex}`;
            const valueVarName = `value${fieldIndex}`;
            variables[fieldVarName] = field.id;
            variables[valueVarName] = fieldValue;

            mutations.push(`
                f${fieldIndex}: updateProjectV2ItemFieldValue(input: {
                    projectId: $projectId
                    itemId: $itemId
                    fieldId: $${fieldVarName}
                    value: $${valueVarName}
                }) { projectV2Item { id } }
            `);
            fieldIndex++;
        }

        if (mutations.length === 0) return;

        const variableDefs = [
            `$projectId: ID!`,
            `$itemId: ID!`,
            ...Array.from({ length: fieldIndex }, (_, i) => `$fieldId${i}: ID!, $value${i}: ProjectV2FieldValue!`)
        ].join(', ');

        const query = `mutation(${variableDefs}) {
            ${mutations.join('\n')}
        }`;

        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts) {
            const unlock = await projectMutex.lock();
            try {
                await this.graphql(query, variables);
                unlock();
                break;
            } catch (e: any) {
                unlock();
                attempt++;
                if (attempt >= maxAttempts) {
                    const error = new Error(`Failed to assign custom fields: ${e.message}`);
                    error.name = 'GitHubProjectError';
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
            }
        }
    }

    /**
     * Get fields of a Project V2 item (GraphQL).
     */
    async getProjectItemFields(issueNodeId: string | number): Promise<Record<string, string>> {
        const meta = await this.resolveProjectMetadata();
        if (!meta || !meta.fields) return {};

        try {
            const res = await this.graphql(`
                query($id: ID!) {
                    node(id: $id) {
                        ... on Issue {
                            projectItems(first: 10) {
                                nodes {
                                    project { id }
                                    fieldValues(first: 100) {
                                        nodes {
                                            ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                                             ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                                            ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                                            ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                                            ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            `, { id: issueNodeId });

            const projectItems = res?.node?.projectItems?.nodes || [];
            const item = projectItems.find((i: any) => i.project?.id === meta.id);
            if (!item || !item.fieldValues || !item.fieldValues.nodes) return {};

            const customFields: Record<string, string> = Object.create(null);
            for (const val of item.fieldValues.nodes) {
                const fieldName = val.field?.name;
                if (!fieldName) continue;

                let stringValue = '';
                if (val.text !== undefined) stringValue = val.text;
                else if (val.name !== undefined) stringValue = val.name;
                else if (val.title !== undefined) stringValue = val.title;
                else if (val.date !== undefined) stringValue = val.date;
                else if (val.number !== undefined) stringValue = String(val.number);

                customFields[fieldName.toLowerCase()] = stringValue;
            }
            return customFields;
        } catch {
            return {};
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. Deprecated Comment Operations (Backward Compatibility)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @deprecated Create a comment on an issue.
     */
    async createIssueComment(issueNumber: number | string, body: string): Promise<{ id: number | string }> {
        const data = await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, { body });
        return { id: data.id };
    }

    /**
     * @deprecated Update an existing comment.
     */
    async updateIssueComment(commentId: number | string, body: string): Promise<void> {
        await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`, { body });
    }

    /**
     * @deprecated List all comments on an issue.
     */
    async listIssueComments(issueNumber: number | string): Promise<{ id: number | string, body: string }[]> {
        const results: { id: number | string, body: string }[] = [];
        let page = 1;

        while (true) {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
            if (data.length === 0) break;

            for (const comment of data) {
                results.push({ id: comment.id, body: comment.body });
            }

            if (data.length < 100) break;
            page++;
        }

        return results;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. Private HTTP & GraphQL Transport Helpers
    // ──────────────────────────────────────────────────────────────────────────

    private async ensureToken(): Promise<void> {
        if (this.token) return;
        logger.error(`GitHub token not found. Environment variable "${this.config.tokenEnv}" is not set.`);
        throw new Error(`Environment variable "${this.config.tokenEnv}" is not set.`);
    }

    private async request(method: string, path: string, body?: any, attempt = 1): Promise<any> {
        await this.ensureToken();
        const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
        const maxAttempts = 5;

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json',
                    'User-Agent': `${TITLE_CLI}/${VERSION_CLI}`,
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            if (response.status === 403 || response.status === 429) {
                const errorText = await response.text();
                const isRateLimit = response.status === 429 ||
                    errorText.toLowerCase().includes('rate limit') ||
                    errorText.toLowerCase().includes('abuse') ||
                    errorText.toLowerCase().includes('secondary');

                if (isRateLimit && attempt <= maxAttempts) {
                    const retryAfterHeader = response.headers.get('retry-after');
                    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : (attempt * 3);
                    console.warn(chalk.yellow(`\n⚠️ GitHub Rate Limit / Secondary Rate Limit hit. Retrying in ${retryAfter} seconds... (Attempt ${attempt}/${maxAttempts})`));
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    return this.request(method, path, body, attempt + 1);
                } else {
                    const error = new Error(errorText);
                    error.name = `GitHub API Error [${response.status}]`;
                    throw error;
                }
            }

            if (response.status >= 500 && response.status < 600 && attempt <= maxAttempts) {
                const retryAfter = attempt * 2;
                console.warn(chalk.yellow(`\n⚠️ GitHub Server Error [${response.status}]. Retrying in ${retryAfter} seconds... (Attempt ${attempt}/${maxAttempts})`));
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return this.request(method, path, body, attempt + 1);
            }

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(errorText);
                error.name = `GitHub API Error [${response.status}]`;
                throw error;
            }

            // Handle empty responses (like 204 No Content)
            if (response.status === 204) {
                return null;
            }

            return await response.json();
        } catch (error: any) {
            if (attempt <= maxAttempts && (!error.name || !error.name.startsWith('GitHub API Error'))) {
                const retryAfter = attempt * 3;
                console.warn(chalk.yellow(`\n⚠️ Network error: ${error.message}. Retrying in ${retryAfter} seconds... (Attempt ${attempt}/${maxAttempts})`));
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return this.request(method, path, body, attempt + 1);
            }
            throw error;
        }
    }

    private async graphql(query: string, variables: any = {}): Promise<any> {
        await this.ensureToken();
        const response = await this.request('POST', 'https://api.github.com/graphql', { query, variables });
        if (response.errors && response.errors.length > 0) {
            const error = new Error(JSON.stringify(response.errors));
            error.name = 'GitHub API Error';
            throw error;
        }
        return response.data;
    }
}

/** Backward-compatibility alias */
export const GitHubAdapter = GitHubProvider;
export type GitHubAdapter = GitHubProvider;
