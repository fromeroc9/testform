import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { refreshCmd } from '../src/commands/refresh';
import { State } from '../src/core/state';
import { GitHubAdapter } from '../src/adapters/github';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

jest.mock('../src/core/state');
jest.mock('../src/adapters/github');

describe('Command refreshCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-refresh-test-'));
        mockLog.mockClear();
        (State as jest.Mock).mockClear();
        (GitHubAdapter as jest.Mock).mockClear();
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockLog.mockRestore();
        jest.restoreAllMocks();
    });

    it('should report no resources if state is empty', async () => {
        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([]),
            save: mockSave
        }));

        await refreshCmd({ dir: tmpDir, scope: 'testcase' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No resources in state to refresh');
        expect(mockSave).toHaveBeenCalled();
    });

    it('should refresh a resource and sync title', async () => {
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0', github: {} }));

        const mockResource = {
            type: 'github_testcase',
            identity: 'tc1',
            attributes: {
                title: 'Old Title',
                issueNumber: 123
            }
        };

        const mockUpsertResource = jest.fn();
        const mockSave = jest.fn();

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([mockResource]),
            upsertResource: mockUpsertResource,
            save: mockSave
        }));

        (GitHubAdapter as jest.Mock).mockImplementation(() => ({
            getIssue: jest.fn<any>().mockResolvedValue({
                title: 'New Title',
                state: 'open'
            })
        }));

        await refreshCmd({ dir: tmpDir, scope: 'testcase' });

        expect(mockUpsertResource).toHaveBeenCalledWith(expect.objectContaining({
            attributes: expect.objectContaining({ title: 'New Title' })
        }));
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Refresh complete!');
        expect(logs).toContain('1 resource(s) refreshed');
    });

    it('should remove a resource if issue is closed', async () => {
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0', github: {} }));

        const mockResource = {
            type: 'github_testcase',
            identity: 'tc2',
            attributes: {
                title: 'Some Title',
                issueNumber: 124
            }
        };

        const mockRemoveResource = jest.fn();
        const mockSave = jest.fn();

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([mockResource]),
            removeResource: mockRemoveResource,
            save: mockSave
        }));

        (GitHubAdapter as jest.Mock).mockImplementation(() => ({
            getIssue: jest.fn<any>().mockResolvedValue({
                title: 'Some Title',
                state: 'closed'
            })
        }));

        await refreshCmd({ dir: tmpDir, scope: 'testcase' });

        expect(mockRemoveResource).toHaveBeenCalledWith('tc2');
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Issue #124 is closed');
        expect(logs).toContain('1 removed');
    });

    it('should remove a resource if it lacks an issue number', async () => {
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0', github: {} }));

        const mockResource = {
            type: 'github_testcase',
            identity: 'tc3',
            attributes: {
                title: 'Unsynced Title'
            }
        };

        const mockRemoveResource = jest.fn();
        const mockSave = jest.fn();

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([mockResource]),
            removeResource: mockRemoveResource,
            save: mockSave
        }));

        await refreshCmd({ dir: tmpDir, scope: 'testcase' });

        expect(mockRemoveResource).toHaveBeenCalledWith('tc3');
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No issue number');
        expect(logs).toContain('1 removed');
    });
});
