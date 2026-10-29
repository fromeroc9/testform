import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ephemeralCmd, getEphemeralBaseDir, getEphemeralSandboxDir, isValidSandboxId } from '../src/commands/ephemeral';
import { applyCmd } from '../src/commands/apply';
import { destroyCmd } from '../src/commands/destroy';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../src/commands/apply');
vi.mock('../src/commands/destroy');

describe('Command ephemeralCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-ephemeral-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (applyCmd as any).mockClear();
        (destroyCmd as any).mockClear();

        (applyCmd as any).mockResolvedValue(undefined);
        (destroyCmd as any).mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        mockError.mockRestore();
        vi.restoreAllMocks();
    });

    it('should validate sandbox IDs correctly', () => {
        expect(isValidSandboxId('pr-42')).toBe(true);
        expect(isValidSandboxId('branch_login_v2')).toBe(true);
        expect(isValidSandboxId('test.sandbox.1')).toBe(true);
        expect(isValidSandboxId('pr/42')).toBe(false);
        expect(isValidSandboxId('pr 42')).toBe(false);
        expect(isValidSandboxId('../escape')).toBe(false);
    });

    it('should fail if no subcommand is provided', async () => {
        await expect(ephemeralCmd({ dir: tmpDir, subcommand: '' })).rejects.toThrow();
        expect(mockError).toHaveBeenCalled();
    });

    it('should fail if unknown subcommand is provided', async () => {
        await expect(ephemeralCmd({ dir: tmpDir, subcommand: 'unknown' })).rejects.toThrow();
        expect(mockError).toHaveBeenCalled();
    });

    describe('ephemeral up', () => {
        it('should reject missing sandbox id', async () => {
            await expect(ephemeralCmd({ dir: tmpDir, subcommand: 'up' })).rejects.toThrow();
            expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Expected an ephemeral sandbox ID'));
        });

        it('should reject invalid sandbox id format', async () => {
            await expect(ephemeralCmd({ dir: tmpDir, subcommand: 'up', id: 'invalid/id' })).rejects.toThrow();
            expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Invalid sandbox ID'));
        });

        it('should create sandbox directory, metadata, and invoke applyCmd with isolated state', async () => {
            await ephemeralCmd({
                dir: tmpDir,
                subcommand: 'up',
                id: 'pr-101',
                autoApprove: true,
                scope: 'testcase'
            });

            const sandboxDir = getEphemeralSandboxDir(tmpDir, 'pr-101');
            expect(existsSync(sandboxDir)).toBe(true);

            const metaFile = join(sandboxDir, 'metadata.json');
            expect(existsSync(metaFile)).toBe(true);

            const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
            expect(meta.id).toBe('pr-101');
            expect(meta.scope).toBe('testcase');
            expect(meta.createdAt).toBeDefined();

            expect(applyCmd).toHaveBeenCalledWith(expect.objectContaining({
                dir: tmpDir,
                autoApprove: true,
                target: 'testcase',
                statePath: join(sandboxDir, 'testform.state'),
                backupPath: join(sandboxDir, 'testform.state.backup')
            }));

            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Initializing ephemeral QA sandbox: pr-101');
            expect(logs).toContain('successfully deployed');
        });
    });

    describe('ephemeral down', () => {
        it('should reject missing sandbox id', async () => {
            await expect(ephemeralCmd({ dir: tmpDir, subcommand: 'down' })).rejects.toThrow();
            expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Expected an ephemeral sandbox ID'));
        });

        it('should warn gracefully if sandbox does not exist and force is false', async () => {
            await ephemeralCmd({ dir: tmpDir, subcommand: 'down', id: 'non-existent' });

            expect(destroyCmd).not.toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('No active ephemeral sandbox found with ID "non-existent"');
        });

        it('should invoke destroyCmd and delete isolated sandbox folder', async () => {
            const sandboxDir = getEphemeralSandboxDir(tmpDir, 'pr-202');
            mkdirSync(sandboxDir, { recursive: true });
            const statePath = join(sandboxDir, 'testform.state');
            writeFileSync(statePath, JSON.stringify({ resources: [{ identity: 'login' }] }));

            await ephemeralCmd({
                dir: tmpDir,
                subcommand: 'down',
                id: 'pr-202',
                autoApprove: true
            });

            expect(destroyCmd).toHaveBeenCalledWith(expect.objectContaining({
                dir: tmpDir,
                autoApprove: true,
                statePath
            }));

            // Ensure directory is deleted
            expect(existsSync(sandboxDir)).toBe(false);
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('is completely destroyed');
        });
    });

    describe('ephemeral list and show', () => {
        it('should list empty message when no sandboxes exist', async () => {
            await ephemeralCmd({ dir: tmpDir, subcommand: 'list' });
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('No active ephemeral sandboxes found');
        });

        it('should list empty json array when no sandboxes exist with --json', async () => {
            await ephemeralCmd({ dir: tmpDir, subcommand: 'list', json: true });
            expect(mockLog).toHaveBeenCalledWith('[]');
        });

        it('should list active sandboxes in table and json formats', async () => {
            const s1 = getEphemeralSandboxDir(tmpDir, 'pr-1');
            const s2 = getEphemeralSandboxDir(tmpDir, 'pr-2');
            mkdirSync(s1, { recursive: true });
            mkdirSync(s2, { recursive: true });

            writeFileSync(join(s1, 'testform.state'), JSON.stringify({ resources: [{ identity: 'tc1' }, { identity: 'tc2' }] }));
            writeFileSync(join(s1, 'metadata.json'), JSON.stringify({ id: 'pr-1', createdAt: '2026-10-18T10:00:00Z', scope: 'testcase' }));

            writeFileSync(join(s2, 'testform.state'), JSON.stringify({ resources: [{ identity: 'tc3' }] }));
            writeFileSync(join(s2, 'metadata.json'), JSON.stringify({ id: 'pr-2', createdAt: '2026-10-18T11:00:00Z', scope: 'all' }));

            // List table
            await ephemeralCmd({ dir: tmpDir, subcommand: 'list' });
            const tableLogs = mockLog.mock.calls.join(' ');
            expect(tableLogs).toContain('pr-1');
            expect(tableLogs).toContain('pr-2');
            expect(tableLogs).toContain('Active Ephemeral Sandboxes (2)');

            // List JSON
            mockLog.mockClear();
            await ephemeralCmd({ dir: tmpDir, subcommand: 'list', json: true });
            const jsonCall = mockLog.mock.calls[0][0];
            const parsed = JSON.parse(jsonCall);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].id).toBe('pr-1');
            expect(parsed[0].resourcesCount).toBe(2);
        });

        it('should show sandbox details', async () => {
            const s1 = getEphemeralSandboxDir(tmpDir, 'pr-show');
            mkdirSync(s1, { recursive: true });
            writeFileSync(join(s1, 'testform.state'), JSON.stringify({
                resources: [{ type: 'github_testcase', identity: 'login.feature::tc_1', attributes: { issueNumber: 77 } }]
            }));
            writeFileSync(join(s1, 'metadata.json'), JSON.stringify({ id: 'pr-show', createdAt: '2026-10-18T10:00:00Z', scope: 'testcase' }));

            await ephemeralCmd({ dir: tmpDir, subcommand: 'show', id: 'pr-show' });
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Ephemeral Sandbox: pr-show');
            expect(logs).toContain('login.feature::tc_1');
            expect(logs).toContain('#77');
        });
    });
});
