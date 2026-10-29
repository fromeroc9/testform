import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { validateCmd } from '../src/commands/validate';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { FILE_CONFIG } from '../src/core/const';
import { policy } from '../src/core/policy';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock policy scanner to avoid real policy execution which might have unexpected outputs
vi.mock('../src/core/policy', () => ({
    policy: {
        scanner: vi.fn()
    }
}));

describe('Command validateCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-validate-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (policy.scanner as any).mockClear();
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

    it('should fail if the target path does not exist or has no feature files', async () => {
        await expect(validateCmd({
            targetPath: join(tmpDir, 'nonexistent'),
            target: 'testcase'
        })).rejects.toThrow();

        expect(mockError).toHaveBeenCalled();
        const errorMsg = mockError.mock.calls.join(' ');
        expect(errorMsg).toContain('Failed to read module directory');
    });

    it('should output JSON error if isJson=true and directory is invalid', async () => {
        await validateCmd({
            targetPath: join(tmpDir, 'nonexistent'),
            target: 'testcase',
            isJson: true
        });

        expect(mockLog).toHaveBeenCalled();
        const logContent = mockLog.mock.calls[0][0] as string;
        const parsed = JSON.parse(logContent);
        expect(parsed).toHaveProperty('valid', false);
        expect(parsed.diagnostics[0].summary).toBe('Failed to read module directory');
    });

    it('should successfully validate if valid feature files are present (Happy Path)', async () => {
        // Create testform.yml
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0', provider: 'local' }));

        // Create a dummy feature file
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Dummy Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            target: 'testcase'
        });

        expect(policy.scanner).toHaveBeenCalled();
    });

    it('should skip tests if noTests=true is passed', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0', provider: 'local' }));
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Dummy Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            target: 'testcase',
            noTests: true
        });

        expect(policy.scanner).not.toHaveBeenCalled();
    });

    it('should respect testDirectory option', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0', provider: 'local' }));
        const testDir = join(tmpDir, 'custom_tests');
        mkdirSync(testDir);
        writeFileSync(join(testDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Dummy Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            testDirectory: 'custom_tests',
            target: 'testcase'
        });

        expect(policy.scanner).toHaveBeenCalled();
    });

    it('should output JSON success if isJson=true and files are valid', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0', provider: 'local' }));
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Dummy Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            target: 'testcase',
            isJson: true
        });

        // The validate success in JSON format is printed to console.log
        const logContent = mockLog.mock.calls.find(call => (call[0] as string).includes('"valid": true'));
        expect(logContent).toBeDefined();
        const parsed = JSON.parse(logContent![0] as string);
        expect(parsed).toHaveProperty('valid', true);
    });

    it('should filter scenarios based on query', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0', provider: 'local' }));
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Specific Query Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            target: 'testcase',
            query: 'Specific Query Scenario'
        });

        // policy.scanner should be called with filtered scenarios
        expect(policy.scanner).toHaveBeenCalled();
        const calledScenarios = (policy.scanner as any).mock.calls[0][0] as any[];
        expect(calledScenarios.length).toBe(1);
        expect(calledScenarios[0].name).toBe('Specific Query Scenario');
    });

    it('should fail with Missing required provider when provider is not declared', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0' }));
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `Feature: Dummy\n  Scenario: S1\n    Given s\n`);

        await expect(validateCmd({
            targetPath: tmpDir,
            target: 'testcase'
        })).rejects.toThrow('Missing required provider');
    });
});
