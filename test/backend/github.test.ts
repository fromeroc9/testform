import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitHubBackend } from '../../src/backends/github';
import { IState } from '../../src/core/types';
import { Credentials } from '../../src/core/credentials';

describe('GitHub Backend', () => {
    const originalFetch = global.fetch;
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv, GITHUB_TOKEN: 'ghp_test_token' };
    });

    afterEach(() => {
        global.fetch = originalFetch;
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it('should throw if token is missing', async () => {
        vi.spyOn(Credentials.prototype, 'getToken').mockReturnValue(undefined);
        delete process.env.GITHUB_TOKEN;
        delete process.env.GH_TOKEN;
        const backend = new GitHubBackend({}, 'default', 'octocat', 'my-repo');
        await expect(backend.read()).rejects.toThrow('Environment variable "GITHUB_TOKEN" is not set');
    });

    it('should parse owner and repo when repository is in "owner/repo" format', () => {
        const backend = new GitHubBackend({ repo: 'my-org/my-state-repo' });
        expect((backend as any).owner).toBe('my-org');
        expect((backend as any).repository).toBe('my-state-repo');
    });

    it('should fallback to GH_TOKEN when GITHUB_TOKEN is not set', () => {
        vi.spyOn(Credentials.prototype, 'getToken').mockReturnValue(undefined);
        delete process.env.GITHUB_TOKEN;
        process.env.GH_TOKEN = 'gh_fallback_token';
        const backend = new GitHubBackend({}, 'default', 'octocat', 'my-repo');
        expect((backend as any).token).toBe('gh_fallback_token');
    });

    it('should respect custom token_env in error message', async () => {
        vi.spyOn(Credentials.prototype, 'getToken').mockReturnValue(undefined);
        delete process.env.GITHUB_TOKEN;
        delete process.env.GH_TOKEN;
        delete process.env.CUSTOM_TOKEN;
        const backend = new GitHubBackend({ token_env: 'CUSTOM_TOKEN' }, 'default', 'octocat', 'my-repo');
        await expect(backend.read()).rejects.toThrow('Environment variable "CUSTOM_TOKEN" is not set');
    });

    it('should throw if owner/repo are missing', async () => {
        const backend = new GitHubBackend({});
        await expect(backend.read()).rejects.toThrow("The GitHub backend requires 'owner' and 'repository'");
    });

    it('should return empty state when file does not exist (404)', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found'
        } as Response) as any;

        const backend = new GitHubBackend({}, 'default', 'octocat', 'my-repo');
        const state = await backend.read();

        expect(state.version).toBe('1.0');
        expect(state.resources).toEqual([]);
        expect(state.serial).toBe(0);
    });

    it('should read and decode state from base64 content', async () => {
        const mockState: IState = {
            version: '1.0',
            serial: 5,
            lineage: 'test-lineage',
            lastSync: '2026-10-18T20:00:00Z',
            resources: []
        };
        const base64Content = Buffer.from(JSON.stringify(mockState)).toString('base64');

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                sha: 'blob-sha-123',
                content: base64Content,
                encoding: 'base64'
            })
        } as Response) as any;

        const backend = new GitHubBackend({}, 'default', 'octocat', 'my-repo');
        const state = await backend.read();

        expect(state.serial).toBe(5);
        expect(state.lineage).toBe('test-lineage');
    });

    it('should write state to GitHub with commit message and sha', async () => {
        const mockFetch = vi.fn()
            // First call: branch check
            .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
            // Second call: check if file exists (returns 404)
            .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
            // Third call: PUT file
            .mockResolvedValueOnce({
                ok: true,
                status: 201,
                json: async () => ({ content: { sha: 'new-sha-456' } })
            } as Response);

        global.fetch = mockFetch as any;

        const backend = new GitHubBackend({ branch: 'state-branch' }, 'default', 'octocat', 'my-repo');
        const stateToWrite: IState = {
            version: '1.0',
            serial: 1,
            lineage: 'lin-1',
            lastSync: '',
            resources: []
        };

        await backend.write(stateToWrite);

        expect(mockFetch).toHaveBeenCalledTimes(3);
        const putCall = mockFetch.mock.calls[2];
        expect(putCall[0]).toContain('/contents/testform.state');
        const body = JSON.parse((putCall[1] as any)?.body as string);
        expect(body.branch).toBe('state-branch');
        expect(body.message).toContain('serial: 1');
    });

    it('should initialize empty repository when default branch ref returns 404', async () => {
        const mockFetch = vi.fn()
            // 1. branch check -> 404
            .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
            // 2. repo check -> ok, default_branch = main
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ default_branch: 'main' }) } as Response)
            // 3. ref check -> 404 (empty repo, no commits)
            .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
            // 4. init commit README.md -> 201 Created
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) } as Response)
            // 5. ref check retry -> 200 OK
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ object: { sha: 'initial-commit-sha' } }) } as Response)
            // 6. create ref for custom branch -> 201 Created
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) } as Response)
            // 7. check existing file -> 404
            .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
            // 8. PUT testform.state -> 201 Created
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ content: { sha: 'state-sha' } }) } as Response);

        global.fetch = mockFetch as any;

        const backend = new GitHubBackend({ branch: 'testform-state' }, 'default', 'octocat', 'empty-repo');
        const stateToWrite: IState = {
            version: '1.0',
            serial: 1,
            lineage: 'lin-empty',
            lastSync: '',
            resources: []
        };

        await backend.write(stateToWrite);

        // Verify that README was initialized
        const initCall = mockFetch.mock.calls[3];
        expect(initCall[0]).toContain('/contents/README.md');
        // Verify that state file was created
        const writeCall = mockFetch.mock.calls[7];
        expect(writeCall[0]).toContain('/contents/testform.state');
    });

    it('should throw on 409 conflict during write', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200 } as Response) // branch check
            .mockResolvedValueOnce({ ok: false, status: 404 } as Response) // file check
            .mockResolvedValueOnce({
                ok: false,
                status: 409,
                text: async () => 'Conflict'
            } as Response); // write returns 409

        global.fetch = mockFetch as any;

        const backend = new GitHubBackend({}, 'default', 'octocat', 'my-repo');
        await expect(backend.write({ version: '1.0', serial: 1, lineage: 'l', lastSync: '', resources: [] }))
            .rejects.toThrow('GitHub Backend State Conflict');
    });

    it('should isolate workspace states in env/<workspace>/ path', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

        global.fetch = mockFetch as any;

        const backend = new GitHubBackend({}, 'staging', 'octocat', 'my-repo');
        await backend.exists();

        const url = mockFetch.mock.calls[0][0] as string;
        expect(url).toContain('/contents/env/staging/testform.state');
    });
});
