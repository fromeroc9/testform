import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { planCmd } from '../src/commands/plan';
import { State } from '../src/core/state';
import { Parser } from '../src/core/parser';
import { Config } from '../src/core/config';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/core/state');
jest.mock('../src/core/parser');
jest.mock('../src/core/config');
jest.mock('../src/core/policy');

describe('Command planCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-plan-test-'));
        mockLog.mockClear();
        mockError.mockClear();
        (State as jest.Mock).mockClear();
        (Parser as jest.Mock).mockClear();
        (Config as jest.Mock).mockClear();

        (Config as jest.Mock).mockImplementation(() => ({
            getIdentity: jest.fn().mockReturnValue('testcase.*'),
            getFields: jest.fn().mockReturnValue([])
        }));
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockLog.mockRestore();
        mockError.mockRestore();
        jest.restoreAllMocks();
    });

    const mockStateResources = [
        { identity: 'file1::tc1', attributes: { localHash: 'hash1', remoteId: 'remote-1' } }
    ];

    it('should generate a plan successfully', async () => {
        const scenarioNew = { uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' };

        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([scenarioNew])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockStateResources)
        }));

        const result = await planCmd({ dir: tmpDir, scope: 'testcase', refresh: false });

        expect(result.changes.length).toBeGreaterThan(0);
        expect(result.hasChanges).toBe(true);
        expect(mockLog).toHaveBeenCalled();
    });

    it('should output plan to a file if outPath is specified', async () => {
        const outPath = join(tmpDir, 'plan.out');

        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        await planCmd({ dir: tmpDir, scope: 'testcase', refresh: false, outPath });

        expect(existsSync(outPath)).toBe(true);
        const fileContent = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(fileContent).toHaveProperty('testform_version');
        expect(fileContent).toHaveProperty('changes');
    });

    it('should output JSON when isJson is true', async () => {
        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue([])
        }));

        await planCmd({ dir: tmpDir, scope: 'testcase', refresh: false, isJson: true });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('"testform_version"');
        expect(logs).toContain('"changes": []');
    });

    it('should set exit code to 2 if detailedExitCode is true and there are changes', async () => {
        const scenarioNew = { uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' };

        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([scenarioNew])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockStateResources)
        }));

        await planCmd({ dir: tmpDir, scope: 'testcase', refresh: false, detailedExitCode: true });

        expect(process.exitCode).toBe(2);
        process.exitCode = 0; // reset for other tests
    });

    it('should return empty changes when refreshOnly is true', async () => {
        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockStateResources)
        }));

        const result = await planCmd({ dir: tmpDir, scope: 'testcase', refresh: false, refreshOnly: true });

        expect(result.changes).toHaveLength(0);
        expect(result.hasChanges).toBe(false);
    });

    it('should force replace resources matching replaceTargets', async () => {
        const scenario = { uri: 'file1', custom: { identity: 'tc1' }, steps: [], name: 'tc1' };

        (Parser as jest.Mock).mockImplementation(() => ({
            content: jest.fn().mockReturnValue([]),
            filter: jest.fn().mockReturnValue([scenario])
        }));

        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            acquireLock: jest.fn<any>().mockResolvedValue(undefined),
            releaseLock: jest.fn<any>().mockResolvedValue(undefined),
            getResources: jest.fn().mockReturnValue(mockStateResources)
        }));

        const result = await planCmd({ dir: tmpDir, scope: 'testcase', refresh: false, replaceTargets: 'file1::tc1' });

        expect(result.changes).toHaveLength(1);
        // Wait, mockStateResources identity is 'file1::tc1'. The scenario identity will be 'file1::tc1'.
        // So existing is found. shouldForceReplace = true.
        // It should add a 'replace' action.
        const replaceChange = result.changes.find(c => c.action === 'replace');
        expect(replaceChange).toBeDefined();
    });
});
