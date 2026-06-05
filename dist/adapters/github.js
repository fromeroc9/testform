"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubAdapter = void 0;
const notify_1 = require("../notify");
const credentials_1 = require("../core/credentials");
class GitHubAdapter {
    token;
    owner;
    repo;
    projectId;
    constructor(config) {
        const creds = new credentials_1.Credentials();
        const envToken = Object.prototype.hasOwnProperty.call(process.env, config.tokenEnv) ? process.env[config.tokenEnv] : undefined;
        let token = creds.getToken('github.com') || envToken || process.env.GITHUB_TOKEN;
        // Allow user to provide token directly instead of env var name
        if (!token && (config.tokenEnv.startsWith('ghp_') || config.tokenEnv.startsWith('github_pat_'))) {
            token = config.tokenEnv;
        }
        if (!token) {
            notify_1.notify.push({ type: 'error', title: `GitHub token not found`, detail: [`Environment variable "${config.tokenEnv}" is not set.`], close: true });
        }
        this.token = token || '';
        this.owner = config.owner;
        this.repo = config.repository;
        this.projectId = config.projectId;
    }
    async request(method, path, body) {
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
    async graphql(query, variables = {}) {
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
    async createIssue(payload) {
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
    async updateIssue(issueNumber, payload) {
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
    async closeIssue(issueNumber) {
        await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
            state: 'closed',
        });
    }
    /**
     * Get a specific issue by number (for refresh).
     */
    async getIssue(issueNumber) {
        try {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`);
            return {
                id: data.id,
                number: data.number,
                title: data.title ?? '',
                body: data.body ?? '',
                state: data.state,
                node_id: data.node_id,
                labels: data.labels?.map((l) => l.name) ?? [],
                assignees: data.assignees?.map((a) => a.login) ?? [],
                milestone: data.milestone?.title ?? '',
            };
        }
        catch {
            return null;
        }
    }
    /**
     * List all issues with a specific label (for refresh/diff).
     */
    async listIssuesByLabel(label) {
        const results = [];
        let page = 1;
        while (true) {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100&page=${page}`);
            if (data.length === 0)
                break;
            for (const issue of data) {
                results.push({
                    id: issue.id,
                    number: issue.number,
                    title: issue.title ?? '',
                    state: issue.state,
                });
            }
            if (data.length < 100)
                break;
            page++;
        }
        return results;
    }
    /**
     * Look up a milestone's ID by its title (case-insensitive).
     */
    async getMilestoneByTitle(title) {
        if (!title)
            return undefined;
        try {
            // Note: In a real-world scenario with many milestones, we'd need pagination.
            const milestones = await this.request('GET', `/repos/${this.owner}/${this.repo}/milestones?state=all&per_page=100`);
            const match = milestones.find((m) => m.title.toLowerCase() === title.toLowerCase());
            return match ? match.number : undefined;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Create a comment on an issue.
     */
    async createIssueComment(issueNumber, body) {
        const data = await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, { body });
        return { id: data.id };
    }
    /**
     * Update an existing comment.
     */
    async updateIssueComment(commentId, body) {
        await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`, { body });
    }
    /**
     * List all comments on an issue.
     */
    async listIssueComments(issueNumber) {
        const results = [];
        let page = 1;
        while (true) {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
            if (data.length === 0)
                break;
            for (const comment of data) {
                results.push({ id: comment.id, body: comment.body });
            }
            if (data.length < 100)
                break;
            page++;
        }
        return results;
    }
    projectNodeId;
    projectFields;
    /**
     * Resolve the GraphQL node ID for a Project V2 and cache its fields.
     */
    async resolveProjectMetadata() {
        if (this.projectNodeId && this.projectFields)
            return { id: this.projectNodeId, fields: this.projectFields };
        if (!this.projectId)
            return undefined;
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
                return { id: this.projectNodeId, fields: this.projectFields };
            }
        }
        catch (error) {
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
                return { id: this.projectNodeId, fields: this.projectFields };
            }
        }
        catch (error) {
            // Not an org or project not found
        }
        return undefined;
    }
    /**
     * Add an issue to a GitHub Project v2 (GraphQL).
     * Only called if projectId is configured. Returns the Item ID inside the project.
     */
    async addToProject(issueNodeId) {
        const meta = await this.resolveProjectMetadata();
        if (!meta)
            return undefined;
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
            return res?.addProjectV2ItemById?.item?.id;
        }
        catch (e) {
            const error = new Error('Failed to link issue to GitHub Project');
            error.name = e.message;
            throw error;
        }
    }
    /**
     * Update fields of a Project V2 item (GraphQL).
     */
    async updateProjectItemFields(itemId, customFields) {
        const meta = await this.resolveProjectMetadata();
        if (!meta || !meta.fields)
            return;
        for (const [key, val] of Object.entries(customFields)) {
            // Find field in project by name (case insensitive)
            const field = meta.fields.find(f => f.name && f.name.toLowerCase() === key.toLowerCase());
            if (!field)
                continue; // Field not mapped or doesn't exist in project
            let fieldValue = undefined;
            if (field.dataType === 'TEXT') {
                if (val !== undefined && val !== null) {
                    fieldValue = { text: String(val) };
                }
            }
            else if (field.dataType === 'NUMBER') {
                if (val !== undefined && val !== null) {
                    const parsedNumber = Number(val);
                    if (!isNaN(parsedNumber)) {
                        fieldValue = { number: parsedNumber };
                    }
                }
            }
            else if (field.dataType === 'DATE') {
                if (val !== undefined && val !== null) {
                    // Try to extract YYYY-MM-DD
                    const dateStr = String(val).split('T')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                        fieldValue = { date: dateStr };
                    }
                    else {
                        // Fallback, let GitHub API reject if invalid
                        fieldValue = { date: String(val) };
                    }
                }
            }
            else if (field.dataType === 'SINGLE_SELECT' && field.options) {
                // Find option ID by name (case insensitive, ignoring '@' prefix)
                if (typeof val !== 'string')
                    continue;
                const cleanVal = val.startsWith('@') ? val.substring(1) : val;
                const opt = field.options.find((o) => o.name.toLowerCase() === cleanVal.toLowerCase());
                if (opt) {
                    fieldValue = { singleSelectOptionId: opt.id };
                }
            }
            else if (field.dataType === 'ITERATION' && field.configuration?.iterations) {
                if (typeof val !== 'string')
                    continue;
                const cleanVal = val.startsWith('@') ? val.substring(1) : val;
                const opt = field.configuration.iterations.find((o) => o.title.toLowerCase() === cleanVal.toLowerCase());
                if (opt) {
                    fieldValue = { iterationId: opt.id };
                }
            }
            if (!fieldValue)
                continue;
            try {
                await this.graphql(`
                    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
                        updateProjectV2ItemFieldValue(input: {
                            projectId: $projectId
                            itemId: $itemId
                            fieldId: $fieldId
                            value: $value
                        }) { projectV2Item { id } }
                    }
                `, {
                    projectId: meta.id,
                    itemId: itemId,
                    fieldId: field.id,
                    value: fieldValue
                });
            }
            catch (e) {
                const error = new Error(`Failed to assign custom field`);
                error.name = `${field.name}: ${e.message}`;
                throw error;
            }
        }
    }
    /**
     * Get fields of a Project V2 item (GraphQL).
     * Returns a map of field name (lowercase) to its value.
     */
    async getProjectItemFields(issueNodeId) {
        const meta = await this.resolveProjectMetadata();
        if (!meta || !meta.fields)
            return {};
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
            const item = projectItems.find((i) => i.project?.id === meta.id);
            if (!item || !item.fieldValues || !item.fieldValues.nodes)
                return {};
            const customFields = Object.create(null);
            for (const val of item.fieldValues.nodes) {
                const fieldName = val.field?.name;
                if (!fieldName)
                    continue;
                let stringValue = '';
                if (val.text !== undefined)
                    stringValue = val.text;
                else if (val.name !== undefined)
                    stringValue = val.name;
                else if (val.title !== undefined)
                    stringValue = val.title;
                customFields[fieldName.toLowerCase()] = stringValue;
            }
            return customFields;
        }
        catch {
            return {};
        }
    }
    /**
     * Get the node_id of an issue (needed for GraphQL Project v2 operations).
     */
    async getIssueNodeId(issueNumber) {
        try {
            const data = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`);
            return data.node_id ?? null;
        }
        catch {
            return null;
        }
    }
    /**
     * Get the remote ID format: "owner/repo:issueNumber"
     */
    formatRemoteId(issueNumber) {
        return `${this.repo}:${issueNumber}`;
    }
    /**
     * Add a sub-issue to a parent issue (REST API).
     */
    async addSubIssue(parentIssueNumber, subIssueId) {
        try {
            await this.request('POST', `/repos/${this.owner}/${this.repo}/issues/${parentIssueNumber}/sub_issues`, {
                sub_issue_id: subIssueId,
                replace_parent: true
            });
        }
        catch (error) {
            // Ignore if it's already a sub-issue or other non-fatal errors
            if (!error.message.includes('422')) {
                throw error;
            }
        }
    }
}
exports.GitHubAdapter = GitHubAdapter;
