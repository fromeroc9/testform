import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reportCmd } from '../src/commands/report';
import { State } from '../src/core/state';
import { resolveReport, resolveFormat } from '../src/reports/loader';
import { builtinReports } from '../src/reports/catalog';
import { coreFormats, DocxFormat, XlsxFormat } from '../src/reports/formats';
import { logger } from '../src/core/logger';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

vi.mock('../src/core/state');

describe('Modular Reports & Formats Engine', () => {
    let tmpDir: string;

    const mockResources = [
        {
            identity: 'auth/login.case.feature.@tc-1',
            type: 'github_testcase',
            attributes: {
                title: 'Valid Login',
                labels: ['@smoke', '@auth'],
                assignees: ['flavio'],
                milestone: 'Sprint 1',
                custom_fields: { priority: 'high', sprint: 'SP1', automation: 'true' }
            }
        },
        {
            identity: 'auth/login.case.feature.@tc-2',
            type: 'github_testcase',
            attributes: {
                title: 'Invalid Password',
                labels: ['@auth'],
                assignees: ['dev1'],
                milestone: 'Sprint 1',
                custom_fields: { priority: 'medium', sprint: 'SP1', automation: 'false' }
            }
        },
        {
            identity: 'checkout/cart.case.feature.@tc-3',
            type: 'github_testcase',
            attributes: {
                title: 'Add to Cart',
                labels: ['@smoke'],
                assignees: ['dev2'],
                milestone: 'Sprint 2',
                custom_fields: { priority: 'low', sprint: 'SP2', automation: 'true' }
            }
        },
        {
            identity: 'run-sprint-1',
            type: 'github_testrun',
            attributes: {
                title: 'Regression Run 1',
                state: 'closed',
                testcaseStatuses: {
                    'auth/login.case.feature.@tc-1': 'passed',
                    'auth/login.case.feature.@tc-2': 'failed'
                }
            }
        },
        {
            identity: 'run-sprint-2',
            type: 'github_testrun',
            attributes: {
                title: 'Checkout Run 2',
                state: 'open',
                testcaseStatuses: {
                    'checkout/cart.case.feature.@tc-3': 'passed'
                }
            }
        },
        {
            identity: 'plan-q1',
            type: 'github_testplan',
            attributes: {
                title: 'Q1 Test Plan',
                testruns: ['run-sprint-1']
            }
        },
        {
            identity: 'plan-q2',
            type: 'github_testplan',
            attributes: {
                title: 'Q2 Test Plan',
                testruns: ['run-sprint-2']
            }
        }
    ];

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-modular-test-'));
        writeFileSync(join(tmpDir, 'testform.yml'), 'version: "1.0"\nprovider: local\nbackend: local\n');
        (State as any).mockImplementation(function() {
            return {
                init: vi.fn().mockResolvedValue(undefined),
                getState: () => ({ resources: mockResources }),
                getResources: () => mockResources
            };
        });
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── 1. Verificar los 9 reportes del core ──────────────────────────────────
    it('should have all 9 built-in reports in catalog', () => {
        const expected = [
            'testcase-summary',
            'testrun-summary',
            'testrun-detailed',
            'testplan-summary',
            'defects',
            'traceability',
            'coverage',
            'two-dimensional',
            'test-case-activity',
            'raw'
        ];
        for (const name of expected) {
            expect(builtinReports[name]).toBeDefined();
            expect(typeof builtinReports[name].collect).toBe('function');
        }
    });

    // ── 2. Inferencia automática de búsqueda textual en -filter ───────────────
    it('should infer free-text search when filter has no "="', async () => {
        const outPath = join(tmpDir, 'search-out.json');
        await reportCmd({
            dir: tmpDir,
            type: 'testcase-summary',
            format: 'json',
            filter: 'Invalid',
            out: outPath
        });

        const res = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0][1]).toBe('Invalid Password');
    });

    // ── 3. Filtrado por clave=valor (atributos base y custom fields) ──────────
    it('should filter by custom fields (priority=high)', async () => {
        const outPath = join(tmpDir, 'priority-out.json');
        await reportCmd({
            dir: tmpDir,
            type: 'testcase-summary',
            format: 'json',
            filter: 'priority=high',
            out: outPath
        });

        const res = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0][0]).toBe('auth/login.case.feature.@tc-1');
    });

    // ── 4. Formatos binarios: DOCX y XLSX ─────────────────────────────────────
    it('should generate valid Word (.docx) document buffer', async () => {
        const outDocx = join(tmpDir, 'output.docx');
        await reportCmd({
            dir: tmpDir,
            type: 'testcase-summary',
            format: 'docx',
            out: outDocx
        });

        expect(existsSync(outDocx)).toBe(true);
        const buf = readFileSync(outDocx);
        expect(buf.length).toBeGreaterThan(100);
        // PK zip header for docx
        expect(buf[0]).toBe(0x50);
        expect(buf[1]).toBe(0x4b);
    });

    it('should generate valid Excel (.xlsx) workbook buffer', async () => {
        const outXlsx = join(tmpDir, 'output.xlsx');
        await reportCmd({
            dir: tmpDir,
            type: 'traceability',
            format: 'xlsx',
            out: outXlsx
        });

        expect(existsSync(outXlsx)).toBe(true);
        const buf = readFileSync(outXlsx);
        expect(buf.length).toBeGreaterThan(100);
        // PK zip header for xlsx
        expect(buf[0]).toBe(0x50);
        expect(buf[1]).toBe(0x4b);
    });

    it('should interpolate ${var.*} and ${report.*} in Excel (.xlsx) template cells', async () => {
        const { Workbook } = await import('exceljs');
        const tplWb = new Workbook();
        const ws = tplWb.addWorksheet('Sheet1');
        ws.getCell('A1').value = 'Empresa: ${var.company}';
        ws.getCell('A2').value = 'Reporte: ${report.title}';
        ws.getCell('A4').value = '${table}';
        const tplPath = join(tmpDir, 'template.xlsx');
        await tplWb.xlsx.writeFile(tplPath);

        const outXlsx = join(tmpDir, 'interpolated.xlsx');
        await reportCmd({
            dir: tmpDir,
            type: 'testcase-summary',
            format: 'xlsx',
            template: tplPath,
            out: outXlsx
        });

        const resWb = new Workbook();
        await resWb.xlsx.readFile(outXlsx);
        const resWs = resWb.worksheets[0];
        expect(resWs.getCell('A1').value).toContain('Empresa:');
        expect(resWs.getCell('A2').value).toContain('Reporte: Informe de Casos de Prueba');
        // Table should be inserted starting around row 4
        expect(resWs.getCell('A4').value).toBe('ID');
    });

    // ── 5. Interpolación de variables en plantillas de texto ──────────────────
    it('should interpolate vars in text templates', () => {
        const template = 'Report: ${report.title} | Empresa: ${var.company} | Total: ${report.metrics.total}';
        const rendered = coreFormats.markdown.render(
            {
                title: 'Pruebas Q1',
                headers: ['ID'],
                rows: [['1']],
                metrics: { total: 42 }
            },
            {
                items: [],
                stats: {} as any,
                variables: { company: 'Caja Arequipa' },
                options: {},
                stateQuery: {} as any
            },
            template
        );

        expect(rendered).toBe('Report: Pruebas Q1 | Empresa: Caja Arequipa | Total: 42');
    });

    // ── 6. Autocarga de reporte custom desde .testform/reports/ ────────────────
    it('should autoload custom report from .testform/reports/ without modifying main.yml', async () => {
        const reportsDir = join(tmpDir, '.testform', 'reports');
        mkdirSync(reportsDir, { recursive: true });

        const customReportCode = `
module.exports = {
    name: 'custom-sprint',
    collect(ctx) {
        return {
            title: 'Custom Sprint KPI',
            metrics: { kpi_ok: 100 },
            headers: ['CustomID', 'CustomVal'],
            rows: [['C01', 'Success']]
        };
    }
};
`;
        writeFileSync(join(reportsDir, 'custom-sprint.js'), customReportCode, 'utf8');

        const resolved = await resolveReport('custom-sprint', tmpDir);
        expect(resolved.name).toBe('custom-sprint');

        const outPath = join(tmpDir, 'custom-out.json');
        await reportCmd({
            dir: tmpDir,
            type: 'custom-sprint',
            format: 'json',
            out: outPath
        });

        const data = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(data.title).toBe('Custom Sprint KPI');
        expect(data.rows[0][0]).toBe('C01');
    });

    // ── 7. Autocarga de formato custom global (.testform/reports/*.format.js) ──
    it('should autoload custom global format from .testform/reports/', async () => {
        const reportsDir = join(tmpDir, '.testform', 'reports');
        mkdirSync(reportsDir, { recursive: true });

        const customFormatCode = `
module.exports = {
    name: 'customxml',
    extension: '.xml',
    render(data) {
        return '<xml><title>' + data.title + '</title></xml>';
    }
};
`;
        writeFileSync(join(reportsDir, 'customxml.format.js'), customFormatCode, 'utf8');

        const outPath = join(tmpDir, 'output.xml');
        await reportCmd({
            dir: tmpDir,
            type: 'testcase-summary',
            format: 'customxml',
            out: outPath
        });

        const xmlContent = readFileSync(outPath, 'utf8');
        expect(xmlContent).toBe('<xml><title>Informe de Casos de Prueba</title></xml>');
    });

    // ── 8. Filtrado por Target (Testrun específico) ──────────────────────────
    it('should scope report to a single testrun when -target is specified', async () => {
        const outPath = join(tmpDir, 'target-run.json');
        await reportCmd({
            dir: tmpDir,
            type: 'testrun-detailed',
            format: 'json',
            target: 'run-sprint-1',
            out: outPath
        });

        const data = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(data.title).toBe('Test Run Detailed Report');
        // Only run-sprint-1 items (tc-1 and tc-2), not tc-3 from run-sprint-2
        expect(data.rows.length).toBe(2);
        expect(data.rows.every((r: any[]) => r[0] === 'run-sprint-1')).toBe(true);
    });

    // ── 9. Filtrado por Target (Testplan con múltiples corridas) ─────────────
    it('should scope report to a testplan and expand its linked testruns when -target is specified', async () => {
        const outPath = join(tmpDir, 'target-plan.json');
        await reportCmd({
            dir: tmpDir,
            type: 'testrun-summary',
            format: 'json',
            target: 'plan-q1',
            out: outPath
        });

        const data = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(data.title).toBe('Test Run Summary');
        // Only run-sprint-1 is linked in plan-q1
        expect(data.rows.length).toBe(1);
        expect(data.rows[0][0]).toBe('run-sprint-1');
        expect(data.metrics['Total Test Runs']).toBe(1);
    });

    // ── 10. Diagnósticos estilo Terraform en errores de Reportes y Formatos ────
    it('should format unknown report error using Terraform diagnostic convention', async () => {
        const pushSpy = vi.spyOn(logger, 'push');
        await reportCmd({
            dir: tmpDir,
            type: 'non-existent-report',
            format: 'json'
        });

        expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            title: expect.stringContaining('not found')
        }));
        expect(process.exitCode).toBe(1);
    });

    it('should format unknown format error using Terraform diagnostic convention', async () => {
        const pushSpy = vi.spyOn(logger, 'push');
        await reportCmd({
            dir: tmpDir,
            type: 'testcase-summary',
            format: 'non-existent-format'
        });

        expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            title: expect.stringContaining('not found')
        }));
        expect(process.exitCode).toBe(1);
    });

    it('should format missing template file error using Terraform diagnostic convention', async () => {
        const pushSpy = vi.spyOn(logger, 'push');
        await reportCmd({
            dir: tmpDir,
            type: 'testcase-summary',
            format: 'docx',
            template: 'non-existent-template.docx'
        });

        expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            title: expect.stringContaining('Template file not found'),
            close: true
        }));
        expect(process.exitCode).toBe(1);
    });
});
