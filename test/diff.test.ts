import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { diffCmd } from '../src/commands/diff';
import { State } from '../src/core/state';
import { Parser } from '../src/core/parser';
import { Config } from '../src/core/config';
import { createCommandContext } from '../src/core/context';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as readline from 'readline';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('../src/core/state');
vi.mock('../src/core/parser');
vi.mock('../src/core/config');
vi.mock('../src/core/context');
vi.mock('readline');

function hashScenario(scenario: any, scope: string = 'testcase'): string {
    const clone = JSON.parse(JSON.stringify(scenario));
    if (!scope || scope === 'testcase') {
        clone.name = '';
    }
    return createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

describe('Command diffCmd', () => {
    beforeEach(() => {
        mockLog.mockClear();
        (State as any).mockClear();
        (Parser as any).mockClear();
        (Config as any).mockClear();
        (createCommandContext as any).mockClear();

        (Config as any).mockImplementation(function() {
            return {
                getIdentity: vi.fn().mockReturnValue('testcase.*'),
                getFields: vi.fn().mockReturnValue([])
            };
        });
    });

    afterAll(() => {
        mockLog.mockRestore();
        vi.restoreAllMocks();
    });

    it('should detect synced, modified, new, and orphaned resources locally', async () => {
        const scenarioSynced = { uri: 'file1', custom: { identity: 'synced_tc' }, other: 'data1' };
        const scenarioModified = { uri: 'file1', custom: { identity: 'modified_tc' }, other: 'data2_changed' };
        const scenarioNew = { uri: 'file2', custom: { identity: 'new_tc' }, other: 'data3' };

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([scenarioSynced, scenarioModified, scenarioNew])
            };
        });

        const mockStateResources = [
            {
                identity: 'file1.synced_tc',
                attributes: { localHash: hashScenario(scenarioSynced), remoteId: 'remote-1' }
            },
            {
                identity: 'file1.modified_tc',
                attributes: { localHash: 'old-hash', remoteId: 'remote-2' }
            },
            {
                identity: 'file3.orphaned_tc',
                attributes: { localHash: 'orphaned-hash', remoteId: 'remote-3' }
            }
        ];

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockStateResources)
            };
        });

        await diffCmd({ target: 'testcase', verbose: true });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        
        // Check contents
        expect(logs).toContain('synced');
        expect(logs).toContain('modified locally');
        expect(logs).toContain('new (not applied)');
        expect(logs).toContain('orphaned (not in config)');

        // Check identities
        expect(logs).toContain('file1.synced_tc');
        expect(logs).toContain('file1.modified_tc');
        expect(logs).toContain('file2.new_tc');
        expect(logs).toContain('file3.orphaned_tc');

        // Check summary counts
        expect(logs).toContain('1 synced');
        expect(logs).toContain('1 modified locally');
        expect(logs).toContain('1 new (not applied)');
        expect(logs).toContain('1 orphaned (not in config)');
    });

    it('should detect remote drift when remote issue title and labels differ', async () => {
        const scenario = { uri: 'login.feature', name: 'Login V1', custom: { identity: 'login_tc' } };

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([scenario])
            };
        });

        const mockStateResource = {
            type: 'github_testcase',
            identity: 'login.feature.login_tc',
            attributes: {
                title: 'Login V1',
                issueNumber: 104,
                labels: ['@smoke']
            }
        };

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([mockStateResource])
            };
        });

        const mockGithub = {
            getIssue: vi.fn<any>().mockResolvedValue({
                title: 'Login V2 - Updated in GitHub',
                labels: ['@smoke', '@regression'],
                state: 'open'
            })
        };

        (createCommandContext as any).mockResolvedValue({
            adapter: mockGithub,
            github: mockGithub
        } as any);

        await diffCmd({ target: 'testcase', remote: true });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Remote Drift Detection');
        expect(logs).toContain('Found 1 resource(s) with remote drift');
        expect(logs).toContain('Login V2 - Updated in GitHub');
        expect(logs).toContain('labels');
    });

    it('should report fully synchronized when remote matches local', async () => {
        const scenario = { uri: 'login.feature', name: 'Login V1', custom: { identity: 'login_tc' } };

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([scenario])
            };
        });

        const mockStateResource = {
            type: 'github_testcase',
            identity: 'login.feature.login_tc',
            attributes: {
                title: 'Login V1',
                issueNumber: 104,
                labels: ['@smoke']
            }
        };

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([mockStateResource])
            };
        });

        const mockGithub = {
            getIssue: vi.fn<any>().mockResolvedValue({
                title: 'Login V1',
                labels: ['@smoke'],
                state: 'open'
            })
        };

        (createCommandContext as any).mockResolvedValue({
            adapter: mockGithub,
            github: mockGithub
        } as any);

        await diffCmd({ target: 'testcase', remote: true });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No remote drift detected');
    });

    it('should prompt interactively and pull remote changes when chosen', async () => {
        const tmpFile = 'tmp-test-drift.feature';
        fs.writeFileSync(tmpFile, 'Feature: Auth\n  @smoke\n  Scenario: Old Title\n    Given user logs in\n', 'utf8');

        try {
            const scenario = { uri: tmpFile, name: 'Old Title', custom: { identity: 'login_tc' } };

            (Parser as any).mockImplementation(function() {
                return {
                    content: vi.fn().mockReturnValue([]),
                    filter: vi.fn().mockReturnValue([scenario])
                };
            });

            const mockUpsert = vi.fn();
            const mockSave = vi.fn();

            const mockStateResource = {
                type: 'github_testcase',
                identity: `${tmpFile}.login_tc`,
                attributes: {
                    title: 'Old Title',
                    issueNumber: 105,
                    labels: ['@smoke']
                }
            };

            (State as any).mockImplementation(function() {
                return {
                    init: vi.fn<any>().mockResolvedValue(undefined),
                    getResources: vi.fn().mockReturnValue([mockStateResource]),
                    upsertResource: mockUpsert,
                    save: mockSave
                };
            });

            const mockGithub = {
                getIssue: vi.fn<any>().mockResolvedValue({
                    title: 'New Remote Title',
                    labels: ['@smoke', '@auth'],
                    state: 'open'
                })
            };

            (createCommandContext as any).mockResolvedValue({
                adapter: mockGithub,
                github: mockGithub
            } as any);

            (readline.createInterface as any).mockReturnValue({
                question: (_q: string, cb: any) => cb('1'),
                close: vi.fn()
            });

            await diffCmd({ target: 'testcase', remote: true, interactive: true });

            expect(mockSave).toHaveBeenCalled();
            const updatedContent = fs.readFileSync(tmpFile, 'utf8');
            expect(updatedContent).toContain('Scenario: New Remote Title');
            expect(updatedContent).toContain('@auth');
        } finally {
            if (fs.existsSync(tmpFile)) {
                fs.unlinkSync(tmpFile);
            }
        }
    });
});
