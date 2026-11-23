import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { reportCmd } from '../src/commands/report';
import { State } from '../src/core/state';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('../src/core/state');

describe('Command reportCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-report-test-'));
        writeFileSync(join(tmpDir, 'testform.yml'), JSON.stringify({ version: '1.0' }));
        mockLog.mockClear();
        (State as any).mockClear();
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockLog.mockRestore();
        vi.restoreAllMocks();
    });

    const mockTestCases = [
        {
            identity: 'tc1',
            type: 'testcase',
            attributes: { title: 'Test 1', issueNumber: 1, labels: ['@sprint-1'], assignees: ['user1'], milestone: 'v1.0' }
        },
        {
            identity: 'tc2',
            type: 'testcase',
            attributes: { title: 'Test 2', issueNumber: 2, labels: ['@sprint-2'], assignees: ['user2'], milestone: 'v1.0', custom_fields: { priority: 'high' } }
        }
    ];

    const mockTestRuns = [
        {
            identity: 'tr1',
            type: 'testrun',
            attributes: { testcaseStatuses: { 'tc1': 'passed', 'tc2': 'failed' } }
        }
    ];

    it('should generate testcase-summary markdown', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe de Casos de Prueba');
        expect(logs).toContain('tc1');
        expect(logs).toContain('✅ passed');
        expect(logs).toContain('tc2');
        expect(logs).toContain('❌ failed');
    });

    it('should generate testrun-summary markdown', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'testrun-summary', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Test Run Summary');
        expect(logs).toContain('Total Test Runs');
    });

    it('should filter correctly by label', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        const outPath = join(tmpDir, 'report.json');
        await reportCmd({ dir: tmpDir, type: 'raw', format: 'json', filter: ['labels=@sprint-1'], out: outPath });
        
        const content = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(content).toHaveLength(1);
        expect(content[0].id).toBe('tc1');
    });

    it('should filter correctly by custom field', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        const outPath = join(tmpDir, 'report2.json');
        await reportCmd({ dir: tmpDir, type: 'raw', format: 'json', filter: ['priority=high'], out: outPath });
        
        const content = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(content).toHaveLength(1);
        expect(content[0].id).toBe('tc2');
    });

    it('should output csv format correctly', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'raw', format: 'csv', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('ID,Title,Status,Labels,Assignees,Milestone,TestRun,IssueNumber');
        expect(logs).toContain('tc1,"Test 1",passed,"@sprint-1","user1","v1.0",tr1,1');
    });

    it('should generate defects report', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'defects', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe de Defectos');
        expect(logs).toContain('[#2](https://github.com/issues/2)');
        expect(logs).not.toContain('tc1');
    });

    it('should handle two-dimensional matrix', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'two-dimensional', format: 'md', filter: [] });
        
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe Bidimensional');
        expect(logs).toContain('@sprint-1');
        expect(logs).toContain('@sprint-2');
    });

    it('should include custom fields when requested via fields option', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'md', filter: [], fields: 'priority' });

        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe de Casos de Prueba');
        expect(logs).toContain('Priority');
        expect(logs).toContain('high');
    });

    it('should include all custom fields when fields=all is requested', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'md', filter: [], fields: 'all' });

        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe de Casos de Prueba');
        expect(logs).toContain('Priority');
        expect(logs).toContain('high');
    });

    it('should include custom fields by default in native reports when present in items', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return mockTestCases;
                    if (type === 'testrun') return mockTestRuns;
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'md', filter: [] });

        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe de Casos de Prueba');
        expect(logs).toContain('Priority');
        expect(logs).toContain('high');
    });

    it('should generate bidimensional matrix report', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return [
                        { identity: 'tc1', type: 'testcase', attributes: { title: 'T1', status: 'passed', custom_fields: { squad: 'Checkout', priority: 'high' } } },
                        { identity: 'tc2', type: 'testcase', attributes: { title: 'T2', status: 'failed', custom_fields: { squad: 'Checkout', priority: 'low' } } },
                        { identity: 'tc3', type: 'testcase', attributes: { title: 'T3', status: 'passed', custom_fields: { squad: 'Auth', priority: 'medium' } } }
                    ];
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'bidimensional', format: 'md', groupBy: 'squad', secondaryGroupBy: 'status' });
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe Bidimensional');
        expect(logs).toContain('Checkout');
        expect(logs).toContain('Auth');
        expect(logs).toContain('Passed');
        expect(logs).toContain('Failed');
        expect(logs).toContain('Total');
    });

    it('should generate manual-vs-automated report', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return [
                        { identity: 'tc1', type: 'testcase', attributes: { title: 'T1', status: 'passed', custom_fields: { module: 'cart', automate: 'yes' } } },
                        { identity: 'tc2', type: 'testcase', attributes: { title: 'T2', status: 'failed', custom_fields: { module: 'cart', automate: 'no' } } }
                    ];
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'manual-vs-automated', format: 'md', groupBy: 'module' });
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe Manual Vs Automatizado');
        expect(logs).toContain('cart');
        expect(logs).toContain('Manuales');
        expect(logs).toContain('Automatizados');
        expect(logs).toContain('50%');
    });

    it('should generate planned-vs-unplanned report', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return [
                        { identity: 'tc1', type: 'testcase', attributes: { title: 'T1', status: 'passed', custom_fields: { module: 'cart' } } },
                        { identity: 'tc2', type: 'testcase', attributes: { title: 'T2', status: 'unexecuted', custom_fields: { module: 'cart' } } }
                    ];
                    if (type === 'testrun') return [
                        { identity: 'tr1', type: 'testrun', attributes: { testcases: { tc1: 'passed' } } }
                    ];
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'planned-vs-unplanned', format: 'md', groupBy: 'module' });
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Informe Planeado Vs No Planeado');
        expect(logs).toContain('Planeados');
        expect(logs).toContain('No Planeados (Backlog)');
        expect(logs).toContain('50%');
    });

    it('should generate traceability report', async () => {
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn<any>().mockResolvedValue(undefined),
                getResources: (type: string) => {
                    if (type === 'testcase') return [
                        { identity: 'auth/login.case.feature.@tc-01', type: 'testcase', attributes: { title: 'Login with valid credentials', status: 'passed' } }
                    ];
                    if (type === 'testrun') return [
                        { identity: 'tr-1', type: 'testrun', attributes: { testcases: { 'auth/login.case.feature.@tc-01': 'passed' } } }
                    ];
                    return [];
                }
            };
        });

        await reportCmd({ dir: tmpDir, type: 'traceability', format: 'md' });
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('# Matriz de Trazabilidad de Pruebas (RTM)');
        expect(logs).toContain('auth/login.case.feature');
        expect(logs).toContain('tr-1');
        expect(logs).toContain('✅ passed');
    });

    it('should inject simulation signature and watermark when running from files', async () => {
        // Create local feature file in tmpDir
        writeFileSync(join(tmpDir, 'login.case.feature'), `
@testcase
Feature: User Login
  @tc-01 @high
  Scenario: Successful login
    * set status = passed
    * field module = Auth
    * field squad = Identity
    Given the user is on login page
`);

        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'md', fromFiles: true });
        const logs = mockLog.mock.calls.join('\n');
        expect(logs).toContain('AVISO DE SIMULACIÓN / DRY-RUN (DATA NO CONSOLIDADA EN STATE)');
        expect(logs).toContain('Firma de Verificación');
        expect(logs).toContain('testform.state');
        expect(logs).toContain('Successful login');
    });

    it('should include simulation signature in JSON and CSV outputs', async () => {
        writeFileSync(join(tmpDir, 'cart.case.feature'), `
@testcase
Feature: Shopping Cart
  @tc-01
  Scenario: Add item to cart
    * set status = passed
    * field module = Checkout
`);

        const jsonOut = join(tmpDir, 'report.json');
        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'json', fromFiles: true, out: 'report.json' });
        const jsonContent = JSON.parse(readFileSync(jsonOut, 'utf-8'));
        expect(jsonContent.metadata.is_state_verified).toBe(false);
        expect(jsonContent.metadata.signature).toContain('SIMULACIÓN');

        const csvOut = join(tmpDir, 'report.csv');
        await reportCmd({ dir: tmpDir, type: 'testcase-summary', format: 'csv', fromFiles: true, out: 'report.csv' });
        const csvContent = readFileSync(csvOut, 'utf-8');
        expect(csvContent).toContain('# ⚠️ AVISO: MODO SIMULACION / DRY-RUN');
    });
});
