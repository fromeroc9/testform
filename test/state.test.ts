import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { stateCmd } from '../src/commands/state';
import { State } from '../src/core/state';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/core/state');

describe('Command stateCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-state-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (State as jest.Mock).mockClear();
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
        jest.restoreAllMocks();
    });

    const mockResources = [
        { type: 'testcase', identity: 'tc1', attributes: { title: 'Test 1' }, tainted: false },
        { type: 'testrun', identity: 'tr1', attributes: { title: 'Run 1' }, tainted: true }
    ];

    it('should pull state', async () => {
        const mockGetState = jest.fn().mockReturnValue({ resources: mockResources });
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: mockGetState
        }));

        await stateCmd({ action: 'pull', args: [] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('tc1');
    });

    it('should push state successfully', async () => {
        const mockStateFile = join(tmpDir, 'mock-state.json');
        writeFileSync(mockStateFile, JSON.stringify({ resources: mockResources }));

        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: [], serial: 0 }),
            save: mockSave
        }));

        await stateCmd({ action: 'push', args: [mockStateFile] });

        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Successfully pushed state');
    });

    it('should list resources', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockResources)
        }));

        await stateCmd({ action: 'list', args: [] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('testcase.tc1');
        expect(logs).toContain('[tainted] testrun.tr1');
    });

    it('should show identities', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockResources)
        }));

        await stateCmd({ action: 'identities', args: [] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('tc1');
        expect(logs).toContain('tr1');
    });

    it('should show a specific resource', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockResources)
        }));

        await stateCmd({ action: 'show', args: ['testcase.tc1'] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('resource "testcase" "tc1"');
        expect(logs).toContain('Test 1');
    });

    it('should remove a resource', async () => {
        const mockRemoveResource = jest.fn();
        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockResources),
            removeResource: mockRemoveResource,
            save: mockSave
        }));

        await stateCmd({ action: 'rm', args: ['testcase.tc1'] });

        expect(mockRemoveResource).toHaveBeenCalledWith('tc1');
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('Removed testcase.tc1');
    });

    it('should move a resource', async () => {
        const mockRemoveResource = jest.fn();
        const mockUpsertResource = jest.fn();
        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([ ...mockResources ]), // Shallow copy
            removeResource: mockRemoveResource,
            upsertResource: mockUpsertResource,
            save: mockSave
        }));

        await stateCmd({ action: 'mv', args: ['testcase.tc1', 'testcase.tc2'] });

        expect(mockRemoveResource).toHaveBeenCalledWith('tc1');
        expect(mockUpsertResource).toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Move testcase.tc1 to testcase.tc2 successfully executed!');
    });

    it('should exit with error on unknown subcommand', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        await expect(stateCmd({ action: 'unknown', args: [] })).rejects.toThrow('Process exited with code 1');
        expect(mockError).toHaveBeenCalled();
    });
});
