import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { graphCmd } from '../src/commands/graph';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('Command graphCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-graph-test-'));
        mockLog.mockClear();
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockLog.mockRestore();
    });

    it('should output message if no configurations found', async () => {
        await graphCmd({ dir: tmpDir });
        expect(mockLog).toHaveBeenCalledWith('No test configurations found.');
    });

    it('should draw graph successfully for test plans, runs, and cases', async () => {
        writeFileSync(join(tmpDir, 'test.case.feature'), `
Feature: Test Case 1
  @testcase
  Scenario: Do something
        `);

        writeFileSync(join(tmpDir, 'test.run.feature'), `
Feature: Test Run 1
  @testrun
  Rule: test.case.feature
        `);

        writeFileSync(join(tmpDir, 'test.plan.feature'), `
Feature: Test Plan 1
  @testplan
  Rule: test.run.feature
        `);

        await graphCmd({ dir: tmpDir, scope: 'testcase' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        
        // Output should contain the feature names
        expect(logs).toContain('Test Plan 1');
        expect(logs).toContain('Test Run 1');
        expect(logs).toContain('Do something');
    });

    it('should draw colored graph if drawCycles=true', async () => {
        writeFileSync(join(tmpDir, 'test.case.feature'), `
Feature: Test Case 1
  @testcase
  Scenario: Do something
        `);

        await graphCmd({ dir: tmpDir, scope: 'testcase', drawCycles: true });
        // Mostly verifies that drawCycles option doesn't crash the program
        expect(mockLog).toHaveBeenCalled();
    });

    it('should output testrun graph when scope=testrun', async () => {
        writeFileSync(join(tmpDir, 'test.case.feature'), `
Feature: Test Case 1
  @testcase
  Scenario: Do something
        `);

        writeFileSync(join(tmpDir, 'test.run.feature'), `
Feature: Test Run 1
  @testrun
  Rule: test.case.feature
        `);

        await graphCmd({ dir: tmpDir, scope: 'testrun' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\\n');
        
        // Test Plan should NOT be at the root, only Test Run
        expect(logs).toContain('Test Run 1');
        expect(logs).toContain('Do something');
    });
});
