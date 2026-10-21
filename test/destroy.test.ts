import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { destroyCmd } from '../src/commands/destroy';
import { State } from '../src/core/state';
import { createCommandContext } from '../src/core/context';
import { askDestroyApproval } from '../src/core/prompt';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

vi.mock('../src/core/state');
vi.mock('../src/core/context');
vi.mock('../src/core/prompt');

describe('Command destroyCmd', () => {
    let tmpDir: string;
    let mockGithub: any;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-destroy-test-'));
        mockLog.mockClear();
        mockError.mockClear();
        mockExit.mockClear();
        (State as any).mockClear();
        vi.mocked(createCommandContext).mockClear();
        vi.mocked(askDestroyApproval).mockClear();

        mockGithub = {
            closeIssue: vi.fn<any>().mockResolvedValue(true)
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

    it('should exit if state is empty', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        await destroyCmd({ dir: tmpDir, scope: 'testcase' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No resources to destroy');
    });

    it('should exit if input is disabled and no auto-approve is provided', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([{ identity: 'tc1', attributes: { issueNumber: 123 } }])
            };
        });

        await expect(destroyCmd({ dir: tmpDir, scope: 'testcase', input: false })).rejects.toThrow(/No input allowed|This command requires manual approval|Process exited with code 1/);
        
        expect(mockError).toHaveBeenCalled();
        const logs = mockError.mock.calls.join(' ');
        expect(logs).toContain('No input allowed');
    });

    it('should ask for approval and exit if denied', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([{ identity: 'tc1', attributes: { issueNumber: 123 } }])
            };
        });

        vi.mocked(askDestroyApproval).mockResolvedValue(false as any);

        await destroyCmd({ dir: tmpDir, scope: 'testcase' });

        expect(askDestroyApproval).toHaveBeenCalledWith(1);
        expect(createCommandContext).not.toHaveBeenCalled();
    });

    it('should destroy resources after approval', async () => {
        const mockRemoveResource = vi.fn();
        const mockSave = vi.fn();

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([
                    { identity: 'tc1', type: 'github_testcase', attributes: { issueNumber: 123 } },
                    { identity: 'tc2', type: 'github_testcase', attributes: { issueNumber: 124 } }
                ]),
                removeResource: mockRemoveResource,
                save: mockSave
            };
        });

        vi.mocked(askDestroyApproval).mockResolvedValue(true as any);

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
