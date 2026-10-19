import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { forceUnlockCmd } from '../src/commands/force-unlock';
import { State } from '../src/core/state';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

const mockCreateInterface = vi.fn();

vi.mock('../src/core/state');
vi.mock('readline', () => ({
    createInterface: (...args: any[]) => mockCreateInterface(...args),
    default: {
        createInterface: (...args: any[]) => mockCreateInterface(...args)
    }
}));

describe('Command forceUnlockCmd', () => {
    beforeEach(() => {
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        mockCreateInterface.mockClear();
        (State as any).mockClear();
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        mockError.mockRestore();
        vi.restoreAllMocks();
    });

    it('should force unlock successfully when force=true', async () => {
        const mockForceUnlock = vi.fn<any>().mockResolvedValue({ success: true });
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                forceUnlock: mockForceUnlock
            };
        });

        await forceUnlockCmd({ lockId: 'my-lock-id', force: true });

        expect(mockForceUnlock).toHaveBeenCalledWith('my-lock-id');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('state has been successfully unlocked!');
    });

    it('should prompt if force=false and exit if we mock readline (implicitly fails or hangs if not mocked)', async () => {
        const mockForceUnlock = vi.fn<any>().mockResolvedValue({
            success: false,
            currentLockId: 'different-lock-id'
        });
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                forceUnlock: mockForceUnlock
            };
        });

        mockCreateInterface.mockReturnValue({
            question: (_q: string, cb: any) => cb('yes'),
            close: vi.fn()
        });

        await expect(forceUnlockCmd({ lockId: 'my-lock-id' })).rejects.toThrow('Process exited with code 1');

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('Error: Lock ID does not match.');
    });

    it('should exit with error if state forceUnlock fails with error message', async () => {
        const mockForceUnlock = vi.fn<any>().mockResolvedValue({
            success: false,
            error: 'Backend error'
        });
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                forceUnlock: mockForceUnlock
            };
        });

        await expect(forceUnlockCmd({ lockId: 'my-lock-id', force: true })).rejects.toThrow('Process exited with code 1');

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('Backend error');
    });
});
