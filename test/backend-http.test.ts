import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTTPBackend } from '../src/backends/http';
import { CustomBackend } from '../src/backends/custom';
import { Config } from '../src/core/config';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('HTTP and Custom Backends in Dictionary Mode', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-backend-test-'));
    });

    afterEach(() => {
        try {
            rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignore
        }
    });

    it('should parse http backend in dictionary mode without type key', () => {
        const yaml = `
backend:
  http:
    address: "https://api.example.com/state"
    lock_address: "https://api.example.com/lock"
`;
        writeFileSync(join(tmpDir, 'main.yml'), yaml, 'utf-8');

        const config = new Config(tmpDir, false);
        const backend = config.getBackend();

        expect(backend).toBeDefined();
        expect(backend?.type).toBe('http');
        expect(backend?.config.address).toBe('https://api.example.com/state');
        expect(backend?.config.lock_address).toBe('https://api.example.com/lock');
    });

    it('should parse rest backend alias in dictionary mode', () => {
        const yaml = `
backend:
  rest:
    address: "https://api.example.com/qa/state"
`;
        writeFileSync(join(tmpDir, 'main.yml'), yaml, 'utf-8');

        const config = new Config(tmpDir, false);
        const backend = config.getBackend();

        expect(backend).toBeDefined();
        expect(backend?.type).toBe('rest');
        expect(backend?.config.address).toBe('https://api.example.com/qa/state');
    });

    it('should parse custom backend with source in dictionary mode', () => {
        const yaml = `
backend:
  custom:
    source: ".testform/backends/my-backend.js"
    endpoint: "https://vault.internal.com"
    apiKey: "secret-123"
`;
        writeFileSync(join(tmpDir, 'main.yml'), yaml, 'utf-8');

        const config = new Config(tmpDir, false);
        const backend = config.getBackend();

        expect(backend).toBeDefined();
        expect(backend?.type).toBe('custom');
        expect(backend?.config.source).toBe('.testform/backends/my-backend.js');
        expect(backend?.config.endpoint).toBe('https://vault.internal.com');
        expect(backend?.config.apiKey).toBe('secret-123');
    });

    it('should read, write, and lock state using HTTPBackend', async () => {
        const mockState: any = {
            version: '1.0.0',
            serial: 1,
            lineage: 'test-lineage',
            lastSync: new Date().toISOString(),
            resources: []
        };

        const originalFetch = global.fetch;
        let remoteState: string = JSON.stringify(mockState);
        let locked = false;

        global.fetch = vi.fn().mockImplementation(async (url: string, options: any = {}) => {
            const method = options.method || 'GET';

            if (url.includes('/lock')) {
                if (method === 'POST') {
                    locked = true;
                    return new Response(JSON.stringify({ status: 'locked' }), { status: 200 });
                }
                if (method === 'DELETE') {
                    locked = false;
                    return new Response(JSON.stringify({ status: 'unlocked' }), { status: 200 });
                }
            }

            if (method === 'GET') {
                return new Response(remoteState, { status: 200 });
            }

            if (method === 'POST') {
                remoteState = options.body;
                return new Response(JSON.stringify({ status: 'saved' }), { status: 200 });
            }

            return new Response('Not found', { status: 404 });
        });

        try {
            const httpBackend = new HTTPBackend({
                address: 'https://api.example.com/state',
                lock_address: 'https://api.example.com/lock',
                unlock_address: 'https://api.example.com/lock'
            });

            // Exists
            const exists = await httpBackend.exists();
            expect(exists).toBe(true);

            // Read
            const state = await httpBackend.read();
            expect(state.serial).toBe(1);

            // Lock
            const lockSuccess = await httpBackend.lock('0s');
            expect(lockSuccess).toBe(true);
            expect(locked).toBe(true);

            // Write
            mockState.serial = 2;
            await httpBackend.write(mockState);
            const updated = await httpBackend.read();
            expect(updated.serial).toBe(2);

            // Unlock
            const unlockSuccess = await httpBackend.unlock();
            expect(unlockSuccess).toBe(true);
            expect(locked).toBe(false);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should load and delegate to custom backend class', async () => {
        const backendsDir = join(tmpDir, '.testform', 'backends');
        mkdirSync(backendsDir, { recursive: true });

        const customScript = `
class MockBackend {
    constructor(config, workspace) {
        this.config = config;
        this.workspace = workspace;
    }
    async read() { return { version: '1.0.0', serial: 99, resources: [] }; }
    async exists() { return true; }
    async write(state) {}
    async lock() { return true; }
    async unlock() { return true; }
    async forceUnlock() { return { success: true }; }
    async isLocked() { return false; }
    async listWorkspaces() { return ['default', 'staging']; }
    async deleteWorkspace() { return true; }
}
module.exports = MockBackend;
`;
        writeFileSync(join(backendsDir, 'mock.js'), customScript, 'utf-8');

        const customBackend = new CustomBackend(
            { source: '.testform/backends/mock.js', customParam: 'hello' },
            'staging',
            tmpDir
        );

        expect(await customBackend.exists()).toBe(true);
        const state = await customBackend.read();
        expect(state.serial).toBe(99);
        const workspaces = await customBackend.listWorkspaces();
        expect(workspaces).toEqual(['default', 'staging']);
    });
});

