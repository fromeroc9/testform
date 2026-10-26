import { IReportFormat, ReportContext, ReportData } from './types';
import { interpolateExpressions } from '../core/expressions/evaluator';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadDriver } from '../core/driver';
import { logger } from '../core/logger';

const STATUS_ICONS: Record<string, string> = {
    passed: '✅',
    failed: '❌',
    pending: '⏳',
    blocked: '⚠️',
    skipped: '⏭️',
    unexecuted: '❔'
};

// ── 1. Formato Markdown ───────────────────────────────────────────────────────
export const MarkdownFormat: IReportFormat = {
    name: 'markdown',
    extension: '.md',
    isBinary: false,
    render(data: ReportData, context: ReportContext, template?: string | Buffer): string {
        if (template) {
            const raw = typeof template === 'string' ? template : template.toString('utf-8');
            const evalCtx = {
                vars: context.variables,
                variables: context.variables,
                data: {
                    report: {
                        title: data.title,
                        metrics: data.metrics || {},
                        headers: data.headers,
                        rows: data.rows
                    }
                }
            };
            let res = interpolateExpressions(raw, evalCtx);
            res = res.replace(/\$\{report\.title\}/g, data.title);
            if (data.metrics) {
                for (const [k, v] of Object.entries(data.metrics)) {
                    res = res.replace(new RegExp(`\\$\\{report\\.metrics\\.${k}\\}`, 'g'), String(v));
                }
            }
            return res;
        }

        const lines: string[] = [];
        lines.push(`# ${data.title}`);
        lines.push('');

        // KPIs / Métricas
        if (data.metrics && Object.keys(data.metrics).length > 0) {
            const metricBadges = Object.entries(data.metrics)
                .map(([k, v]) => `**${k}:** \`${v}\``)
                .join(' | ');
            lines.push(metricBadges);
            lines.push('');
        }

        // Tabla
        if (data.headers.length > 0) {
            lines.push(`| ${data.headers.join(' | ')} |`);
            lines.push(`| ${data.headers.map(() => '---').join(' | ')} |`);

            for (const row of data.rows) {
                const formattedRow = row.map(cell => {
                    const str = String(cell);
                    const icon = STATUS_ICONS[str.toLowerCase()];
                    return icon ? `${icon} ${str}` : str;
                });
                lines.push(`| ${formattedRow.join(' | ')} |`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }
};

// ── 2. Formato JSON ───────────────────────────────────────────────────────────
export const JsonFormat: IReportFormat = {
    name: 'json',
    extension: '.json',
    isBinary: false,
    render(data: ReportData, context: ReportContext, template?: string | Buffer): string {
        if (template) {
            const raw = typeof template === 'string' ? template : template.toString('utf-8');
            return interpolateExpressions(raw, { vars: { ...context.variables, ...data.metrics } });
        }
        if (data.metadata?.rawItems) {
            return JSON.stringify(data.metadata.rawItems, null, 2);
        }
        return JSON.stringify({
            title: data.title,
            metrics: data.metrics || {},
            headers: data.headers,
            rows: data.rows,
            metadata: data.metadata || {}
        }, null, 2);
    }
};

// ── 3. Formato CSV ────────────────────────────────────────────────────────────
export const CsvFormat: IReportFormat = {
    name: 'csv',
    extension: '.csv',
    isBinary: false,
    render(data: ReportData): string {
        const lines: string[] = [];
        lines.push(data.headers.join(','));

        if (data.metadata?.rawItems) {
            for (const d of data.metadata.rawItems) {
                const row = [
                    d.id,
                    `"${(d.title || '').replace(/"/g, '""')}"`,
                    d.status,
                    `"${(d.labels || []).join(' ')}"`,
                    `"${(d.assignees || []).join(' ')}"`,
                    `"${d.milestone || ''}"`,
                    d.testRunId || '',
                    d.issueNumber || ''
                ];
                lines.push(row.join(','));
            }
            return lines.join('\n');
        }

        const escapeCsv = (val: any) => {
            const str = String(val ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes(' ') || str.startsWith('@')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        for (const row of data.rows) {
            lines.push(row.map(escapeCsv).join(','));
        }

        return lines.join('\n');
    }
};

// ── 4. Formato Word (DOCX) con Marcadores ${...} ─────────────────────────────
export const DocxFormat: IReportFormat = {
    name: 'docx',
    extension: '.docx',
    isBinary: true,
    async render(data: ReportData, context: ReportContext, template?: string | Buffer): Promise<Buffer> {
        let docx: any;
        try {
            docx = loadDriver('docx');
        } catch {
            logger.push({
                type: 'error',
                title: 'Missing optional package "docx"',
                detail: [
                    'The "docx" package is required to generate Word (.docx) reports.',
                    'Please install it globally or locally in your project:',
                    '',
                    '  npm install -g docx',
                    '  # or',
                    '  npm install --save-dev docx'
                ],
                close: true
            });
        }

        const {
            Document, Paragraph, Table, TableRow, TableCell,
            TextRun, HeadingLevel, WidthType, BorderStyle,
            VerticalAlign, PatchType, patchDocument, Packer, AlignmentType
        } = docx;

        let templateBuffer: Buffer | null = null;

        if (template) {
            if (typeof template === 'string') {
                if (!existsSync(template)) {
                    logger.push({
                        type: 'error',
                        title: `Template file not found: ${template}`,
                        detail: [
                            'The specified Word template path does not exist on disk.',
                            'Verify the path or omit the -template flag to use the default template.'
                        ],
                        close: true
                    });
                }
                templateBuffer = readFileSync(template);
            } else {
                templateBuffer = template;
            }
        } else {
            const candidatePaths = [
                resolve(process.cwd(), '.testform', 'reports', 'report.docx'),
                resolve(process.cwd(), 'templates', 'report.docx'),
                resolve(__dirname, '..', '..', 'templates', 'report.docx')
            ];
            for (const p of candidatePaths) {
                if (existsSync(p)) {
                    try {
                        templateBuffer = readFileSync(p);
                        break;
                    } catch {}
                }
            }
        }

        if (templateBuffer) {
            try {
                const patches: Record<string, any> = {};
                const vars = context.variables || {};
                const now = new Date();
                const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

                // Mapear variables dinámicas (${var.X} y ${X})
                for (const [k, v] of Object.entries(vars)) {
                    patches[k] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(v) })] };
                    patches[`var.${k}`] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(v) })] };
                }

                // Mapear métricas (${report.X}, ${report.metrics.X} y ${X})
                if (data.metrics) {
                    for (const [k, v] of Object.entries(data.metrics)) {
                        patches[k] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(v) })] };
                        patches[`report.${k}`] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(v) })] };
                        patches[`report.metrics.${k}`] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(v) })] };
                    }
                }

                // Marcadores comunes
                patches['title'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: data.title, bold: true })] };
                patches['report.title'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: data.title, bold: true })] };
                patches['date'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: dateStr })] };
                patches['total'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(data.metrics?.total || data.rows.length) })] };
                patches['report.total'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(data.metrics?.total || data.rows.length) })] };
                patches['passed'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(data.metrics?.passed || 0) })] };
                patches['report.passed'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(data.metrics?.passed || 0) })] };
                patches['failed'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(data.metrics?.failed || 0) })] };
                patches['report.failed'] = { type: PatchType.PARAGRAPH, children: [new TextRun({ text: String(data.metrics?.failed || 0) })] };

                // Generar tabla para ${table} o ${report.table}
                const tableRows = [
                    new TableRow({
                        children: data.headers.map(h => new TableCell({
                            verticalAlign: VerticalAlign.CENTER,
                            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })]
                        }))
                    }),
                    ...data.rows.map(row => new TableRow({
                        children: row.map(cell => new TableCell({
                            verticalAlign: VerticalAlign.CENTER,
                            children: [new Paragraph({ text: String(cell) })]
                        }))
                    }))
                ];

                const tablePatch = {
                    type: PatchType.DOCUMENT,
                    children: [
                        new Table({
                            width: { size: 9634, type: WidthType.DXA },
                            borders: {
                                top: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF" },
                                bottom: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF" },
                                left: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF" },
                                right: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF" },
                                insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF" },
                                insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF" }
                            },
                            rows: tableRows
                        })
                    ]
                };

                patches['table'] = tablePatch;
                patches['report.table'] = tablePatch;

                // 1. Intentar parcheo con marcadores ${...} (Estándar de Testform)
                try {
                    const patched = await patchDocument({
                        outputType: "nodebuffer",
                        data: templateBuffer,
                        patches,
                        placeholderDelimiters: {
                            start: "${",
                            end: "}"
                        }
                    });
                    return Buffer.from(patched);
                } catch {
                    // 2. Fallback a marcadores {{...}} para compatibilidad con plantillas heredadas
                    const patched = await patchDocument({
                        outputType: "nodebuffer",
                        data: templateBuffer,
                        patches
                    });
                    return Buffer.from(patched);
                }
            } catch (err) {
                // Fallback a generación directa si falla el parcheo
            }
        }

        // Generación directa de Word si no hay plantilla o falló el parche
        const doc = new Document({
            sections: [{
                children: [
                    new Paragraph({
                        text: data.title,
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER
                    }),
                    new Paragraph({
                        text: `Fecha: ${new Date().toLocaleDateString()}`,
                        alignment: AlignmentType.CENTER
                    }),
                    new Paragraph({ text: '' }),
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [
                            new TableRow({
                                children: data.headers.map(h => new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })]
                                }))
                            }),
                            ...data.rows.map(row => new TableRow({
                                children: row.map(cell => new TableCell({
                                    children: [new Paragraph({ text: String(cell) })]
                                }))
                            }))
                        ]
                    })
                ]
            }]
        });

        return await Packer.toBuffer(doc);
    }
};

// ── 5. Formato Excel (XLSX) con Marcadores ${...} ─────────────────────────────
export const XlsxFormat: IReportFormat = {
    name: 'xlsx',
    extension: '.xlsx',
    isBinary: true,
    async render(data: ReportData, context: ReportContext, template?: string | Buffer): Promise<Buffer> {
        let exceljs: any;
        try {
            exceljs = loadDriver('exceljs');
        } catch {
            logger.push({
                type: 'error',
                title: 'Missing optional package "exceljs"',
                detail: [
                    'The "exceljs" package is required to generate Excel (.xlsx) reports.',
                    'Please install it globally or locally in your project:',
                    '',
                    '  npm install -g exceljs',
                    '  # or',
                    '  npm install --save-dev exceljs'
                ],
                close: true
            });
        }

        const WorkbookClass = exceljs.Workbook || exceljs.default?.Workbook || exceljs.default;
        const workbook = new WorkbookClass();
        let worksheet: any;
        const now = new Date();
        const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
        const vars = context.variables || {};

        if (template) {
            let buffer: Buffer;
            if (typeof template === 'string') {
                if (!existsSync(template)) {
                    logger.push({
                        type: 'error',
                        title: `Template file not found: ${template}`,
                        detail: [
                            'The specified Excel template path does not exist on disk.',
                            'Verify the path or omit the -template flag to generate a standard workbook.'
                        ],
                        close: true
                    });
                }
                buffer = readFileSync(template);
            } else {
                buffer = template;
            }
            await workbook.xlsx.load(buffer as any);
            worksheet = workbook.worksheets[0];
        } else {
            worksheet = workbook.addWorksheet(data.title.slice(0, 31) || 'Report');
        }

        // Interpolador de marcadores ${...} en celdas de Excel
        const interpolateCell = (val: string): string => {
            let res = val;
            res = res.replace(/\$\{date\}/g, dateStr);
            res = res.replace(/\$\{report\.title\}/g, data.title);
            res = res.replace(/\$\{title\}/g, data.title);
            if (data.metrics) {
                for (const [k, v] of Object.entries(data.metrics)) {
                    res = res.replace(new RegExp(`\\$\\{report\\.metrics\\.${k}\\}`, 'g'), String(v));
                    res = res.replace(new RegExp(`\\$\\{report\\.${k}\\}`, 'g'), String(v));
                    res = res.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v));
                }
            }
            for (const [k, v] of Object.entries(vars)) {
                res = res.replace(new RegExp(`\\$\\{var\\.${k}\\}`, 'g'), String(v));
                res = res.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v));
            }
            return res;
        };

        // Escaneo de celdas para interpolar ${...} y detectar marcador ${table}
        let tableAnchor: { row: number; col: number } | null = null;

        worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
            row.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
                if (typeof cell.value === 'string') {
                    if (cell.value.includes('${table}') || cell.value.includes('${report.table}')) {
                        tableAnchor = { row: rowNumber, col: colNumber };
                        cell.value = '';
                    } else if (cell.value.includes('${')) {
                        cell.value = interpolateCell(cell.value);
                    }
                }
            });
        });

        // Ubicación de inserción de la tabla de datos
        const anchor = tableAnchor as { row: number; col: number } | null;
        const startRow = anchor ? anchor.row : (worksheet.lastRow ? worksheet.lastRow.number + 2 : 1);
        const startCol = anchor ? anchor.col : 1;

        // Fila de encabezado
        const headerRow = worksheet.getRow(startRow);
        data.headers.forEach((h, idx) => {
            const cell = headerRow.getCell(startCol + idx);
            cell.value = h;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F4E79' }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        headerRow.height = 24;

        // Filas de datos
        let currentRowNum = startRow + 1;
        for (const row of data.rows) {
            const rowObj = worksheet.getRow(currentRowNum);
            row.forEach((val, idx) => {
                const cell = rowObj.getCell(startCol + idx);
                cell.value = val;
                cell.alignment = { vertical: 'middle' };

                // Colorización condicional de estados
                const strVal = String(val).toLowerCase();
                if (strVal === 'passed') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
                    cell.font = { color: { argb: 'FF155724' }, bold: true };
                } else if (strVal === 'failed') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
                    cell.font = { color: { argb: 'FF721C24' }, bold: true };
                } else if (strVal === 'blocked') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
                    cell.font = { color: { argb: 'FF856404' }, bold: true };
                }
            });
            currentRowNum++;
        }

        // Ajustar ancho de columnas automáticamente
        data.headers.forEach((h, colIdx) => {
            const col = worksheet.getColumn(startCol + colIdx);
            let maxLen = h.length;
            for (const r of data.rows) {
                const cellLen = String(r[colIdx] ?? '').length;
                if (cellLen > maxLen) maxLen = cellLen;
            }
            col.width = Math.min(Math.max(maxLen + 4, 12), 45);
        });

        const buf = await workbook.xlsx.writeBuffer();
        return Buffer.from(buf);
    }
};

export const coreFormats: Record<string, IReportFormat> = {
    markdown: MarkdownFormat,
    md: MarkdownFormat,
    json: JsonFormat,
    csv: CsvFormat,
    docx: DocxFormat,
    xlsx: XlsxFormat
};
