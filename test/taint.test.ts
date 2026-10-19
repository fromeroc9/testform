import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { taintCmd } from '../src/commands/taint';
import { State } from '../src/core/state';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../src/core/state');

describe('Command taintCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-taint-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (State as any).mockClear();
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

    const mockResources = [
        { type: 'github_testcase', identity: 'tc1', attributes: {}, tainted: false },
        { type: 'github_testcase', identity: 'tc2', attributes: {}, tainted: true }
    ];

    it('should taint a resource successfully', async () => {
        const mockUpsertResource = vi.fn();
        const mockSave = vi.fn();
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([{ ...mockResources[0] }]),
                upsertResource: mockUpsertResource,
                save: mockSave
            };
        });

        await taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc1' });

        expect(mockUpsertResource).toHaveBeenCalledWith(expect.objectContaining({ tainted: true }));
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('marked as tainted');
    });

    it('should do nothing if resource is already tainted', async () => {
        const mockUpsertResource = vi.fn();
        const mockSave = vi.fn();
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([{ ...mockResources[1] }]),
                upsertResource: mockUpsertResource,
                save: mockSave
            };
        });

        await taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc2' });

        expect(mockUpsertResource).not.toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('already tainted');
    });

    it('should untaint a resource successfully', async () => {
        const mockUpsertResource = vi.fn();
        const mockSave = vi.fn();
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([{ ...mockResources[1] }]),
                upsertResource: mockUpsertResource,
                save: mockSave
            };
        });

        await taintCmd({ action: 'untaint', identityRaw: 'github_testcase.tc2' });

        expect(mockUpsertResource.mock.calls[0][0]).not.toHaveProperty('tainted');
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('successfully untainted');
    });

    it('should do nothing if resource is not tainted', async () => {
        const mockUpsertResource = vi.fn();
        const mockSave = vi.fn();
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([{ ...mockResources[0] }]),
                upsertResource: mockUpsertResource,
                save: mockSave
            };
        });

        await taintCmd({ action: 'untaint', identityRaw: 'github_testcase.tc1' });

        expect(mockUpsertResource).not.toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('is not tainted');
    });

    it('should exit with error if resource not found', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        await expect(taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc1' })).rejects.toThrow();
        
        expect(mockError).toHaveBeenCalled();
        const logs = mockError.mock.calls.join(' ');
        expect(logs).toContain('Resource not found in state');
    });

    it('should exit successfully if resource not found but allowMissing is true', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        await taintCmd({ action: 'taint', identityRaw: 'github_testcase.tc1', allowMissing: true });
        
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('allow-missing is set');
    });
});
