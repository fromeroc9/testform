import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitLabProvider } from '../../src/providers/gitlab';

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

        // apis.issue.delete (closes issue)
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: 200, iid: 20, state: 'closed' })
        });
        await provider.apis.issue.delete!(20);
        expect(fetchMock).toHaveBeenCalledTimes(4);
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
});

