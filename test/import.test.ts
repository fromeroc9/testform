import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { importCmd } from '../src/commands/import';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { GitHubAdapter } from '../src/adapters/github';
import { FILE_STATE } from '../src/core/const';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/adapters/github');

describe('Command importCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-import-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (GitHubAdapter as jest.Mock).mockClear();
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

    it('should fail if no configuration file is present', async () => {
        await expect(importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: '123'
        })).rejects.toThrow('Process exited with code 1');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No configuration files');
    });

    it('should fail if issue number is invalid', async () => {
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0', github: {} }));

        await expect(importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: 'abc'
        })).rejects.toThrow('Process exited with code 1');

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('Invalid issue number');
    });

    it('should fail if issue is not found in github', async () => {
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0', github: {} }));
        (GitHubAdapter as jest.Mock).mockImplementation(() => ({
            getIssue: jest.fn<any>().mockResolvedValue(null)
        }));

        await expect(importCmd({
            dir: tmpDir,
            scope: 'testcase',
            identityArg: 'tc1',
            issueNumber: '123'
        })).rejects.toThrow('Process exited with code 1');

        expect(mockError).toHaveBeenCalled();
        const errors = mockError.mock.calls.join(' ');
        expect(errors).toContain('not found in GitHub repository');
    });

    it('should successfully import an issue into state', async () => {
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0', github: {} }));
        
        // Mock a successful GitHub response
        const mockGetIssue = jest.fn<any>().mockResolvedValue({
            title: 'Mock Issue',
            body: 'Mock Body',
            number: 123,
            state: 'open'
        });
        
        (GitHubAdapter as jest.Mock).mockImplementation(() => ({
            getIssue: mockGetIssue,
            formatRemoteId: jest.fn().mockReturnValue('mock-remote-id')
        }));

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
        const stateContent = require('fs').readFileSync(statePath, 'utf8');
        expect(stateContent).toContain('tc1');
        expect(stateContent).toContain('Mock Issue');
    });

    it('should warn if issue is closed', async () => {
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0', github: {} }));
        (GitHubAdapter as jest.Mock).mockImplementation(() => ({
            getIssue: jest.fn<any>().mockResolvedValue({
                title: 'Mock Issue',
                number: 123,
                state: 'closed'
            }),
            formatRemoteId: jest.fn().mockReturnValue('mock-remote-id')
        }));

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
});
