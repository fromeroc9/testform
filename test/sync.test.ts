import { describe, it, expect, vi } from 'vitest';
import {
    executeInBatches,
    arraysEqual,
    compareCustomFields,
    detectAttributeDrift,
    syncTestrunComments,
} from '../src/core/sync';
import { resource } from '../src/core/resources';

describe('sync module', () => {
    describe('executeInBatches', () => {
        it('should execute items in batches and return aggregated results', async () => {
            const items = [1, 2, 3, 4, 5];
            const processed: number[] = [];

            const results = await executeInBatches(items, 2, async (item) => {
                processed.push(item);
                return item * 10;
            });

            expect(results).toEqual([10, 20, 30, 40, 50]);
            expect(processed).toEqual([1, 2, 3, 4, 5]);
        });

        it('should handle empty arrays', async () => {
            const results = await executeInBatches([], 3, async (x) => x);
            expect(results).toEqual([]);
        });

        it('should handle invalid or zero parallelism by defaulting to at least 1', async () => {
            const items = ['a', 'b'];
            const results = await executeInBatches(items, 0, async (x) => x.toUpperCase());
            expect(results).toEqual(['A', 'B']);
        });
    });

    describe('arraysEqual', () => {
        it('should return true for identical arrays', () => {
            expect(arraysEqual(['bug', 'p1'], ['bug', 'p1'])).toBe(true);
        });

        it('should return true regardless of order and case', () => {
            expect(arraysEqual(['BUG', 'P1'], ['p1', 'bug'])).toBe(true);
        });

        it('should return true when comparing comma-separated string with array', () => {
            expect(arraysEqual('bug, p1', ['p1', 'bug'])).toBe(true);
        });

        it('should return true for undefined / empty arrays', () => {
            expect(arraysEqual(undefined, [])).toBe(true);
            expect(arraysEqual([], undefined)).toBe(true);
            expect(arraysEqual(undefined, undefined)).toBe(true);
        });

        it('should return false for different items', () => {
            expect(arraysEqual(['bug'], ['feature'])).toBe(false);
            expect(arraysEqual(['bug', 'p1'], ['bug'])).toBe(false);
        });
    });

    describe('compareCustomFields', () => {
        it('should return hasDrift: false when local and remote match', () => {
            const local = { Priority: 'High', Team: 'Core' };
            const remote = { priority: 'high', team: 'core' };
            const result = compareCustomFields(local, remote);
            expect(result.hasDrift).toBe(false);
        });

        it('should ignore leading @ in local values during comparison', () => {
            const local = { Priority: '@High' };
            const remote = { Priority: 'High' };
            const result = compareCustomFields(local, remote);
            expect(result.hasDrift).toBe(false);
        });

        it('should detect drift when remote value differs', () => {
            const local = { Priority: 'Low' };
            const remote = { Priority: 'High' };
            const result = compareCustomFields(local, remote);
            expect(result.hasDrift).toBe(true);
            expect(result.reconciled.Priority).toBe('High');
        });

        it('should detect drift when remote field was cleared', () => {
            const local = { Priority: 'High' };
            const remote = {};
            const result = compareCustomFields(local, remote);
            expect(result.hasDrift).toBe(true);
            expect(result.reconciled.Priority).toBe('');
        });
    });

    describe('detectAttributeDrift', () => {
        it('should detect title drift', () => {
            const current = { title: 'Old Title' };
            const remoteIssue: any = { title: 'New Title' };
            const result = detectAttributeDrift(current, remoteIssue);
            expect(result.hasDrift).toBe(true);
            expect(result.newAttributes.title).toBe('New Title');
        });

        it('should detect labels drift', () => {
            const current = { title: 'T', labels: ['bug'] };
            const remoteIssue: any = { title: 'T', labels: ['bug', 'urgent'] };
            const result = detectAttributeDrift(current, remoteIssue);
            expect(result.hasDrift).toBe(true);
            expect(result.newAttributes.labels).toEqual(['bug', 'urgent']);
        });

        it('should detect milestone drift', () => {
            const current = { title: 'T', milestone: 'v1.0' };
            const remoteIssue: any = { title: 'T', milestone: 'v2.0' };
            const result = detectAttributeDrift(current, remoteIssue);
            expect(result.hasDrift).toBe(true);
            expect(result.newAttributes.milestone).toBe('v2.0');
        });

        it('should detect custom fields drift', () => {
            const current = { title: 'T', custom_fields: { Priority: 'Low' } };
            const remoteIssue: any = { title: 'T' };
            const remoteFields = { Priority: 'Critical' };
            const result = detectAttributeDrift(current, remoteIssue, remoteFields);
            expect(result.hasDrift).toBe(true);
            expect(result.newAttributes.custom_fields.Priority).toBe('Critical');
        });

        it('should return hasDrift: false when all attributes match', () => {
            const current = {
                title: 'Clean',
                labels: ['p1'],
                assignees: ['alice'],
                milestone: 'v1.0',
                custom_fields: { Priority: 'High' }
            };
            const remoteIssue: any = {
                title: 'Clean',
                labels: ['p1'],
                assignees: ['alice'],
                milestone: 'v1.0'
            };
            const remoteFields = { Priority: 'High' };
            const result = detectAttributeDrift(current, remoteIssue, remoteFields);
            expect(result.hasDrift).toBe(false);
        });
    });

    describe('syncTestrunComments', () => {
        it('should skip non-testrun resources', async () => {
            const change = { resourceType: 'github_testcase' };
            const result = await syncTestrunComments({
                change,
                issueNumber: 1,
                provider: {} as any,
                stateObj: {},
            });
            expect(result.expandedTestcases).toEqual([]);
        });

        it('should create new comments when not already tracked', async () => {
            vi.spyOn(resource, 'evaluateComments').mockReturnValueOnce([
                { identity: 'tc-1', title: 'Testcase 1', status: 'Passed', body: 'Comment body 1' }
            ]);

            const mockCreateComment = vi.fn().mockResolvedValue({ id: 101 });
            const mockUpdateComment = vi.fn();
            const onCommentCreate = vi.fn();

            const change = {
                resourceType: 'github_testrun',
                scenario: { custom: { testcases: ['tc-1'] } }
            };

            const result = await syncTestrunComments({
                change,
                issueNumber: 12,
                provider: {
                    createIssueComment: mockCreateComment,
                    updateIssueComment: mockUpdateComment,
                } as any,
                stateObj: {},
                onCommentCreate,
            });

            expect(mockCreateComment).toHaveBeenCalledWith(12, 'Comment body 1');
            expect(mockUpdateComment).not.toHaveBeenCalled();
            expect(onCommentCreate).toHaveBeenCalledWith('tc-1', 'Passed');
            expect(result.testcaseCommentIds['tc-1']).toBe(101);
            expect(result.testcaseStatuses['tc-1']).toBe('Passed');
        });

        it('should update comments when status has changed', async () => {
            vi.spyOn(resource, 'evaluateComments').mockReturnValueOnce([
                { identity: 'tc-1', title: 'Testcase 1', status: 'Failed', body: 'Comment body updated' }
            ]);

            const mockCreateComment = vi.fn();
            const mockUpdateComment = vi.fn().mockResolvedValue({});
            const onCommentUpdate = vi.fn();

            const change = {
                resourceType: 'github_testrun',
                scenario: { custom: { testcases: ['tc-1'] } }
            };

            const existingAttributes = {
                testcaseCommentIds: { 'tc-1': 101 },
                testcaseStatuses: { 'tc-1': 'Passed' }
            };

            const result = await syncTestrunComments({
                change,
                issueNumber: 12,
                provider: {
                    createIssueComment: mockCreateComment,
                    updateIssueComment: mockUpdateComment,
                } as any,
                stateObj: {},
                existingAttributes,
                onCommentUpdate,
            });

            expect(mockCreateComment).not.toHaveBeenCalled();
            expect(mockUpdateComment).toHaveBeenCalledWith(101, 'Comment body updated');
            expect(onCommentUpdate).toHaveBeenCalledWith('tc-1', 'Failed');
            expect(result.testcaseStatuses['tc-1']).toBe('Failed');
        });

        it('should do nothing if status is unchanged', async () => {
            vi.spyOn(resource, 'evaluateComments').mockReturnValueOnce([
                { identity: 'tc-1', title: 'Testcase 1', status: 'Passed', body: 'Same body' }
            ]);

            const mockCreateComment = vi.fn();
            const mockUpdateComment = vi.fn();

            const change = {
                resourceType: 'github_testrun',
                scenario: { custom: { testcases: ['tc-1'] } }
            };

            const existingAttributes = {
                testcaseCommentIds: { 'tc-1': 101 },
                testcaseStatuses: { 'tc-1': 'Passed' }
            };

            const result = await syncTestrunComments({
                change,
                issueNumber: 12,
                provider: {
                    createIssueComment: mockCreateComment,
                    updateIssueComment: mockUpdateComment,
                } as any,
                stateObj: {},
                existingAttributes,
            });

            expect(mockCreateComment).not.toHaveBeenCalled();
            expect(mockUpdateComment).not.toHaveBeenCalled();
            expect(result.testcaseStatuses['tc-1']).toBe('Passed');
        });
    });
});
