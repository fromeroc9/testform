import { IGitHubConfig, GitHubIssuePayload, GitHubIssueResult } from '../types';
import { notify } from '../notify';
import { Credentials } from '../core/credentials';
import { logger } from '../logger';

class Mutex {
    private mutex = Promise.resolve();
    lock(): Promise<() => void> {
        let begin: (unlock: () => void) => void = () => { };
        this.mutex = this.mutex.then(() => new Promise(begin));
        return new Promise(res => { begin = res; });
    }
}
const projectMutex = new Mutex();

export class GitHubAdapter {
    private token: string;
    private owner: string;
    private repo: string;
    private projectId?: number;
    private config: IGitHubConfig;

    constructor(config: IGitHubConfig) {
        this.config = config;
        const creds = new Credentials();
        const envToken = Object.prototype.hasOwnProperty.call(process.env, config.tokenEnv) ? process.env[config.tokenEnv] : undefined;
        let token = creds.getToken('github.com') || envToken || process.env.GITHUB_TOKEN;

        // Allow user to provide token directly instead of env var name
        if (!token && (config.tokenEnv.startsWith('ghp_') || config.tokenEnv.startsWith('github_pat_') || config.tokenEnv.startsWith('ghs_'))) {
            token = config.tokenEnv;
        }

        this.token = token || '';
        this.owner = config.owner;
        this.repo = config.repository;
        this.projectId = config.projectId;
    }

    private async ensureToken(): Promise<void> {
        if (this.token) return;

        notify.push({ type: 'error', title: `GitHub token not found`, detail: [`Environment variable "${this.config.tokenEnv}" is not set.`], close: true });
    }

    private async request(method: string, path: string, body?: any): Promise<any> {
        await this.ensureToken();
        const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

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

    /**
     * Create a GitHub Issue.
     */
    async createIssue(payload: GitHubIssuePayload): Promise<GitHubIssueResult> {
        const data = await this.request('POST', `/repos/${this.owner}/${this.repo}/issues`, {
            title: payload.title,
            body: payload.body,
            labels: payload.labels,
            assignees: payload.assignees,
            milestone: payload.milestone,
        });

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
     * Update an existing GitHub Issue.
     */
    async updateIssue(issueNumber: number, payload: Partial<GitHubIssuePayload>): Promise<GitHubIssueResult> {
        const data = await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
            title: payload.title,
            body: payload.body,
            labels: payload.labels,
            assignees: payload.assignees,
            milestone: payload.milestone,
        });

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
     * Close a GitHub Issue (soft delete).
     */
    async closeIssue(issueNumber: number): Promise<void> {
        await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
            state: 'closed',
        });
    }

    /**
     * Get a specific issue by number (for refresh).
     */
    async getIssue(issueNumber: number): Promise<GitHubIssueResult | null> {
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
     * List all issues with a specific label (for refresh/diff).
     */
    async listIssuesByLabel(label: string): Promise<GitHubIssueResult[]> {
        const results: GitHubIssueResult[] = [];
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
            // Note: In a real-world scenario with many milestones, we'd need pagination.
            const milestones = await this.request('GET', `/repos/${this.owner}/${this.repo}/milestones?state=all&per_page=100`);
            const match = milestones.find((m: any) => m.title.toLowerCase() === title.toLowerCase());
            return match ? match.number : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Create a comment on an issue.
     */
    async createIssueComment(issueNumber: number, body: string): Promise<{ id: number }> {
        const data = await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, { body });
        return { id: data.id };
    }

    /**
     * Update an existing comment.
     */
    async updateIssueComment(commentId: number, body: string): Promise<void> {
        await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`, { body });
    }

    /**
     * List all comments on an issue.
     */
    async listIssueComments(issueNumber: number): Promise<{ id: number, body: string }[]> {
        const results: { id: number, body: string }[] = [];
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



    private projectNodeId?: string;
    private projectFields?: any[];

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
            `, { login: this.owner, number: this.projectId });

            if (userResult?.user?.projectV2?.id) {
                this.projectNodeId = userResult.user.projectV2.id;
                this.projectFields = userResult.user.projectV2.fields.nodes;
                return { id: this.projectNodeId!, fields: this.projectFields! };
            }
        } catch (error) {
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
            `, { login: this.owner, number: this.projectId });

            if (orgResult?.organization?.projectV2?.id) {
                this.projectNodeId = orgResult.organization.projectV2.id;
                this.projectFields = orgResult.organization.projectV2.fields.nodes;
                return { id: this.projectNodeId!, fields: this.projectFields! };
            }
        } catch (error: any) {
            // Not an org or project not found
        }

        // If we reach here, neither user nor org query found the project
        const chalk = require('chalk');
        console.warn(chalk.yellow(`\n⚠️ Warning: Could not resolve GitHub Project V2 with ID ${this.projectId} for owner "${this.owner}".`));
        console.warn(chalk.yellow(`   If "${this.owner}" is a User account and you are authenticating via a GitHub App,`));
        console.warn(chalk.yellow(`   note that GitHub Apps are technically not allowed to access User-level Projects.`));
        console.warn(chalk.yellow(`   Please use a Personal Access Token (PAT) instead.\n`));

        return undefined;
    }


    /**
     * Add an issue to a GitHub Project v2 (GraphQL).
     * Only called if projectId is configured. Returns the Item ID inside the project.
     */
    async addToProject(issueNodeId: string): Promise<string | undefined> {
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
                // Exponential backoff: 1s, 2s, 4s...
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
            // Find field in project by name (case insensitive)
            const field = meta.fields.find(f => f.name && f.name.toLowerCase() === key.toLowerCase());
            if (!field) continue; // Field not mapped or doesn't exist in project

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
                    // Try to extract YYYY-MM-DD
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
                    const opt = field.options.find((o: any) => o.name.toLowerCase() === cleanVal.toLowerCase());
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
     * Returns a map of field name (lowercase) to its value.
     */
    async getProjectItemFields(issueNodeId: string): Promise<Record<string, string>> {
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
            // Find the project item that matches our project ID
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

    /**
     * Get the node_id of an issue (needed for GraphQL Project v2 operations).
     */
    async getIssueNodeId(issueNumber: number): Promise<string | null> {
        try {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`);
            return data.node_id ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Get the remote ID format: "owner/repo:issueNumber"
     */
    formatRemoteId(issueNumber: number): string {
        return `${this.repo}:${issueNumber}`;
    }

    /**
     * Add a sub-issue to a parent issue (REST API).
     */
    async addSubIssue(parentIssueNumber: number, subIssueId: number): Promise<void> {
        try {
            await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${parentIssueNumber}/sub_issues`, {
                sub_issue_id: subIssueId,
                replace_parent: true
            });
        } catch (error: any) {
            // Ignore if it's already a sub-issue or other non-fatal errors
            if (!error.message.includes('422')) {
                throw error;
            }
        }
    }
}
