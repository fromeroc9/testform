import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { validateCmd } from '../src/commands/validate';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { FILE_CONFIG } from '../src/const';
import { policy } from '../src/core/policy';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

// Mock policy scanner to avoid real policy execution which might have unexpected outputs
jest.mock('../src/core/policy', () => ({
    policy: {
        scanner: jest.fn()
    }
}));

describe('Command validateCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-validate-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (policy.scanner as jest.Mock).mockClear();
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
        jest.restoreAllMocks();
    });

    it('should fail if the target path does not exist or has no feature files', async () => {
        await expect(validateCmd({
            targetPath: join(tmpDir, 'nonexistent'),
            scope: 'testcase'
        })).rejects.toThrow('Process exited with code 1');

        expect(mockError).toHaveBeenCalled();
        const errorMsg = mockError.mock.calls.join(' ');
        expect(errorMsg).toContain('Failed to read module directory');
    });

    it('should output JSON error if isJson=true and directory is invalid', async () => {
        await validateCmd({
            targetPath: join(tmpDir, 'nonexistent'),
            scope: 'testcase',
            isJson: true
        });

        expect(mockLog).toHaveBeenCalled();
        const logContent = mockLog.mock.calls[0][0] as string;
        const parsed = JSON.parse(logContent);
        expect(parsed).toHaveProperty('valid', false);
        expect(parsed.diagnostics[0].summary).toBe('Failed to read module directory');
    });

    it('should successfully validate if valid feature files are present (Happy Path)', async () => {
        // Create testform.json
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0' }));

        // Create a dummy feature file
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Dummy Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            scope: 'testcase'
        });

        expect(policy.scanner).toHaveBeenCalled();
    });

    it('should skip tests if noTests=true is passed', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0' }));
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Dummy Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            scope: 'testcase',
            noTests: true
        });

        expect(policy.scanner).not.toHaveBeenCalled();
    });

    it('should respect testDirectory option', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0' }));
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
            scope: 'testcase'
        });

        expect(policy.scanner).toHaveBeenCalled();
    });

    it('should output JSON success if isJson=true and files are valid', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0' }));
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Dummy Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            scope: 'testcase',
            isJson: true
        });

        // The validate success in JSON format is printed to console.log
        const logContent = mockLog.mock.calls.find(call => (call[0] as string).includes('"valid": true'));
        expect(logContent).toBeDefined();
        const parsed = JSON.parse(logContent![0] as string);
        expect(parsed).toHaveProperty('valid', true);
    });

    it('should filter scenarios based on query', async () => {
        writeFileSync(join(tmpDir, FILE_CONFIG), JSON.stringify({ version: '1.0' }));
        writeFileSync(join(tmpDir, 'dummy.case.feature'), `
Feature: Dummy Feature
  @testcase
  Scenario: Specific Query Scenario
    Given something
        `);

        await validateCmd({
            targetPath: tmpDir,
            scope: 'testcase',
            query: 'Specific Query Scenario'
        });

        // policy.scanner should be called with filtered scenarios
        expect(policy.scanner).toHaveBeenCalled();
        const calledScenarios = (policy.scanner as jest.Mock).mock.calls[0][0] as any[];
        expect(calledScenarios.length).toBe(1);
        expect(calledScenarios[0].name).toBe('Specific Query Scenario');
    });
});
