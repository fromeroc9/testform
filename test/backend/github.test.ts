import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitHubBackend } from '../../src/backends/github';
import { IState } from '../../src/core/types';

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
        delete process.env.GITHUB_TOKEN;
        const backend = new GitHubBackend({}, 'default', 'octocat', 'my-repo');
        await expect(backend.read()).rejects.toThrow('Environment variable "GITHUB_TOKEN" is missing');
    });

    it('should throw if owner/repo are missing', async () => {
        const backend = new GitHubBackend({});
        await expect(backend.read()).rejects.toThrow("'owner' and 'repository' must be specified");
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
