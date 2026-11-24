import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitHubProvider } from '../../src/providers/github';
import { githubTestrunTemplate, githubTestplanTemplate, githubBugTemplate, githubTestcaseTemplate } from '../../src/providers/github/resources';

describe('GitHubProvider and GitHub Resources', () => {
    describe('GitHub Resource Templates Status injection', () => {
        it('does NOT inject Status into metadata when not declared in fields', () => {
            const mockScenario: any = {
                feature: { name: 'Magento-20260612_120000_6be4l9' },
                custom: {
                    groupScenarios: [
                        { rule: { name: 'catalog.case.feature' }, custom: { fields: { status: 'pending' } } },
                        { rule: { name: 'checkout.case.feature' }, custom: { fields: { status: 'pending' } } }
                    ],
                    fields: {
                        component: 'microservicio-1',
                        sprint: 'Sprint 3'
                    }
                }
            };

            const attrs = (githubTestrunTemplate.attributes as Function)(mockScenario);
            expect(attrs.metadata.Status).toBeUndefined();
            expect(attrs.metadata.component).toBe('microservicio-1');
        });

        it('autocalculates Status when declared in fields without manual override', () => {
            const mockScenario: any = {
                feature: { name: 'Magento-20260612_120000_6be4l9' },
                custom: {
                    groupScenarios: [
                        { rule: { name: 'catalog.case.feature' }, custom: { fields: { status: 'pending' } } }
                    ],
                    fields: {
                        component: 'microservicio-1',
                        Status: 'Done' // default from main.yml
                    }
                }
            };

            const attrs = (githubTestrunTemplate.attributes as Function)(mockScenario);
            expect(attrs.metadata.Status).toBe('pending');
        });

        it('strictly respects explicit user override in feature (e.g. * field Status = skipped)', () => {
            const mockScenario: any = {
                feature: { name: 'Magento-20260611_155546_5f736a' },
                custom: {
                    groupScenarios: [
                        { rule: { name: 'cart.case.feature' }, custom: { fields: { status: 'passed' } } },
                        { rule: { name: 'catalog.case.feature' }, custom: { fields: { status: 'passed' } } }
                    ],
                    fields: {
                        Status: 'skipped'
                    },
                    explicitFields: {
                        Status: 'skipped'
                    }
                }
            };

            const attrs = (githubTestrunTemplate.attributes as Function)(mockScenario);
            // All scenarios passed, but user explicitly declared Status = skipped!
            expect(attrs.metadata.Status).toBe('skipped');
        });
    });

    describe('GitHubProvider updateProjectItemFields semantic matching', () => {
        let provider: GitHubProvider;
        let requestGraphQLMock: any;

        beforeEach(() => {
            provider = new GitHubProvider({
                owner: 'test-owner',
                repository: 'test-repo',
                projectId: '1',
                tokenEnv: 'ghp_test'
            });

            // Mock resolveProjectMetadata
            vi.spyOn(provider as any, 'resolveProjectMetadata').mockResolvedValue({
                id: 'PVT_project123',
                fields: [
                    {
                        id: 'FIELD_status',
                        name: 'Status',
                        dataType: 'SINGLE_SELECT',
                        options: [
                            { id: 'OPT_todo', name: 'Todo' },
                            { id: 'OPT_inprogress', name: 'In Progress' },
                            { id: 'OPT_done', name: 'Done' }
                        ]
                    },
                    {
                        id: 'FIELD_text',
                        name: 'component',
                        dataType: 'TEXT'
                    }
                ]
            });

            requestGraphQLMock = vi.spyOn(provider as any, 'graphql').mockResolvedValue({});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('maps "passed" to "Done" in GitHub Projects single-select', async () => {
            await provider.updateProjectItemFields('ITEM_1', { Status: 'passed' });
            expect(requestGraphQLMock).toHaveBeenCalledTimes(1);
            const call = requestGraphQLMock.mock.calls[0];
            expect(call[1].fieldId0).toBe('FIELD_status');
            expect(call[1].value0).toEqual({ singleSelectOptionId: 'OPT_done' });
        });

        it('maps "pending" to "Todo" in GitHub Projects single-select', async () => {
            await provider.updateProjectItemFields('ITEM_2', { Status: 'pending' });
            expect(requestGraphQLMock).toHaveBeenCalledTimes(1);
            const call = requestGraphQLMock.mock.calls[0];
            expect(call[1].fieldId0).toBe('FIELD_status');
            expect(call[1].value0).toEqual({ singleSelectOptionId: 'OPT_todo' });
        });

        it('maps "failed" to "In Progress" or "Todo" fallback when Failed option is not present', async () => {
            await provider.updateProjectItemFields('ITEM_3', { Status: 'failed' });
            expect(requestGraphQLMock).toHaveBeenCalledTimes(1);
            const call = requestGraphQLMock.mock.calls[0];
            expect(call[1].fieldId0).toBe('FIELD_status');
            // Options are [Todo, In Progress, Done], fallback list is ['failed', 'error', 'bug', 'in progress', 'todo']
            expect(call[1].value0).toEqual({ singleSelectOptionId: 'OPT_inprogress' });
        });

        it('matches directly if exact option exists (case-insensitive)', async () => {
            // Add custom option to metadata
            vi.spyOn(provider as any, 'resolveProjectMetadata').mockResolvedValue({
                id: 'PVT_project123',
                fields: [
                    {
                        id: 'FIELD_status',
                        name: 'Status',
                        dataType: 'SINGLE_SELECT',
                        options: [
                            { id: 'OPT_pending', name: 'Pending' },
                            { id: 'OPT_failed', name: 'Failed' },
                            { id: 'OPT_passed', name: 'Passed' }
                        ]
                    }
                ]
            });

            await provider.updateProjectItemFields('ITEM_4', { Status: 'pending' });
            expect(requestGraphQLMock).toHaveBeenCalledTimes(1);
            const call = requestGraphQLMock.mock.calls[0];
            expect(call[1].value0).toEqual({ singleSelectOptionId: 'OPT_pending' });
        });
    });
});
