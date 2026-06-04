import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { taintCmd } from '../src/commands/taint';
import { State } from '../src/core/state';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/core/state');

describe('Command taintCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-taint-test-'));
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
        { type: 'github_testcase', identity: 'tc1', attributes: {}, tainted: false },
        { type: 'github_testcase', identity: 'tc2', attributes: {}, tainted: true }
    ];

    it('should taint a resource successfully', async () => {
        const mockUpsertResource = jest.fn();
        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([{ ...mockResources[0] }]),
            upsertResource: mockUpsertResource,
            save: mockSave
        }));

        await taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc1' });

        expect(mockUpsertResource).toHaveBeenCalledWith(expect.objectContaining({ tainted: true }));
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('marked as tainted');
    });

    it('should do nothing if resource is already tainted', async () => {
        const mockUpsertResource = jest.fn();
        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([{ ...mockResources[1] }]),
            upsertResource: mockUpsertResource,
            save: mockSave
        }));

        await taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc2' });

        expect(mockUpsertResource).not.toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('already tainted');
    });

    it('should untaint a resource successfully', async () => {
        const mockUpsertResource = jest.fn();
        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([{ ...mockResources[1] }]),
            upsertResource: mockUpsertResource,
            save: mockSave
        }));

        await taintCmd({ action: 'untaint', identityRaw: 'github_testcase.tc2' });

        expect(mockUpsertResource.mock.calls[0][0]).not.toHaveProperty('tainted');
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('successfully untainted');
    });

    it('should do nothing if resource is not tainted', async () => {
        const mockUpsertResource = jest.fn();
        const mockSave = jest.fn();
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([{ ...mockResources[0] }]),
            upsertResource: mockUpsertResource,
            save: mockSave
        }));

        await taintCmd({ action: 'untaint', identityRaw: 'github_testcase.tc1' });

        expect(mockUpsertResource).not.toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('is not tainted');
    });

    it('should exit with error if resource not found', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        await expect(taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc1' })).rejects.toThrow('Process exited with code 1');
        
        expect(mockError).toHaveBeenCalled();
        const logs = mockError.mock.calls.join(' ');
        expect(logs).toContain('Resource not found in state');
    });

    it('should exit successfully if resource not found but allowMissing is true', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        await expect(taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc1', allowMissing: true })).rejects.toThrow('Process exited with code 0');
        
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('allow-missing is set');
    });
});
