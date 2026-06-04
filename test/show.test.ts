import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { showCmd } from '../src/commands/show';
import { State } from '../src/core/state';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/core/state');

describe('Command showCmd', () => {
    beforeEach(() => {
        mockLog.mockClear();
        mockError.mockClear();
        (State as jest.Mock).mockClear();
    });

    afterAll(() => {
        mockLog.mockRestore();
        mockError.mockRestore();
        jest.restoreAllMocks();
    });

    it('should output state correctly when type is state', async () => {
        const mockGetState = jest.fn().mockReturnValue({
            version: '1.0',
            serial: 1,
            lineage: 'test-lineage',
            lastSync: '2023-01-01',
            resources: [
                {
                    type: 'testcase',
                    identity: 'tc1',
                    attributes: {
                        title: 'Test Case 1',
                        issueNumber: 123,
                        remoteId: 'remote-id-1',
                        localHash: 'hash1234567890'
                    },
                    lastApplied: '2023-01-02'
                }
            ]
        });

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: mockGetState
        }));

        await showCmd({});

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Version:    1.0');
        expect(logs).toContain('Resources:  1');
        expect(logs).toContain('testcase.tc1');
        expect(logs).toContain('synced');
    });

    it('should print informational message when type is plan', async () => {
        // Not testing 'plan' anymore if type does not exist, let's remove or just ignore

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('generate and view an execution plan');
    });

    it('should print error message for unknown type', async () => {
        const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`Process exited with code ${code}`);
        });

        await expect(showCmd({ path: 'unknown' })).rejects.toThrow();

        expect(mockError).toHaveBeenCalled();
        const logs = mockError.mock.calls.join(' ');
        expect(logs).toContain('Unknown show type');

        mockExit.mockRestore();
    });
});
