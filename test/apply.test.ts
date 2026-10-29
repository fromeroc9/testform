import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { applyCmd } from '../src/commands/apply';
import { State } from '../src/core/state';
import { Parser } from '../src/core/parser';
import { Config } from '../src/core/config';
import { createCommandContext } from '../src/core/context';
import { askApproval } from '../src/core/prompt';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

vi.mock('../src/core/state');
vi.mock('../src/core/parser');
vi.mock('../src/core/config');
vi.mock('../src/core/context');
vi.mock('../src/core/prompt');
vi.mock('../src/core/policy');

describe('Command applyCmd', () => {
    let tmpDir: string;
    let mockGithub: any;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-apply-test-'));
        mockLog.mockClear();
        mockError.mockClear();
        mockExit.mockClear();
        (State as any).mockClear();
        (Parser as any).mockClear();
        (Config as any).mockClear();
        vi.mocked(createCommandContext).mockClear();
        vi.mocked(askApproval).mockClear();

        (Config as any).mockImplementation(function() {
            return {
                getIdentity: vi.fn().mockReturnValue('testcase.*'),
                getFields: vi.fn().mockReturnValue([])
            };
        });

        mockGithub = {
            createIssue: vi.fn<any>().mockResolvedValue({ number: 123, node_id: 'node-1' }),
            addToProject: vi.fn<any>().mockResolvedValue('item-1'),
            updateProjectItemFields: vi.fn<any>().mockResolvedValue(true),
            updateIssue: vi.fn<any>().mockResolvedValue({ number: 123, node_id: 'node-1' }),
            closeIssue: vi.fn<any>().mockResolvedValue(true),
            formatRemoteId: vi.fn().mockReturnValue('remote-id-1')
        };

        vi.mocked(createCommandContext).mockResolvedValue({ github: mockGithub } as any);
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockLog.mockRestore();
        mockError.mockRestore();
        mockExit.mockRestore();
        vi.restoreAllMocks();
    });

    it('should ask for approval and exit if denied', async () => {
        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        vi.mocked(askApproval).mockResolvedValue(false as any);

        await applyCmd({ dir: tmpDir, target: 'testcase', refresh: false, autoApprove: false });

        expect(askApproval).toHaveBeenCalled();
        expect(createCommandContext).not.toHaveBeenCalled();
    });

    it('should apply changes if autoApprove is true', async () => {
        const mockUpsertResource = vi.fn();
        const mockSave = vi.fn();

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([]),
                upsertResource: mockUpsertResource,
                save: mockSave
            };
        });

        await applyCmd({ dir: tmpDir, target: 'testcase', refresh: false, autoApprove: true });

        expect(createCommandContext).toHaveBeenCalled();
        expect(mockGithub.createIssue).toHaveBeenCalled();
        expect(mockUpsertResource).toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalled();
    });

    it('should exit if input is disabled and autoApprove is false', async () => {
        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        await expect(applyCmd({ dir: tmpDir, target: 'testcase', refresh: false, autoApprove: false, input: false })).rejects.toThrow(/No input allowed|This command requires manual approval/);
        
        expect(mockError).toHaveBeenCalled();
        const logs = mockError.mock.calls.join(' ');
        expect(logs).toContain('No input allowed');
    });

    it('should apply destroy changes if resource is orphaned', async () => {
        const mockRemoveResource = vi.fn();
        const mockSave = vi.fn();

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([]) // Local is empty
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([{ identity: 'file1::tc1', attributes: { issueNumber: 123 } }]),
                removeResource: mockRemoveResource,
                save: mockSave
            };
        });

        await applyCmd({ dir: tmpDir, target: 'testcase', refresh: false, autoApprove: true });

        expect(createCommandContext).toHaveBeenCalled();
        expect(mockGithub.closeIssue).toHaveBeenCalledWith(123);
        expect(mockRemoveResource).toHaveBeenCalledWith('file1::tc1');
        expect(mockSave).toHaveBeenCalled();
    });
});
