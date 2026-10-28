import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { showCmd } from '../src/commands/show';
import { State } from '../src/core/state';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../src/core/state');

describe('Command showCmd', () => {
    beforeEach(() => {
        mockLog.mockClear();
        mockError.mockClear();
        (State as any).mockClear();
    });

    afterAll(() => {
        mockLog.mockRestore();
        mockError.mockRestore();
        vi.restoreAllMocks();
    });

    it('should output state correctly when type is state', async () => {
        const mockGetState = vi.fn().mockReturnValue({
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

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getState: mockGetState
            };
        });

        await showCmd({});

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Version:    1.0');
        expect(logs).toContain('Resources:  1');
        expect(logs).toContain('testcase.tc1');
        expect(logs).toContain('synced');
    });

    it('should report an error when specified file path does not exist', async () => {
        await expect(showCmd({ path: 'non-existent-plan.tfplan' })).rejects.toThrow('The specified file does not exist');
    });
});
