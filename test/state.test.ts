import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { stateCmd } from '../src/commands/state';
import { State, cleanAttributes } from '../src/core/state';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../src/core/state', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/state')>();
    return {
        ...actual,
        State: vi.fn()
    };
});

describe('Command stateCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-state-test-'));
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
        { type: 'testcase', identity: 'tc1', attributes: { title: 'Test 1' }, tainted: false },
        { type: 'testrun', identity: 'tr1', attributes: { title: 'Run 1' }, tainted: true }
    ];

    it('should pull state', async () => {
        const mockGetState = vi.fn().mockReturnValue({ resources: mockResources });
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getState: mockGetState
            };
        });

        await stateCmd({ action: 'pull', args: [] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('tc1');
    });

    it('should push state successfully', async () => {
        const mockStateFile = join(tmpDir, 'mock-state.json');
        writeFileSync(mockStateFile, JSON.stringify({ resources: mockResources }));

        const mockSave = vi.fn();
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getState: vi.fn().mockReturnValue({ resources: [], serial: 0 }),
                save: mockSave
            };
        });

        await stateCmd({ action: 'push', args: [mockStateFile] });

        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Successfully pushed state');
    });

    it('should list resources', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockResources)
            };
        });

        await stateCmd({ action: 'list', args: [] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('testcase.tc1');
        expect(logs).toContain('[tainted] testrun.tr1');
    });

    it('should show identities', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockResources)
            };
        });

        await stateCmd({ action: 'identities', args: [] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('tc1');
        expect(logs).toContain('tr1');
    });

    it('should show a specific resource', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockResources)
            };
        });

        await stateCmd({ action: 'show', args: ['testcase.tc1'] });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('resource "testcase" "tc1"');
        expect(logs).toContain('Test 1');
    });

    it('should remove a resource', async () => {
        const mockRemoveResource = vi.fn();
        const mockSave = vi.fn();
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockResources),
                removeResource: mockRemoveResource,
                save: mockSave
            };
        });

        await stateCmd({ action: 'rm', args: ['testcase.tc1'] });

        expect(mockRemoveResource).toHaveBeenCalledWith('tc1');
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        expect(logs).toContain('Removed testcase.tc1');
    });

    it('should move a resource', async () => {
        const mockRemoveResource = vi.fn();
        const mockUpsertResource = vi.fn();
        const mockSave = vi.fn();
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([ ...mockResources ]), // Shallow copy
                removeResource: mockRemoveResource,
                upsertResource: mockUpsertResource,
                save: mockSave
            };
        });

        await stateCmd({ action: 'mv', args: ['testcase.tc1', 'testcase.tc2'] });

        expect(mockRemoveResource).toHaveBeenCalledWith('tc1');
        expect(mockUpsertResource).toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Move testcase.tc1 to testcase.tc2 successfully executed!');
    });

    it('should exit with error on unknown subcommand', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        await expect(stateCmd({ action: 'unknown', args: [] })).rejects.toThrow();
        expect(mockError).toHaveBeenCalled();
    });

    it('should clean and optimize state payload with state clean', async () => {
        const resourcesWithClutter = [
            {
                type: 'github_testcase',
                identity: 'tc1',
                attributes: {
                    title: 'Test 1',
                    body: '```gherkin\nGiven something\nWhen something\nThen something\n```',
                    milestone: '',
                    labels: ['testcase'],
                    assignees: ['user1'],
                    custom_fields: {
                        module: '',
                        functional: ''
                    }
                }
            }
        ];

        const mockSave = vi.fn();
        const mockGetState = vi.fn().mockReturnValue({ resources: resourcesWithClutter });
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(resourcesWithClutter),
                getState: mockGetState,
                save: mockSave
            };
        });

        await stateCmd({ action: 'clean', args: [] });

        expect(mockSave).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('State optimization complete');
        // Verify attributes were cleaned
        expect(resourcesWithClutter[0].attributes.body).toBe('```gherkin\nGiven something\nWhen something\nThen something\n```');
        expect(resourcesWithClutter[0].attributes).not.toHaveProperty('milestone');
        expect(resourcesWithClutter[0].attributes).not.toHaveProperty('custom_fields');
        expect(resourcesWithClutter[0].attributes.title).toBe('Test 1');
        expect(resourcesWithClutter[0].attributes.labels).toEqual(['testcase']);
    });

    it('should preview optimization in dry-run mode without calling save', async () => {
        const resourcesWithClutter = [
            {
                type: 'github_testcase',
                identity: 'tc1',
                attributes: {
                    title: 'Test 1',
                    body: 'Body payload',
                    milestone: ''
                }
            }
        ];

        const mockSave = vi.fn();
        const mockGetState = vi.fn().mockReturnValue({ resources: resourcesWithClutter });
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(resourcesWithClutter),
                getState: mockGetState,
                save: mockSave
            };
        });

        await stateCmd({ action: 'clean', args: [], dryRun: true });

        expect(mockSave).not.toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('dry-run preview');
    });

    describe('cleanAttributes helper', () => {
        it('should preserve non-empty body while stripping nulls, empty strings, and empty objects', () => {
            const raw = {
                localHash: 'hash123',
                remoteId: 'ID-1',
                issueNumber: 42,
                title: 'Clean Test',
                body: 'Full scenario body text that is preserved',
                milestone: '',
                emptyField: null,
                undefField: undefined,
                emptyArray: [],
                labels: ['tag1', 'tag2'],
                custom_fields: {
                    module: '',
                    project: '',
                    sprint: ''
                }
            };

            const cleaned = cleanAttributes(raw);

            expect(cleaned).toEqual({
                localHash: 'hash123',
                remoteId: 'ID-1',
                issueNumber: 42,
                title: 'Clean Test',
                body: 'Full scenario body text that is preserved',
                labels: ['tag1', 'tag2']
            });
            expect(cleaned).not.toHaveProperty('milestone');
            expect(cleaned).not.toHaveProperty('custom_fields');
            expect(cleaned).not.toHaveProperty('emptyField');
            expect(cleaned).not.toHaveProperty('emptyArray');
        });

        it('should strip empty body string ("")', () => {
            const raw = {
                title: 'No Body',
                body: '   ',
                milestone: ''
            };

            const cleaned = cleanAttributes(raw);
            expect(cleaned).toEqual({
                title: 'No Body'
            });
            expect(cleaned).not.toHaveProperty('body');
        });

        it('should preserve non-empty custom_fields and non-empty values', () => {
            const raw = {
                title: 'Test',
                custom_fields: {
                    module: 'Core',
                    sprint: ''
                }
            };

            const cleaned = cleanAttributes(raw);

            expect(cleaned).toEqual({
                title: 'Test',
                custom_fields: {
                    module: 'Core'
                }
            });
        });
    });
});
