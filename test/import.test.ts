import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { importCmd } from '../src/commands/import';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { GitHubAdapter } from '../src/providers/github';
import { FILE_STATE } from '../src/core/const';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../src/providers/github');

describe('Command importCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-import-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (GitHubAdapter as any).mockClear();
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

    it('should fail if no configuration file is present', async () => {
        await expect(importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: '123'
        })).rejects.toThrow();
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No configuration files');
    });

    it('should fail if issue number is invalid', async () => {
        writeFileSync(join(tmpDir, 'testform.yml'), JSON.stringify({ version: '1.0', provider: { github: {} } }));

        await expect(importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: 'abc'
        })).rejects.toThrow();

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('Invalid issue number');
    });

    it('should fail if issue is not found in github', async () => {
        writeFileSync(join(tmpDir, 'testform.yml'), JSON.stringify({ version: '1.0', provider: { github: {} } }));
        (GitHubAdapter as any).mockImplementation(function() {
            return {
                getIssue: vi.fn<any>().mockResolvedValue(null)
            };
        });

        await expect(importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: '123'
        })).rejects.toThrow();

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('not found in GitHub repository');
    });

    it('should successfully import an issue into state', async () => {
        writeFileSync(join(tmpDir, 'testform.yml'), JSON.stringify({ version: '1.0', provider: { github: {} } }));
        
        // Mock a successful GitHub response
        const mockGetIssue = vi.fn<any>().mockResolvedValue({
            title: 'Mock Issue',
            body: 'Mock Body',
            number: 123,
            state: 'open'
        });
        
        (GitHubAdapter as any).mockImplementation(function() {
            return {
                getIssue: mockGetIssue,
                formatRemoteId: vi.fn().mockReturnValue('mock-remote-id')
            };
        });

        await importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: '123'
        });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Import successful!');
        
        // Check if state file was created and contains the imported resource
        const statePath = join(tmpDir, FILE_STATE);
        expect(existsSync(statePath)).toBe(true);
        const stateContent = readFileSync(statePath, 'utf8');
        expect(stateContent).toContain('tc1');
        expect(stateContent).toContain('Mock Issue');
    });

    it('should warn if issue is closed', async () => {
        writeFileSync(join(tmpDir, 'testform.yml'), JSON.stringify({ version: '1.0', provider: { github: {} } }));
        (GitHubAdapter as any).mockImplementation(function() {
            return {
                getIssue: vi.fn<any>().mockResolvedValue({
                    title: 'Mock Issue',
                    number: 123,
                    state: 'closed'
                }),
                formatRemoteId: vi.fn().mockReturnValue('mock-remote-id')
            };
        });

        await importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: '123'
        });

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('is currently closed.');
    });
    it('should parse JUnit XML results and generate .run.feature with set status', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), 'testform:\n  backend: "local"\n');

        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Playwright Tests" tests="2" failures="1" errors="0" time="2.45">
  <testsuite name="Authentication" tests="2" failures="1" time="2.45">
    <testcase classname="tests/auth/login.case.feature" name="Valid login @tc-01" time="1.10">
      <system-out>[[ATTACHMENT|evidence/login-ok.png]]</system-out>
    </testcase>
    <testcase classname="tests/auth/login.case.feature" name="Failed login @tc-02" time="1.35">
      <failure message="Expected error banner" type="AssertionError">
        AssertionError: Expected banner not found
          at login.spec.ts:55
      </failure>
    </testcase>
  </testsuite>
</testsuites>`;

        writeFileSync(join(tmpDir, 'results.xml'), xmlContent, 'utf8');

        await importCmd({
            dir: tmpDir,
            results: 'results.xml',
            autoCreateBugs: true
        });

        const runsDir = join(tmpDir, 'tests/runs');
        expect(existsSync(runsDir)).toBe(true);
        const files = readdirSync(runsDir);
        expect(files.length).toBeGreaterThan(0);

        const runContent = readFileSync(join(runsDir, files[0]), 'utf8');
        expect(runContent).toContain('Scenario: tests/auth/login.case.feature.@tc-01');
        expect(runContent).toContain('* set status = passed');
        expect(runContent).toContain('* set duration = 1.10s');
        expect(runContent).toContain('* set evidence = evidence/login-ok.png');

        expect(runContent).toContain('Scenario: tests/auth/login.case.feature.@tc-02');
        expect(runContent).toContain('* set status = failed');
        expect(runContent).toContain('* set duration = 1.35s');
        expect(runContent).toContain('* set trace = AssertionError: Expected banner not found');

        // Check bug created
        const bugsDir = join(tmpDir, 'tests/bugs');
        expect(existsSync(bugsDir)).toBe(true);
        const bugFiles = readdirSync(bugsDir);
        expect(bugFiles.length).toBeGreaterThan(0);
        const bugContent = readFileSync(join(bugsDir, bugFiles[0]), 'utf8');
        expect(bugContent).toContain('* set target = tests/auth/login.case.feature.@tc-02');
        expect(bugContent).toContain('* set status = failed');
    });

    it('should parse Playwright JSON results format', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), 'testform:\n  backend: "local"\n');

        const pwJson = {
            config: {},
            suites: [
                {
                    title: 'Cart Suite',
                    file: 'tests/cart/checkout.case.feature',
                    specs: [
                        {
                            title: 'Order item with discount @tc-10',
                            tags: ['@tc-10'],
                            tests: [
                                {
                                    results: [
                                        {
                                            status: 'passed',
                                            duration: 1540
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        writeFileSync(join(tmpDir, 'playwright.json'), JSON.stringify(pwJson), 'utf8');

        await importCmd({
            dir: tmpDir,
            results: 'playwright.json'
        });

        const runsDir = join(tmpDir, 'tests/runs');
        const files = readdirSync(runsDir);
        const runContent = readFileSync(join(runsDir, files[0]), 'utf8');
        expect(runContent).toContain('Scenario: tests/cart/checkout.case.feature.@tc-10');
        expect(runContent).toContain('* set status = passed');
        expect(runContent).toContain('* set duration = 1.54s');
    });

    it('should update existing run feature when target option is specified', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), 'testform:\n  backend: "local"\n');

        const targetRunFile = join(tmpDir, 'my-sprint.run.feature');
        writeFileSync(targetRunFile, `@testrun @tr-99
Feature: Sprint Run

  Scenario: tests/auth/login.case.feature.@tc-01
    * set status = pending
`, 'utf8');

        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Tests" tests="1">
  <testcase classname="tests/auth/login.case.feature" name="Login @tc-01" time="0.95" />
</testsuite>`;

        writeFileSync(join(tmpDir, 'report.xml'), xmlContent, 'utf8');

        await importCmd({
            dir: tmpDir,
            results: 'report.xml',
            target: 'my-sprint.run.feature'
        });

        const updatedRun = readFileSync(targetRunFile, 'utf8');
        expect(updatedRun).toContain('Scenario: tests/auth/login.case.feature.@tc-01');
        expect(updatedRun).toContain('* set status = passed');
        expect(updatedRun).toContain('* set duration = 0.95s');
    });
});
