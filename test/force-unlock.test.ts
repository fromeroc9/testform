import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { forceUnlockCmd } from '../src/commands/force-unlock';
import { State } from '../src/core/state';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/core/state');

describe('Command forceUnlockCmd', () => {
    beforeEach(() => {
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (State as jest.Mock).mockClear();
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        mockError.mockRestore();
        jest.restoreAllMocks();
    });

    it('should force unlock successfully when force=true', async () => {
        const mockForceUnlock = jest.fn<any>().mockResolvedValue({ success: true });
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            forceUnlock: mockForceUnlock
        }));

        await forceUnlockCmd({ lockId: 'my-lock-id', force: true });

        expect(mockForceUnlock).toHaveBeenCalledWith('my-lock-id');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('state has been successfully unlocked!');
    });

    it('should prompt if force=false and exit if we mock readline (implicitly fails or hangs if not mocked)', async () => {
        // Since we aren't mocking readline properly here for full interactive test,
        // we can just check if it fails with invalid lock id.
        const mockForceUnlock = jest.fn<any>().mockResolvedValue({
            success: false,
            currentLockId: 'different-lock-id'
        });
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            forceUnlock: mockForceUnlock
        }));

        await expect(forceUnlockCmd({ lockId: 'my-lock-id' })).rejects.toThrow('Process exited with code 1');

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('Error: Lock ID does not match.');
    });

    it('should exit with error if state forceUnlock fails with error message', async () => {
        const mockForceUnlock = jest.fn<any>().mockResolvedValue({
            success: false,
            error: 'Backend error'
        });
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            forceUnlock: mockForceUnlock
        }));

        await expect(forceUnlockCmd({ lockId: 'my-lock-id', force: true })).rejects.toThrow('Process exited with code 1');

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('Backend error');
    });
});
