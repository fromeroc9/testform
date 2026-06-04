import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { applyCmd } from '../src/commands/apply';
import { State } from '../src/core/state';
import { Parser } from '../src/core/parser';
import { Config } from '../src/core/config';
import { createCommandContext } from '../src/core/command-context';
import { askApproval } from '../src/core/prompt';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

jest.mock('../src/core/state');
jest.mock('../src/core/parser');
jest.mock('../src/core/config');
jest.mock('../src/core/command-context');
jest.mock('../src/core/prompt');
jest.mock('../src/core/policy');

describe('Command applyCmd', () => {
    let tmpDir: string;
    let mockGithub: any;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-apply-test-'));
        mockLog.mockClear();
        mockError.mockClear();
        mockExit.mockClear();
        (State as jest.Mock).mockClear();
        (Parser as jest.Mock).mockClear();
        (Config as jest.Mock).mockClear();
        (createCommandContext as jest.Mock).mockClear();
        (askApproval as jest.Mock).mockClear();

        (Config as jest.Mock).mockImplementation(() => ({
            getIdentity: jest.fn().mockReturnValue('testcase.*'),
            getFields: jest.fn().mockReturnValue([])
        }));

        mockGithub = {
            createIssue: jest.fn<any>().mockResolvedValue({ number: 123, node_id: 'node-1' }),
            addToProject: jest.fn<any>().mockResolvedValue('item-1'),
            updateProjectItemFields: jest.fn<any>().mockResolvedValue(true),
            updateIssue: jest.fn<any>().mockResolvedValue({ number: 123, node_id: 'node-1' }),
            closeIssue: jest.fn<any>().mockResolvedValue(true),
            formatRemoteId: jest.fn().mockReturnValue('remote-id-1')
        };

        jest.mocked(createCommandContext).mockResolvedValue({ github: mockGithub } as any);
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
        jest.restoreAllMocks();
    });

    it('should ask for approval and exit if denied', async () => {
        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        jest.mocked(askApproval).mockResolvedValue(false as any);

        await applyCmd({ dir: tmpDir, scope: 'testcase', refresh: false, autoApprove: false });

        expect(askApproval).toHaveBeenCalled();
        expect(createCommandContext).not.toHaveBeenCalled();
    });

    it('should apply changes if autoApprove is true', async () => {
        const mockUpsertResource = jest.fn();
        const mockSave = jest.fn();

        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([]),
            upsertResource: mockUpsertResource,
            save: mockSave
        }));

        await applyCmd({ dir: tmpDir, scope: 'testcase', refresh: false, autoApprove: true });

        expect(createCommandContext).toHaveBeenCalled();
        expect(mockGithub.createIssue).toHaveBeenCalled();
        expect(mockUpsertResource).toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalled();
    });

    it('should exit if input is disabled and autoApprove is false', async () => {
        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        await expect(applyCmd({ dir: tmpDir, scope: 'testcase', refresh: false, autoApprove: false, input: false })).rejects.toThrow('Process exited with code 1');
        
        expect(mockError).toHaveBeenCalled();
        const logs = mockError.mock.calls.join(' ');
        expect(logs).toContain('No input allowed');
    });

    it('should apply destroy changes if resource is orphaned', async () => {
        const mockRemoveResource = jest.fn();
        const mockSave = jest.fn();

        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([]) // Local is empty
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([{ identity: 'file1::tc1', attributes: { issueNumber: 123 } }]),
            removeResource: mockRemoveResource,
            save: mockSave
        }));

        await applyCmd({ dir: tmpDir, scope: 'testcase', refresh: false, autoApprove: true });

        expect(createCommandContext).toHaveBeenCalled();
        expect(mockGithub.closeIssue).toHaveBeenCalledWith(123);
        expect(mockRemoveResource).toHaveBeenCalledWith('file1::tc1');
        expect(mockSave).toHaveBeenCalled();
    });
});
