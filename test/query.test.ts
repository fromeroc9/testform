import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { queryCmd } from '../src/commands/query';
import { State } from '../src/core/state';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

jest.mock('../src/core/state');

describe('Command queryCmd', () => {
    beforeEach(() => {
        mockLog.mockClear();
        (State as jest.Mock).mockClear();
    });

    afterAll(() => {
        mockLog.mockRestore();
        jest.restoreAllMocks();
    });

    const mockResources = [
        {
            type: 'github_testcase',
            identity: 'auth.feature::login_test',
            attributes: {
                title: 'Login with valid credentials',
                issueNumber: 101,
                remoteId: 'remote-1',
                labels: ['@smoke', 'auth'],
                assignees: ['flavio'],
                milestone: 'v1.0',
                custom_fields: { priority: 'high', sprint: '1' }
            }
        },
        {
            type: 'github_testcase',
            identity: 'checkout.feature::pay_test',
            attributes: {
                title: 'Checkout payment processing',
                issueNumber: 102,
                remoteId: 'remote-2',
                labels: ['@regression', 'billing'],
                assignees: ['john'],
                milestone: 'v2.0',
                custom_fields: { priority: 'medium', sprint: '2' }
            }
        },
        {
            type: 'github_testrun',
            identity: 'sprint1.run.feature',
            attributes: {
                title: 'Sprint 1 Test Run',
                issueNumber: 201,
                labels: ['@testrun'],
                assignees: ['flavio'],
                testcaseStatuses: {
                    'auth.feature::login_test': 'passed',
                    'checkout.feature::pay_test': 'failed'
                }
            }
        }
    ];

    it('should query all resources and output table summary', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ dir: '.' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Query Results');
        expect(logs).toContain('login_test');
        expect(logs).toContain('pay_test');
        expect(logs).toContain('Sprint 1 Test Run');
        expect(logs).toContain('Total: 3 resource(s) found.');
    });

    it('should filter by scope', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ scope: 'testrun' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Sprint 1 Test Run');
        expect(logs).not.toContain('login_test');
        expect(logs).toContain('Total: 1 resource(s) found.');
    });

    it('should filter by status (passed)', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ status: 'passed' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('login_test');
        expect(logs).not.toContain('pay_test');
        expect(logs).toContain('Total: 1 resource(s) found.');
    });

    it('should filter by status (failed)', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ status: 'failed' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('pay_test');
        expect(logs).not.toContain('login_test');
        expect(logs).toContain('Total: 1 resource(s) found.');
    });

    it('should filter by label with leading @', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ label: '@smoke' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('login_test');
        expect(logs).not.toContain('pay_test');
    });

    it('should filter by assignee', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ assignee: 'john' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('pay_test');
        expect(logs).not.toContain('login_test');
    });

    it('should filter by milestone', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ milestone: 'v1.0' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('login_test');
        expect(logs).not.toContain('pay_test');
    });

    it('should filter by custom field (priority=high)', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ custom: 'priority=high' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('login_test');
        expect(logs).not.toContain('pay_test');
    });

    it('should filter by free search text', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ search: 'payment' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('pay_test');
        expect(logs).not.toContain('login_test');
    });

    it('should output raw count when count=true', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ count: true });

        expect(mockLog).toHaveBeenCalledWith(3);
    });

    it('should output JSON when json=true', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ json: true, status: 'passed' });

        expect(mockLog).toHaveBeenCalled();
        const jsonStr = mockLog.mock.calls[0][0];
        const parsed = JSON.parse(jsonStr);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].id).toBe('auth.feature::login_test');
        expect(parsed[0].status).toBe('passed');
    });

    it('should handle zero matches cleanly', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getState: jest.fn().mockReturnValue({ resources: mockResources })
        }));

        await queryCmd({ search: 'nonexistent-query-string' });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No resources matched the given query criteria.');
    });
});
