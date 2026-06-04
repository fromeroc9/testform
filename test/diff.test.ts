import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { diffCmd } from '../src/commands/diff';
import { State } from '../src/core/state';
import { Parser } from '../src/core/parser';
import { Config } from '../src/core/config';
import { createHash } from 'crypto';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

jest.mock('../src/core/state');
jest.mock('../src/core/parser');
jest.mock('../src/core/config');

function hashScenario(scenario: any): string {
    return createHash('sha256').update(JSON.stringify(scenario)).digest('hex');
}

describe('Command diffCmd', () => {
    beforeEach(() => {
        mockLog.mockClear();
        (State as jest.Mock).mockClear();
        (Parser as jest.Mock).mockClear();
        (Config as jest.Mock).mockClear();

        (Config as jest.Mock).mockImplementation(() => ({
            getIdentity: jest.fn().mockReturnValue('testcase.*'),
            getFields: jest.fn().mockReturnValue([])
        }));
    });

    afterAll(() => {
        mockLog.mockRestore();
        jest.restoreAllMocks();
    });

    it('should detect synced, modified, new, and orphaned resources', async () => {
        const scenarioSynced = { uri: 'file1', custom: { identity: 'synced_tc' }, other: 'data1' };
        const scenarioModified = { uri: 'file1', custom: { identity: 'modified_tc' }, other: 'data2_changed' };
        const scenarioNew = { uri: 'file2', custom: { identity: 'new_tc' }, other: 'data3' };

        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([scenarioSynced, scenarioModified, scenarioNew])
        }));

        const mockStateResources = [
            {
                identity: 'file1::synced_tc',
                attributes: { localHash: hashScenario(scenarioSynced), remoteId: 'remote-1' }
            },
            {
                identity: 'file1::modified_tc',
                attributes: { localHash: 'old-hash', remoteId: 'remote-2' }
            },
            {
                identity: 'file3::orphaned_tc',
                attributes: { localHash: 'orphaned-hash', remoteId: 'remote-3' }
            }
        ];

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockStateResources)
        }));

        await diffCmd({ scope: 'testcase', verbose: true });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        
        // Check contents
        expect(logs).toContain('synced');
        expect(logs).toContain('modified locally');
        expect(logs).toContain('new (not applied)');
        expect(logs).toContain('orphaned (not in config)');

        // Check identities
        expect(logs).toContain('file1::synced_tc');
        expect(logs).toContain('file1::modified_tc');
        expect(logs).toContain('file2::new_tc');
        expect(logs).toContain('file3::orphaned_tc');

        // Check summary counts
        expect(logs).toContain('1 synced');
        expect(logs).toContain('1 modified locally');
        expect(logs).toContain('1 new (not applied)');
        expect(logs).toContain('1 orphaned (not in config)');
    });
});
