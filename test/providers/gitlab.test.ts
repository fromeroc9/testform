import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitLabProvider } from '../../src/providers/gitlab';
import { formatGitLabMetadataSection } from '../../src/providers/gitlab/templates';

describe('GitLabProvider', () => {
    let provider: GitLabProvider;
    let fetchMock: any;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        provider = new GitLabProvider({
            host: 'https://gitlab.example.com',
            projectId: 'my-group/my-project',
            token: 'glpat-test-token'
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates an issue on GitLab API', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({
                id: 101,
                iid: 5,
                title: 'New GitLab Issue',
                description: 'Issue description body',
                state: 'opened',
                labels: ['testcase', 'smoke'],
                assignees: [{ username: 'john_doe' }],
                milestone: { id: 12, title: 'v1.0' },
                created_at: '2026-10-30T00:00:00Z',
                updated_at: '2026-10-30T00:00:00Z'
            })
        });

        const result = await provider.createIssue({
            title: 'New GitLab Issue',
            body: 'Issue description body',
            labels: ['testcase', 'smoke'],
            milestone: 12
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues');
        expect(options.method).toBe('POST');
        expect(options.headers['PRIVATE-TOKEN']).toBe('glpat-test-token');
        expect(JSON.parse(options.body)).toEqual({
            title: 'New GitLab Issue',
            description: 'Issue description body',
            labels: 'testcase,smoke',
            milestone_id: 12
        });

        expect(result.id).toBe(101);
        expect(result.number).toBe(5);
        expect(result.state).toBe('open');
        expect(result.node_id).toBe('gl_node_101');
        expect(result.labels).toEqual(['testcase', 'smoke']);
        expect(result.assignees).toEqual(['john_doe']);
        expect(provider.formatRemoteId(result.number)).toBe('GL#5');
    });

    it('updates an issue on GitLab API', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                id: 101,
                iid: 5,
                title: 'Updated title',
                description: 'Updated body',
                state: 'closed',
                labels: ['testcase'],
                assignees: []
            })
        });

        const result = await provider.updateIssue(5, {
            title: 'Updated title',
            body: 'Updated body',
            state: 'closed'
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues/5');
        expect(options.method).toBe('PUT');
        expect(JSON.parse(options.body)).toEqual({
            title: 'Updated title',
            description: 'Updated body',
            state_event: 'close'
        });
        expect(result.title).toBe('Updated title');
    });

    it('closes an issue on GitLab API', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: 101, iid: 5, state: 'closed' })
        });

        await provider.closeIssue(5);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues/5');
        expect(options.method).toBe('PUT');
        expect(JSON.parse(options.body)).toEqual({ state_event: 'close' });
    });

    it('retrieves an issue or returns null on 404', async () => {
        // Success case
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: 101, iid: 5, title: 'Found issue', state: 'opened' })
        });

        const found = await provider.getIssue(5);
        expect(found?.title).toBe('Found issue');

        // 404 case
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ message: '404 Not found' })
        });

        const notFound = await provider.getIssue(999);
        expect(notFound).toBeNull();
    });

    it('lists issues filtered by label', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
                { id: 1, iid: 10, title: 'TC 1', labels: ['testcase', 'smoke'] },
                { id: 2, iid: 11, title: 'TC 2', labels: ['testcase'] }
            ]
        });

        const issues = await provider.listIssuesByLabel('testcase');
        expect(issues.length).toBe(2);
        expect(issues[0].number).toBe(10);
        expect(issues[1].number).toBe(11);
    });

    it('dispatches operations via agnostic apis interface', async () => {
        // apis.issue.create
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ id: 200, iid: 20, title: 'API Issue', state: 'opened' })
        });

        const created = await provider.apis.issue.create!({
            title: 'API Issue',
            body: 'body',
            labels: ['testcase']
        });
        expect(created.number).toBe(20);

        // apis.issue.get
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: 200, iid: 20, title: 'API Issue', state: 'opened' })
        });
        const fetched = await provider.apis.issue.get!(20);
        expect(fetched?.id).toBe(200);

        // apis.issue.update
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: 200, iid: 20, title: 'API Issue Edited', state: 'opened' })
        });
        const updated = await provider.apis.issue.update!(20, { title: 'API Issue Edited' });
        expect(updated.title).toBe('API Issue Edited');

        // apis.issue.delete (permanently deletes issue)
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 204
        });
        await provider.apis.issue.delete!(20);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        const [deleteUrl, deleteOpts] = fetchMock.mock.calls[3];
        expect(deleteUrl).toBe('https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues/20');
        expect(deleteOpts.method).toBe('DELETE');
    });

    it('permanently deletes an issue on GitLab API, handles 404 idempotently, and falls back to close on 403', async () => {
        // 1. Direct delete (204)
        fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });
        await provider.resources.testcase.delete!('GL#7');
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues/7',
            expect.objectContaining({ method: 'DELETE' })
        );

        // 2. 404 idempotent no-op
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ message: '404 Not found' })
        });
        await expect(provider.deleteIssue(999)).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // 3. 403 permission error falls back to closeIssue (PUT state_event=close)
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: async () => ({ message: '403 Forbidden' })
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ id: 105, iid: 8, state: 'closed' })
            });

        await provider.deleteIssue(8);
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            'https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues/8',
            expect.objectContaining({ method: 'DELETE' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            4,
            'https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues/8',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ state_event: 'close' })
            })
        );
        warnSpy.mockRestore();
    });

    it('links sub-issues using relates_to issue link API', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ issue_link_id: 99 })
        });

        await provider.addSubIssue(5, 10);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues/5/links');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({
            target_project_id: 'my-group/my-project',
            target_issue_iid: 10,
            link_type: 'relates_to'
        });
    });

    it('resolves assignees by username and passes assignee_ids', async () => {
        // Mock user lookup
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [{ id: 456, username: 'fromeroc9' }]
        });
        // Mock issue creation
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({
                id: 102,
                iid: 6,
                title: 'Assigned Issue',
                state: 'opened',
                assignees: [{ username: 'fromeroc9' }]
            })
        });

        const result = await provider.createIssue({
            title: 'Assigned Issue',
            body: 'steps',
            labels: [],
            assignees: ['fromeroc9']
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [lookupUrl] = fetchMock.mock.calls[0];
        expect(lookupUrl).toBe('https://gitlab.example.com/api/v4/users?username=fromeroc9');

        const [createUrl, createOpts] = fetchMock.mock.calls[1];
        expect(createUrl).toBe('https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project/issues');
        const body = JSON.parse(createOpts.body);
        expect(body.assignee_ids).toEqual([456]);
        expect(result.assignees).toEqual(['fromeroc9']);
    });

    it('falls back to /assign quick action when user lookup fails', async () => {
        // Mock user lookup 403 or empty
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => []
        });
        // Mock project members lookup empty
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => []
        });
        // Mock issue creation
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({
                id: 103,
                iid: 7,
                title: 'Fallback Issue',
                state: 'opened'
            })
        });

        await provider.createIssue({
            title: 'Fallback Issue',
            body: '```gherkin\nGiven user is logged in\n```',
            labels: [],
            assignees: ['fromeroc9']
        });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const [, createOpts] = fetchMock.mock.calls[2];
        const body = JSON.parse(createOpts.body);
        expect(body.description).toContain('/assign @fromeroc9');
    });

    it('accepts project_id or projectId and defaults host to https://gitlab.com', () => {
        const p1 = new GitLabProvider({
            project_id: 'owner/project'
        });
        expect((p1 as any).host).toBe('https://gitlab.com');
        expect((p1 as any).projectId).toBe('owner/project');

        const p2 = new GitLabProvider({
            projectId: '12345'
        });
        expect((p2 as any).host).toBe('https://gitlab.com');
        expect((p2 as any).projectId).toBe('12345');
    });

    it('uploads local image attachments and updates markdown description during createIssue', async () => {
        vi.spyOn(provider as any, 'uploadAttachment').mockResolvedValue('/uploads/abcd/photo.png');

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({
                id: 104,
                iid: 8,
                title: 'Bug Issue with photo',
                description: '### 📸 Evidence\n![Evidence](/uploads/abcd/photo.png)',
                state: 'opened'
            })
        });

        await provider.createIssue({
            title: 'Bug Issue with photo',
            body: '### 📸 Evidence\n![Evidence](photo.png)',
            labels: ['bug']
        });

        expect((provider as any).uploadAttachment).toHaveBeenCalledWith('photo.png');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, createOpts] = fetchMock.mock.calls[0];
        const sentBody = JSON.parse(createOpts.body);
        expect(sentBody.description).toContain('![Evidence](/uploads/abcd/photo.png)');
    });

    it('links testruns to testplan via relates_to, but does NOT link testcases to testruns', async () => {
        const linkSpy = vi.spyOn(provider, 'addSubIssue').mockResolvedValue(undefined);

        const mockState = {
            getResources: (type: string) => {
                if (type === 'testrun') {
                    return [
                        { path: 'checkout.run.feature', address: 'gitlab.testrun.checkout.run.feature', attributes: { issueNumber: 20 } }
                    ];
                }
                if (type === 'testcase') {
                    return [
                        { path: 'cart.case.feature', address: 'gitlab.testcase.cart.case.feature.@tc-01', attributes: { issueNumber: 30 } }
                    ];
                }
                return [];
            }
        };

        // 1. Calling for testplan should trigger addSubIssue for matched testruns
        await (provider as any).linkRelatedResources('testplan', 10, {
            scenario: { custom: { testruns: ['checkout.run.feature'] } },
            state: mockState
        });
        expect(linkSpy).toHaveBeenCalledWith(10, 20);

        linkSpy.mockClear();

        // 2. Calling for testrun should NOT link testcases
        await (provider as any).linkRelatedResources('testrun', 20, {
            scenario: { custom: { testcases: ['cart.case.feature.@tc-01'] } },
            state: mockState
        });
        expect(linkSpy).not.toHaveBeenCalled();
    });

    it('strips leading @ from Gherkin tags in metadata section to prevent GitLab user mentions', () => {
        const scenario = {
            custom: {
                fields: {
                    project: 'Magento',
                    priority: '@Low',
                    module: 'catalog',
                    tags: ['@smoke', '@regression']
                }
            }
        };

        const result = formatGitLabMetadataSection(scenario);
        expect(result).toContain('| **Project** | Magento |');
        expect(result).toContain('| **Priority** | Low |');
        expect(result).toContain('| **Module** | catalog |');
        expect(result).toContain('| **Tags** | smoke, regression |');
        expect(result).not.toContain('@Low');
        expect(result).not.toContain('@smoke');
    });
});

