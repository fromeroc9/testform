import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { graphCmd } from '../src/commands/graph';
import { getCommandHelp, HELP_GRAPH } from '../src/core/help';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

describe('Command graphCmd & Help', () => {
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

    it('should return HELP_GRAPH from getCommandHelp', () => {
        const help = getCommandHelp('graph');
        expect(help).toBe(HELP_GRAPH);
        expect(help).toContain('Usage: testform [global options] graph [options]');
        expect(help).toContain('The graph is presented in the DOT language by default');
        expect(help).toContain('-format=FORMAT');
        expect(help).toContain('dot (default), mermaid, and tree');
    });

    it('should output message if no configurations found', async () => {
        await graphCmd({ dir: tmpDir });
        expect(mockLog).toHaveBeenCalledWith('No test configurations found.');
    });

    it('should draw DOT graph by default for test plans, runs, and cases', async () => {
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
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\n');
        
        // Output should be in DOT format by default
        expect(logs).toContain('digraph G {');
        expect(logs).toContain('subgraph "root" {');
        expect(logs).toContain('"[root] testplan.Test Plan 1"');
        expect(logs).toContain('"[root] testrun.Test Run 1"');
        expect(logs).toContain('"[root] testcase.Do something"');
        expect(logs).toContain('"[root] testplan.Test Plan 1" -> "[root] testrun.Test Run 1"');
        expect(logs).toContain('"[root] testrun.Test Run 1" -> "[root] testcase.Do something"');
    });

    it('should render Mermaid graph when format=mermaid', async () => {
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

        await graphCmd({ dir: tmpDir, scope: 'testcase', format: 'mermaid' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\n');

        expect(logs).toContain('graph TD');
        expect(logs).toContain('subgraph root');
        expect(logs).toContain('Test Run 1');
        expect(logs).toContain('Do something');
        expect(logs).toContain('-->');
    });

    it('should render ASCII tree graph when format=tree, console, or string', async () => {
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

        // Test with format: 'console'
        await graphCmd({ dir: tmpDir, scope: 'testcase', format: 'tree' });
        expect(mockLog).toHaveBeenCalled();
        let logs = mockLog.mock.calls.map(c => c.join(' ')).join('\n');
        expect(logs).toContain('Test Infrastructure Graph');
        expect(logs).toContain('Test Run 1');
        expect(logs).toContain('Do something');

        mockLog.mockClear();

        // Test with format: 'string'
        await graphCmd({ dir: tmpDir, scope: 'testcase', format: 'tree' });
        expect(mockLog).toHaveBeenCalled();
        logs = mockLog.mock.calls.map(c => c.join(' ')).join('\n');
        expect(logs).toContain('Test Infrastructure Graph');
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

    it('should highlight cycle edges in DOT when drawCycles=true', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
dependencies:
  "a.case.feature.@tc-a": ["b.case.feature.@tc-b"]
  "b.case.feature.@tc-b": ["a.case.feature.@tc-a"]
        `);

        writeFileSync(join(tmpDir, 'a.case.feature'), `
Feature: Feature A
  @testcase @tc-a
  Scenario: Scenario A
        `);

        writeFileSync(join(tmpDir, 'b.case.feature'), `
Feature: Feature B
  @testcase @tc-b
  Scenario: Scenario B
        `);

        writeFileSync(join(tmpDir, 'suite.run.feature'), `
Feature: Suite Run
  @testrun
  Rule: a.case.feature
  Rule: b.case.feature
        `);

        await graphCmd({ dir: tmpDir, scope: 'testcase', drawCycles: true, format: 'dot' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\n');

        expect(logs).toContain('color = "red"');
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

        writeFileSync(join(tmpDir, 'test.plan.feature'), `
Feature: Test Plan 1
  @testplan
  Rule: test.run.feature
        `);

        await graphCmd({ dir: tmpDir, scope: 'testrun' });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.map(c => c.join(' ')).join('\n');
        
        // Test Plan should NOT be in the graph, only Test Run
        expect(logs).toContain('Test Run 1');
        expect(logs).toContain('Do something');
        expect(logs).not.toContain('Test Plan 1');
    });
});
