import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { planCmd } from '../src/commands/plan';
import { State } from '../src/core/state';
import { Parser } from '../src/core/parser';
import { Config } from '../src/core/config';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../src/core/state');
vi.mock('../src/core/parser');
vi.mock('../src/core/config');
vi.mock('../src/core/policy');

describe('Command planCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-plan-test-'));
        mockLog.mockClear();
        mockError.mockClear();
        (State as any).mockClear();
        (Parser as any).mockClear();
        (Config as any).mockClear();

        (Config as any).mockImplementation(function() {
            return {
                getIdentity: vi.fn().mockReturnValue('testcase.*'),
                getFields: vi.fn().mockReturnValue([])
            };
        });
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockLog.mockRestore();
        mockError.mockRestore();
        vi.restoreAllMocks();
    });

    const mockStateResources = [
        { identity: 'file1.tc1', attributes: { localHash: 'hash1', remoteId: 'remote-1' } }
    ];

    it('should generate a plan successfully', async () => {
        const scenarioNew = { uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' };

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([scenarioNew])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockStateResources)
            };
        });

        const result = await planCmd({ dir: tmpDir, target: 'testcase', refresh: false });

        expect(result).toBeDefined();
        expect(result!.changes.length).toBeGreaterThan(0);
        expect(result!.hasChanges).toBe(true);
        expect(mockLog).toHaveBeenCalled();
    });

    it('should output plan to a file if outPath is specified', async () => {
        const outPath = join(tmpDir, 'plan.out');

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        await planCmd({ dir: tmpDir, target: 'testcase', refresh: false, outPath });

        expect(existsSync(outPath)).toBe(true);
        const fileContent = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(fileContent).toHaveProperty('testform_version');
        expect(fileContent).toHaveProperty('changes');
    });

    it('should output JSON when isJson is true', async () => {
        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue([])
            };
        });

        await planCmd({ dir: tmpDir, target: 'testcase', refresh: false, isJson: true });

        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('"testform_version"');
        expect(logs).toContain('"changes": []');
    });

    it('should set exit code to 2 if detailedExitCode is true and there are changes', async () => {
        const scenarioNew = { uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' };

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([scenarioNew])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockStateResources)
            };
        });

        await planCmd({ dir: tmpDir, target: 'testcase', refresh: false, detailedExitCode: true });

        expect(process.exitCode).toBe(2);
        process.exitCode = 0; // reset for other tests
    });

    it('should return empty changes when refreshOnly is true', async () => {
        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([{ uri: 'file2', custom: { identity: 'tc2' }, steps: [], name: 'tc2' }])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockStateResources)
            };
        });

        const result = await planCmd({ dir: tmpDir, target: 'testcase', refresh: false, refreshOnly: true });

        expect(result).toBeDefined();
        expect(result!.changes).toHaveLength(0);
        expect(result!.hasChanges).toBe(false);
    });

    it('should force replace resources matching replaceTargets', async () => {
        const scenario = { uri: 'file1', custom: { identity: 'tc1' }, steps: [], name: 'tc1' };

        (Parser as any).mockImplementation(function() {
            return {
                content: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockReturnValue([scenario])
            };
        });

        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                acquireLock: vi.fn<any>().mockResolvedValue(undefined),
                releaseLock: vi.fn<any>().mockResolvedValue(undefined),
                getResources: vi.fn().mockReturnValue(mockStateResources)
            };
        });

        const result = await planCmd({ dir: tmpDir, target: 'testcase', refresh: false, replaceTargets: 'file1.tc1' });

        expect(result).toBeDefined();
        expect(result!.changes).toHaveLength(1);
        const replaceChange = result!.changes.find(c => c.action === 'replace');
        expect(replaceChange).toBeDefined();
    });
});
