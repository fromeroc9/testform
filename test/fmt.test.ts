import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { fmtCmd } from '../src/commands/fmt';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('Command fmtCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-fmt-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
    });

    it('should output message if no feature files are found', async () => {
        await fmtCmd({ dir: tmpDir });
        expect(mockLog).toHaveBeenCalledWith('No .feature files found.');
    });

    it('should format a feature file and write it by default', async () => {
        const filePath = join(tmpDir, 'test.feature');
        const unformatted = `Feature: Test\nScenario: One\nGiven step`;
        writeFileSync(filePath, unformatted);

        await fmtCmd({ dir: tmpDir });

        const formatted = readFileSync(filePath, 'utf8');
        expect(formatted).not.toBe(unformatted);
        expect(formatted).toContain('  Scenario: One');
        expect(formatted).toContain('    Given step');
        expect(mockLog).toHaveBeenCalled();
    });

    it('should not write if write=false', async () => {
        const filePath = join(tmpDir, 'test.feature');
        const unformatted = `Feature: Test\nScenario: One\nGiven step`;
        writeFileSync(filePath, unformatted);

        await fmtCmd({ dir: tmpDir, write: false });

        const content = readFileSync(filePath, 'utf8');
        expect(content).toBe(unformatted); // Unchanged
    });

    it('should exit with code 3 if check=true and files are unformatted', async () => {
        const filePath = join(tmpDir, 'test.feature');
        const unformatted = `Feature: Test\nScenario: One\nGiven step`;
        writeFileSync(filePath, unformatted);

        await expect(fmtCmd({ dir: tmpDir, check: true })).rejects.toThrow('Process exited with code 3');

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('would be reformatted.');
    });

    it('should format recursively if recursive=true', async () => {
        const subDir = join(tmpDir, 'sub');
        mkdirSync(subDir);
        const filePath = join(subDir, 'test.feature');
        const unformatted = `Feature: Test\nScenario: One\nGiven step`;
        writeFileSync(filePath, unformatted);

        // Without recursive, it shouldn't find it
        await fmtCmd({ dir: tmpDir });
        expect(mockLog).toHaveBeenCalledWith('No .feature files found.');

        mockLog.mockClear();

        // With recursive, it should find and format it
        await fmtCmd({ dir: tmpDir, recursive: true });
        
        const formatted = readFileSync(filePath, 'utf8');
        expect(formatted).not.toBe(unformatted);
    });
});
