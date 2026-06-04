import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { reportCmd } from '../src/commands/report';
import { State } from '../src/core/state';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

jest.mock('../src/core/state');

describe('Command reportCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-report-test-'));
        require('fs').writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: '1.0' }));
        mockLog.mockClear();
        (State as jest.Mock).mockClear();
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockLog.mockRestore();
        jest.restoreAllMocks();
    });

    const mockTestCases = [
        {
            identity: 'tc1',
            type: 'github_testcase',
            attributes: { title: 'Test 1', issueNumber: 1, labels: ['@sprint-1'], assignees: ['user1'], milestone: 'v1.0' }
        },
        {
            identity: 'tc2',
            type: 'github_testcase',
            attributes: { title: 'Test 2', issueNumber: 2, labels: ['@sprint-2'], assignees: ['user2'], milestone: 'v1.0', custom_fields: { priority: 'high' } }
        }
    ];

    const mockTestRuns = [
        {
            identity: 'tr1',
            type: 'github_testrun',
            attributes: { testcaseStatuses: { 'tc1': 'passed', 'tc2': 'failed' } }
        }
    ];

    it('should generate testcase-summary markdown', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: (type: string) => {
                if (type === 'github_testcase') return mockTestCases;
                if (type === 'github_testrun') return mockTestRuns;
                return [];
            }
        }));

        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe de Casos de Prueba');
        expect(logs).toContain('tc1');
        expect(logs).toContain('✅ passed');
        expect(logs).toContain('tc2');
        expect(logs).toContain('❌ failed');
    });

    it('should generate testrun-summary markdown', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: (type: string) => {
                if (type === 'github_testcase') return mockTestCases;
                if (type === 'github_testrun') return mockTestRuns;
                return [];
            }
        }));

        await reportCmd({ dir: tmpDir, type: 'testrun-summary', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Test Run Summary');
        expect(logs).toContain('Total Test Runs');
    });

    it('should filter correctly by label', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: (type: string) => {
                if (type === 'github_testcase') return mockTestCases;
                if (type === 'github_testrun') return mockTestRuns;
                return [];
            }
        }));

        const outPath = join(tmpDir, 'report.json');
        await reportCmd({ dir: tmpDir, type: 'raw', format: 'json', filter: ['labels=@sprint-1'], out: outPath });
        
        const content = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(content).toHaveLength(1);
        expect(content[0].id).toBe('tc1');
    });

    it('should filter correctly by custom field', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: (type: string) => {
                if (type === 'github_testcase') return mockTestCases;
                if (type === 'github_testrun') return mockTestRuns;
                return [];
            }
        }));

        const outPath = join(tmpDir, 'report2.json');
        await reportCmd({ dir: tmpDir, type: 'raw', format: 'json', filter: ['priority=high'], out: outPath });
        
        const content = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(content).toHaveLength(1);
        expect(content[0].id).toBe('tc2');
    });

    it('should output csv format correctly', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: (type: string) => {
                if (type === 'github_testcase') return mockTestCases;
                if (type === 'github_testrun') return mockTestRuns;
                return [];
            }
        }));

        await reportCmd({ dir: tmpDir, type: 'raw', format: 'csv', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('ID,Title,Status,Labels,Assignees,Milestone,TestRun,IssueNumber');
        expect(logs).toContain('tc1,"Test 1",passed,"@sprint-1","user1","v1.0",tr1,1');
    });

    it('should generate defects report', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: (type: string) => {
                if (type === 'github_testcase') return mockTestCases;
                if (type === 'github_testrun') return mockTestRuns;
                return [];
            }
        }));

        await reportCmd({ dir: tmpDir, type: 'defects', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe de Defectos');
        expect(logs).toContain('[#2](https://github.com/issues/2)');
        expect(logs).not.toContain('tc1');
    });

    it('should handle two-dimensional matrix', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            init: jest.fn<any>().mockResolvedValue(undefined),
            getResources: (type: string) => {
                if (type === 'github_testcase') return mockTestCases;
                if (type === 'github_testrun') return mockTestRuns;
                return [];
            }
        }));

        await reportCmd({ dir: tmpDir, type: 'two-dimensional', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe Bidimensional');
        expect(logs).toContain('@sprint-1');
        expect(logs).toContain('@sprint-2');
    });
});
