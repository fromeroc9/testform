import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { destroyCmd } from '../src/commands/destroy';
import { State } from '../src/core/state';
import { createCommandContext } from '../src/core/command-context';
import { askDestroyApproval } from '../src/core/prompt';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

jest.mock('../src/core/state');
jest.mock('../src/core/command-context');
jest.mock('../src/core/prompt');

describe('Command destroyCmd', () => {
    let tmpDir: string;
    let mockGithub: any;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-destroy-test-'));
        mockLog.mockClear();
        mockError.mockClear();
        mockExit.mockClear();
        (State as jest.Mock).mockClear();
        (createCommandContext as jest.Mock).mockClear();
        (askDestroyApproval as jest.Mock).mockClear();

        mockGithub = {
            closeIssue: jest.fn<any>().mockResolvedValue(true)
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

    it('should exit if state is empty', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        await destroyCmd({ dir: tmpDir, scope: 'testcase' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No resources to destroy');
    });

    it('should exit if input is disabled and no auto-approve is provided', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([{ identity: 'tc1', attributes: { issueNumber: 123 } }])
        }));

        await expect(destroyCmd({ dir: tmpDir, scope: 'testcase', input: false })).rejects.toThrow('Process exited with code 1');
        
        expect(mockError).toHaveBeenCalled();
        const logs = mockError.mock.calls.join(' ');
        expect(logs).toContain('No input allowed');
    });

    it('should ask for approval and exit if denied', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([{ identity: 'tc1', attributes: { issueNumber: 123 } }])
        }));

        jest.mocked(askDestroyApproval).mockResolvedValue(false as any);

        await destroyCmd({ dir: tmpDir, scope: 'testcase' });

        expect(askDestroyApproval).toHaveBeenCalledWith(1);
        expect(createCommandContext).not.toHaveBeenCalled();
    });

    it('should destroy resources after approval', async () => {
        const mockRemoveResource = jest.fn();
        const mockSave = jest.fn();

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([
                { identity: 'tc1', type: 'github_testcase', attributes: { issueNumber: 123 } },
                { identity: 'tc2', type: 'github_testcase', attributes: { issueNumber: 124 } }
            ]),
            removeResource: mockRemoveResource,
            save: mockSave
        }));

        jest.mocked(askDestroyApproval).mockResolvedValue(true as any);

        await destroyCmd({ dir: tmpDir, scope: 'testcase' });

        expect(askDestroyApproval).toHaveBeenCalledWith(2);
        expect(createCommandContext).toHaveBeenCalled();
        expect(mockGithub.closeIssue).toHaveBeenCalledTimes(2);
        expect(mockGithub.closeIssue).toHaveBeenCalledWith(123);
        expect(mockGithub.closeIssue).toHaveBeenCalledWith(124);
        expect(mockRemoveResource).toHaveBeenCalledTimes(2);
        expect(mockSave).toHaveBeenCalled();
        
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Destroy complete!');
    });
});
