import { IReport, ReportContext, ReportData } from './types';
import { QueryResultItem, resolveItemFieldValue } from '../core/query';
import { resolvePath, calculateRollupVerdict } from '../core/utils';

function resolveItemUrl(d: QueryResultItem): string | undefined {
    const attrs = (d.originalResource?.attributes || {}) as Record<string, any>;
    if (attrs.html_url) return String(attrs.html_url);
    if (attrs.url) return String(attrs.url);
    if (d.issueNumber && d.type.includes('github')) {
        return `https://github.com/issues/${d.issueNumber}`;
    }
    return undefined;
}

export function formatHeaderTitle(field: string): string {
    return (field || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

export function enrichWithCustomFields(
    data: ReportData,
    items: QueryResultItem[],
    requestedFields?: string[]
): ReportData {
    if (items.length === 0 || (data.rows.length === 1 && items.length === 0)) {
        return data;
    }

    if (requestedFields && requestedFields.some(f => f.toLowerCase() === 'none' || f.toLowerCase() === 'false')) {
        return data;
    }

    let fieldsToInclude: string[] = [];
    if (!requestedFields || requestedFields.length === 0 || requestedFields.includes('all') || requestedFields.includes('*')) {
        const fieldSet = new Set<string>();
        for (const it of items) {
            if (it.custom_fields) {
                for (const k of Object.keys(it.custom_fields)) {
                    if (k) fieldSet.add(k);
                }
            }
            const rawAttrs = (it.originalResource?.attributes || {}) as Record<string, any>;
            const rawFields = rawAttrs.custom_fields || rawAttrs.fields || {};
            if (typeof rawFields === 'object') {
                for (const k of Object.keys(rawFields)) {
                    if (k) fieldSet.add(k);
                }
            }
        }
        fieldsToInclude = Array.from(fieldSet);
    } else {
        fieldsToInclude = requestedFields;
    }

    if (fieldsToInclude.length === 0) return data;

    const existingHeadersLower = new Set(data.headers.map(h => h.toLowerCase()));
    const finalFields = fieldsToInclude.filter(f => !existingHeadersLower.has(f.toLowerCase()));
    if (finalFields.length === 0) return data;

    const newHeaders = [...data.headers, ...finalFields.map(f => formatHeaderTitle(f))];
    const newRows = data.rows.map((row, idx) => {
        const item = items[idx];
        if (!item) return row;
        const extraCells = finalFields.map(f => {
            const lowerF = f.toLowerCase();
            const val = item.custom_fields?.[lowerF]
                ?? item.custom_fields?.[f]
                ?? resolvePath(item.originalResource, `attributes.custom_fields.${lowerF}`)
                ?? resolvePath(item.originalResource, `attributes.custom_fields.${f}`)
                ?? resolvePath(item.originalResource, `attributes.fields.${lowerF}`)
                ?? resolvePath(item.originalResource, `attributes.fields.${f}`)
                ?? resolvePath(item.originalResource, `attributes.${lowerF}`)
                ?? resolvePath(item.originalResource, `attributes.${f}`)
                ?? resolvePath(item.originalResource, f)
                ?? '-';
            return String(val);
        });
        return [...row, ...extraCells];
    });

    return {
        ...data,
        headers: newHeaders,
        rows: newRows
    };
}

export const builtinReports: Record<string, IReport> = {
    // ── 1. Resumen de Casos de Prueba ─────────────────────────────────────────
    'testcase-summary': {
        name: 'testcase-summary',
        description: 'Test case execution status and overview',
        collect(ctx: ReportContext): ReportData {
            const tcItems = ctx.items.filter(it => it.canonicalScope === 'testcase');
            const items = tcItems.length > 0 ? tcItems : ctx.items;

            const resData: ReportData = {
                title: 'Informe de Casos de Prueba',
                metrics: {
                    total: ctx.stats.total,
                    passed: ctx.stats.passed,
                    failed: ctx.stats.failed,
                    pending: ctx.stats.pending,
                    blocked: ctx.stats.blocked,
                    skipped: ctx.stats.skipped,
                    undefined: ctx.stats.undefined,
                    ambiguous: ctx.stats.ambiguous,
                    unexecuted: ctx.stats.unexecuted,
                    tasa_exito: ctx.stats.total > 0 ? `${Math.round((ctx.stats.passed / ctx.stats.total) * 100)}%` : '0%'
                },
                headers: ['ID', 'Título', 'Etiquetas', 'Estado', 'Asignado'],
                rows: items.map(d => [
                    d.id,
                    d.title,
                    d.labels.join(', ') || '-',
                    d.status,
                    d.assignees[0] || '-'
                ])
            };

            return enrichWithCustomFields(resData, items, ctx.fields);
        }
    },

    // ── 2. Resumen de Ejecuciones (Test Runs) ─────────────────────────────────
    'testrun-summary': {
        name: 'testrun-summary',
        description: 'Summary of test runs and execution metrics',
        collect(ctx: ReportContext): ReportData {
            const runGroups = ctx.stateQuery.group(ctx.items.filter(i => i.testRunId), 'testrun');
            const rows: (string | number)[][] = [];

            for (const [runId, runItems] of Object.entries(runGroups)) {
                if (runId === 'none') continue;
                const rStats = ctx.stateQuery.getStats(runItems);
                const rollup = calculateRollupVerdict(runItems.map(i => i.status));
                const verdictLabel = rollup.charAt(0).toUpperCase() + rollup.slice(1);
                rows.push([
                    runId,
                    runItems.length,
                    rStats.passed,
                    rStats.failed,
                    rStats.blocked,
                    verdictLabel
                ]);
            }

            return {
                title: 'Test Run Summary',
                metrics: {
                    'Total Test Runs': ctx.stats.totalRuns,
                    active_runs: ctx.stats.activeRuns,
                    closed_runs: ctx.stats.closedRuns,
                    total_cases: ctx.stats.total,
                    passed: ctx.stats.passed,
                    failed: ctx.stats.failed
                },
                headers: ['Test Run', 'Total Casos', 'Passed', 'Failed', 'Blocked', 'Estado'],
                rows: rows.length > 0 ? rows : [['Sin ejecuciones', 0, 0, 0, 0, '-']]
            };
        }
    },

    // ── 3. Detalle de Ejecución de Corridas ───────────────────────────────────
    'testrun-detailed': {
        name: 'testrun-detailed',
        description: 'Detailed test cases and priorities per test run',
        collect(ctx: ReportContext): ReportData {
            const executed = ctx.items.filter(i => i.canonicalScope === 'testcase' && i.testRunId);
            const items = executed.length > 0 ? executed : ctx.items.filter(i => i.canonicalScope === 'testcase');

            const resData: ReportData = {
                title: 'Test Run Detailed Report',
                metrics: {
                    total_runs: ctx.stats.totalRuns,
                    total_cases: items.length,
                    passed: ctx.stats.passed,
                    failed: ctx.stats.failed
                },
                headers: ['Test Run', 'Test Case ID', 'Título', 'Estado', 'Prioridad', 'Asignado'],
                rows: items.map(d => {
                    const priority = d.custom_fields['priority'] || resolvePath(d.originalResource, 'attributes.custom_fields.priority') || 'Medium';
                    return [
                        d.testRunId || 'General',
                        d.id,
                        d.title,
                        d.status,
                        String(priority).replace('@', ''),
                        d.assignees[0] || '-'
                    ];
                })
            };

            return enrichWithCustomFields(resData, items, ctx.fields);
        }
    },

    // ── 4. Resumen de Planes de Prueba ────────────────────────────────────────
    'testplan-summary': {
        name: 'testplan-summary',
        description: 'Progress and metrics across test plans',
        collect(ctx: ReportContext): ReportData {
            const allPlans = ctx.stateQuery.getResources().filter(r => r.type.includes('testplan'));
            const planItems = ctx.items.filter(i => i.canonicalScope === 'testplan');
            const targetPlanIds = new Set(planItems.map(p => p.id));
            const plans = targetPlanIds.size > 0
                ? allPlans.filter(p => targetPlanIds.has(p.address || (p as any).identity))
                : allPlans;
            const rows: (string | number)[][] = [];

            for (const plan of plans) {
                const linkedRuns = (plan.attributes.testruns as string[]) || [];
                const planItems = ctx.items.filter(it => it.testRunId && linkedRuns.some(r => it.testRunId!.endsWith(r)));
                const pStats = ctx.stateQuery.getStats(planItems);
                const pct = planItems.length > 0 ? Math.round((pStats.passed / planItems.length) * 100) : 0;

                rows.push([
                    plan.address || (plan as any).identity,
                    String(plan.attributes.title || plan.address || (plan as any).identity),
                    linkedRuns.length,
                    planItems.length,
                    pStats.passed,
                    pStats.failed,
                    `${pct}%`
                ]);
            }

            return {
                title: 'Test Plan Summary',
                metrics: {
                    total_plans: ctx.stats.totalPlans,
                    total_cases: ctx.stats.total,
                    passed: ctx.stats.passed,
                    failed: ctx.stats.failed
                },
                headers: ['Plan ID', 'Título', 'Runs Vinculados', 'Casos', 'Passed', 'Failed', 'Progreso %'],
                rows: rows.length > 0 ? rows : [['Sin planes', '-', 0, 0, 0, 0, '0%']]
            };
        }
    },

    // ── 5. Informe de Defectos y Discrepancias ─────────────────────────────────
    'defects': {
        name: 'defects',
        description: 'Failed or blocked test cases and defect specifications with severity, priority, and remote issue tracking references',
        collect(ctx: ReportContext): ReportData {
            const failures = ctx.items.filter(d => ['failed', 'blocked'].includes(d.status.toLowerCase()) || d.canonicalScope === 'bug');

            const resData: ReportData = {
                title: 'Informe de Defectos y Discrepancias',
                metrics: {
                    total_defectos: failures.length,
                    criticos_o_mayores: failures.filter(f => {
                        const sev = String(f.custom_fields['severity'] || resolvePath(f.originalResource, 'attributes.custom_fields.severity') || '').toLowerCase();
                        return sev.includes('crit') || sev.includes('maj');
                    }).length,
                    fallidos: failures.filter(f => f.status.toLowerCase() === 'failed').length,
                    bloqueados: failures.filter(f => f.status.toLowerCase() === 'blocked').length,
                    abiertos: failures.filter(f => ['open', 'in_progress', 'todo'].includes(f.status.toLowerCase())).length
                },
                headers: ['Ref / Defecto', 'Título', 'Severidad', 'Prioridad', 'Estado', 'Run / Caso Afectado', 'Issue', 'Asignado'],
                rows: failures.length > 0
                    ? failures.map(d => {
                        const url = resolveItemUrl(d);
                        const issueCell = d.issueNumber
                            ? (url ? `[#${d.issueNumber}](${url})` : `#${d.issueNumber}`)
                            : (d.remoteId && !d.remoteId.startsWith('local:') && !d.remoteId.startsWith('sim:') ? d.remoteId : '-');
                        const sev = d.custom_fields['severity'] || resolvePath(d.originalResource, 'attributes.custom_fields.severity') || '-';
                        const pri = d.custom_fields['priority'] || resolvePath(d.originalResource, 'attributes.custom_fields.priority') || 'Medium';
                        const targetOrRun = d.testRunId || d.custom_fields['target'] || '-';
                        return [
                            d.id,
                            d.title,
                            String(sev).replace('@', ''),
                            String(pri).replace('@', ''),
                            d.status,
                            targetOrRun,
                            issueCell,
                            d.assignees[0] || '-'
                        ];
                    })
                    : [['-', 'Sin defectos', '-', '-', 'Passed', '-', '-', '-']]
            };

            if (failures.length === 0) return resData;
            return enrichWithCustomFields(resData, failures, ctx.fields);
        }
    },

    // ── 6. Informe Bidimensional (2D Pivot Matrix) ───────────────────────────
    'bidimensional': {
        name: 'bidimensional',
        description: 'Multi-dimensional pivot matrix with customizable primary and secondary grouping (e.g. Squad vs Status, Module vs Priority)',
        collect(ctx: ReportContext): ReportData {
            const tcItems = ctx.items.filter(it => it.canonicalScope === 'testcase');
            const items = tcItems.length > 0 ? tcItems : ctx.items;

            const primaryDim = ctx.groupBy || (items.some(i => i.custom_fields['squad']) ? 'squad' : (items.some(i => i.custom_fields['module']) ? 'module' : 'labels'));
            const secondaryDim = ctx.secondaryGroupBy || ctx.options.secondaryGroupBy || 'status';

            // Collect distinct values
            const matrix: Record<string, Record<string, number>> = {};
            const colValSet = new Set<string>();

            for (const item of items) {
                const rVal = resolveItemFieldValue(item, primaryDim);
                const cVal = resolveItemFieldValue(item, secondaryDim);

                colValSet.add(cVal);
                if (!matrix[rVal]) matrix[rVal] = {};
                matrix[rVal][cVal] = (matrix[rVal][cVal] || 0) + 1;
            }

            const rowKeys = Object.keys(matrix).sort((a, b) => a.localeCompare(b));

            // Sort column headers
            let colKeys: string[] = [];
            if (secondaryDim.toLowerCase() === 'status') {
                const standardOrder = ['passed', 'failed', 'pending', 'blocked', 'skipped', 'undefined', 'ambiguous', 'unexecuted'];
                colKeys = Array.from(colValSet).sort((a, b) => {
                    const idxA = standardOrder.indexOf(a.toLowerCase());
                    const idxB = standardOrder.indexOf(b.toLowerCase());
                    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                    if (idxA !== -1) return -1;
                    if (idxB !== -1) return 1;
                    return a.localeCompare(b);
                });
            } else if (secondaryDim.toLowerCase() === 'priority') {
                const standardOrder = ['critical', 'high', 'medium', 'low'];
                colKeys = Array.from(colValSet).sort((a, b) => {
                    const idxA = standardOrder.indexOf(a.toLowerCase());
                    const idxB = standardOrder.indexOf(b.toLowerCase());
                    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                    return a.localeCompare(b);
                });
            } else {
                colKeys = Array.from(colValSet).sort((a, b) => a.localeCompare(b));
            }

            if (colKeys.length === 0) colKeys = ['unexecuted'];

            const headers = [
                formatHeaderTitle(primaryDim),
                ...colKeys.map(k => formatHeaderTitle(k)),
                'Total'
            ];

            const colTotals: Record<string, number> = {};
            for (const k of colKeys) colTotals[k] = 0;
            let grandTotal = 0;

            const rows: (string | number)[][] = [];

            for (const rKey of rowKeys) {
                let rowTotal = 0;
                const rowCells: (string | number)[] = [rKey];

                for (const cKey of colKeys) {
                    const count = matrix[rKey][cKey] || 0;
                    rowCells.push(count);
                    rowTotal += count;
                    colTotals[cKey] = (colTotals[cKey] || 0) + count;
                }

                rowCells.push(rowTotal);
                grandTotal += rowTotal;
                rows.push(rowCells);
            }

            // Summary total row
            if (rows.length > 0) {
                const totalRow: (string | number)[] = ['Total'];
                for (const cKey of colKeys) {
                    totalRow.push(colTotals[cKey] || 0);
                }
                totalRow.push(grandTotal);
                rows.push(totalRow);
            } else {
                rows.push(['Sin datos', ...colKeys.map(() => 0), 0]);
            }

            const passedCount = colTotals['passed'] || 0;
            const passRate = grandTotal > 0 ? `${Math.round((passedCount / grandTotal) * 100)}%` : '0%';

            return {
                title: 'Informe Bidimensional',
                metrics: {
                    agrupado_por_principal: formatHeaderTitle(primaryDim),
                    agrupado_por_secundario: formatHeaderTitle(secondaryDim),
                    total_filas: rowKeys.length,
                    total_columnas: colKeys.length,
                    total_general: grandTotal,
                    ...(secondaryDim.toLowerCase() === 'status' ? { tasa_exito: passRate } : {})
                },
                headers,
                rows
            };
        }
    },

    // ── 7. Manual Vs Automatizado ─────────────────────────────────────────────
    'manual-vs-automated': {
        name: 'manual-vs-automated',
        description: 'Comparative breakdown of manual vs automated test cases and pass rates per module or squad',
        collect(ctx: ReportContext): ReportData {
            const tcItems = ctx.items.filter(it => it.canonicalScope === 'testcase');
            const items = tcItems.length > 0 ? tcItems : ctx.items;

            const groupField = ctx.groupBy || (items.some(i => i.custom_fields['squad']) ? 'squad' : 'module');
            const groups = ctx.stateQuery.group(items, groupField);

            let globalTotal = 0;
            let globalAuto = 0;
            let globalManual = 0;
            let globalAutoPassed = 0;
            let globalAutoFailed = 0;
            let globalManualPassed = 0;
            let globalManualFailed = 0;

            const rows: (string | number)[][] = [];

            for (const [gName, gItems] of Object.entries(groups)) {
                let autoCount = 0;
                let autoPassed = 0;
                let autoFailed = 0;
                let manPassed = 0;
                let manFailed = 0;

                for (const it of gItems) {
                    const autoVal = String(
                        it.custom_fields['automate'] ||
                        it.custom_fields['automation'] ||
                        resolvePath(it.originalResource, 'attributes.custom_fields.automate') ||
                        resolvePath(it.originalResource, 'attributes.custom_fields.automation') ||
                        ''
                    ).toLowerCase();

                    const isAuto = autoVal === 'yes' || autoVal === 'true' || autoVal === 'automated' || it.labels.some(l => l.toLowerCase() === 'automated' || l.toLowerCase() === '@automated');
                    const st = it.status.toLowerCase();

                    if (isAuto) {
                        autoCount++;
                        if (st === 'passed') autoPassed++;
                        if (st === 'failed') autoFailed++;
                    } else {
                        if (st === 'passed') manPassed++;
                        if (st === 'failed') manFailed++;
                    }
                }

                const total = gItems.length;
                const manCount = total - autoCount;
                const autoRate = total > 0 ? `${Math.round((autoCount / total) * 100)}%` : '0%';

                globalTotal += total;
                globalAuto += autoCount;
                globalManual += manCount;
                globalAutoPassed += autoPassed;
                globalAutoFailed += autoFailed;
                globalManualPassed += manPassed;
                globalManualFailed += manFailed;

                rows.push([
                    gName,
                    total,
                    manCount,
                    autoCount,
                    autoRate,
                    autoPassed,
                    autoFailed,
                    manPassed,
                    manFailed
                ]);
            }

            if (rows.length > 0) {
                const overallPct = globalTotal > 0 ? `${Math.round((globalAuto / globalTotal) * 100)}%` : '0%';
                rows.push([
                    'Total',
                    globalTotal,
                    globalManual,
                    globalAuto,
                    overallPct,
                    globalAutoPassed,
                    globalAutoFailed,
                    globalManualPassed,
                    globalManualFailed
                ]);
            } else {
                rows.push(['Sin casos', 0, 0, 0, '0%', 0, 0, 0, 0]);
            }

            return {
                title: 'Informe Manual Vs Automatizado',
                metrics: {
                    total_casos: globalTotal,
                    total_manual: globalManual,
                    total_automatizado: globalAuto,
                    tasa_automatizacion: globalTotal > 0 ? `${Math.round((globalAuto / globalTotal) * 100)}%` : '0%'
                },
                headers: ['Módulo / Squad', 'Total Casos', 'Manuales', 'Automatizados', '% Auto', 'Auto Passed', 'Auto Failed', 'Manual Passed', 'Manual Failed'],
                rows
            };
        }
    },

    // ── 8. Planeado Vs No Planeado ───────────────────────────────────────────
    'planned-vs-unplanned': {
        name: 'planned-vs-unplanned',
        description: 'Proportion of planned test cases linked to test runs/plans vs unplanned backlog',
        collect(ctx: ReportContext): ReportData {
            const tcItems = ctx.items.filter(it => it.canonicalScope === 'testcase');
            const items = tcItems.length > 0 ? tcItems : ctx.items;

            const groupField = ctx.groupBy || (items.some(i => i.custom_fields['squad']) ? 'squad' : 'module');
            const groups = ctx.stateQuery.group(items, groupField);

            let globalTotal = 0;
            let globalPlanned = 0;
            let globalUnplanned = 0;

            const rows: (string | number)[][] = [];

            for (const [gName, gItems] of Object.entries(groups)) {
                let planned = 0;
                let unplanned = 0;

                for (const it of gItems) {
                    if (it.testRunId || it.testPlanId || (it.status.toLowerCase() !== 'unexecuted' && it.status.toLowerCase() !== 'pending')) {
                        planned++;
                    } else {
                        unplanned++;
                    }
                }

                const total = gItems.length;
                const plannedPct = total > 0 ? `${Math.round((planned / total) * 100)}%` : '0%';

                globalTotal += total;
                globalPlanned += planned;
                globalUnplanned += unplanned;

                rows.push([
                    gName,
                    total,
                    planned,
                    unplanned,
                    plannedPct
                ]);
            }

            if (rows.length > 0) {
                const overallPct = globalTotal > 0 ? `${Math.round((globalPlanned / globalTotal) * 100)}%` : '0%';
                rows.push([
                    'Total',
                    globalTotal,
                    globalPlanned,
                    globalUnplanned,
                    overallPct
                ]);
            } else {
                rows.push(['Sin casos', 0, 0, 0, '0%']);
            }

            return {
                title: 'Informe Planeado Vs No Planeado',
                metrics: {
                    total_casos: globalTotal,
                    planeados: globalPlanned,
                    no_planeados: globalUnplanned,
                    tasa_planificacion: globalTotal > 0 ? `${Math.round((globalPlanned / globalTotal) * 100)}%` : '0%'
                },
                headers: ['Módulo / Squad', 'Total Casos', 'Planeados', 'No Planeados (Backlog)', '% Planificación'],
                rows
            };
        }
    },

    // ── 9. Matriz de Trazabilidad de Requisitos (RTM) ─────────────────────────
    'traceability': {
        name: 'traceability',
        description: 'End-to-End Requirement Traceability Matrix linking Features, Test Cases, Execution Runs, and Defects',
        collect(ctx: ReportContext): ReportData {
            const tcItems = ctx.items.filter(it => it.canonicalScope === 'testcase');
            const items = tcItems.length > 0 ? tcItems : ctx.items;

            const featureSet = new Set<string>();
            let executedCount = 0;
            let defectsCount = 0;

            const rows: (string | number)[][] = [];

            for (const it of items) {
                const feature = it.id.includes('.') ? it.id.slice(0, it.id.lastIndexOf('.')) : it.id;
                featureSet.add(feature);

                const isExecuted = it.testRunId || ['passed', 'failed', 'blocked'].includes(it.status.toLowerCase());
                if (isExecuted) executedCount++;

                const defectsList = it.defects && it.defects.length > 0 ? it.defects.join(', ') : '-';
                if (it.defects && it.defects.length > 0) defectsCount += it.defects.length;

                rows.push([
                    feature,
                    it.id,
                    it.title,
                    it.testRunId || '-',
                    it.status,
                    defectsList,
                    it.assignees[0] || '-'
                ]);
            }

            const total = items.length;
            const coverageRate = total > 0 ? `${Math.round((executedCount / total) * 100)}%` : '0%';

            return {
                title: 'Matriz de Trazabilidad de Pruebas (RTM)',
                metrics: {
                    total_requisitos: featureSet.size,
                    total_casos: total,
                    casos_ejecutados: executedCount,
                    tasa_cobertura: coverageRate,
                    total_defectos: defectsCount
                },
                headers: ['Requisito / Feature', 'Test Case ID', 'Título', 'Test Run', 'Estado', 'Defectos (Bugs)', 'Asignado'],
                rows: rows.length > 0 ? rows : [['Sin datos', '-', '-', '-', '-', '-', '-']]
            };
        }
    },

    // ── 10. Cobertura por Etiquetas (Tags) ────────────────────────────────────
    'coverage': {
        name: 'coverage',
        description: 'Coverage and pass rate distribution grouped by labels and tags',
        collect(ctx: ReportContext): ReportData {
            const byTag = ctx.stateQuery.group(ctx.items, 'labels');
            const rows: (string | number)[][] = [];

            for (const [tag, items] of Object.entries(byTag)) {
                const total = items.length;
                const passed = items.filter(i => i.status.toLowerCase() === 'passed').length;
                const failed = items.filter(i => i.status.toLowerCase() === 'failed').length;
                const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

                rows.push([
                    tag.startsWith('@') ? tag : `@${tag}`,
                    total,
                    passed,
                    failed,
                    `${pct}%`
                ]);
            }

            return {
                title: 'Informe de Cobertura por Etiquetas',
                metrics: {
                    total_etiquetas: Object.keys(byTag).length,
                    total_casos: ctx.items.length
                },
                headers: ['Etiqueta', 'Total', 'Passed', 'Failed', 'Cobertura %'],
                rows: rows.length > 0 ? rows : [['@untagged', 0, 0, 0, '0%']]
            };
        }
    },

    // ── 11. Actividad y Automatización de Casos ────────────────────────────────
    'test-case-activity': {
        name: 'test-case-activity',
        description: 'Automation metrics, recent activity, and modified test cases',
        collect(ctx: ReportContext): ReportData {
            let automatedCount = 0;
            const items = ctx.items.filter(i => i.canonicalScope === 'testcase');

            for (const d of items) {
                const autoVal = String(d.custom_fields['automation'] || d.custom_fields['automate'] || resolvePath(d.originalResource, 'attributes.custom_fields.automation') || '').toLowerCase();
                if (autoVal === 'true' || autoVal === 'yes' || autoVal === 'automated') {
                    automatedCount++;
                }
            }

            const total = items.length;
            const rate = total > 0 ? Math.round((automatedCount / total) * 100) : 0;

            const sliced = items.slice(0, 50);

            const resData: ReportData = {
                title: 'Test Case Activity & Automation',
                metrics: {
                    total_casos: total,
                    automatizados: automatedCount,
                    no_automatizados: total - automatedCount,
                    tasa_automatizacion: `${rate}%`
                },
                headers: ['ID', 'Título', 'Prioridad', 'Automatizado', 'Modificado', 'Asignado'],
                rows: sliced.map(d => {
                    const priority = d.custom_fields['priority'] || resolvePath(d.originalResource, 'attributes.custom_fields.priority') || 'Medium';
                    const autoVal = String(d.custom_fields['automation'] || d.custom_fields['automate'] || 'No');
                    return [
                        d.id,
                        d.title,
                        String(priority).replace('@', ''),
                        autoVal,
                        (d.updatedAt || '').split('T')[0] || '-',
                        d.assignees[0] || '-'
                    ];
                })
            };

            return enrichWithCustomFields(resData, sliced, ctx.fields);
        }
    },

    // ── 12. Volcado en Crudo (Raw) ───────────────────────────────────────────
    'raw': {
        name: 'raw',
        description: 'Raw unaggregated export of all filtered state resources',
        collect(ctx: ReportContext): ReportData {
            const resData: ReportData = {
                title: 'Raw Data Export',
                metrics: {
                    total_recursos: ctx.items.length
                },
                headers: ['ID', 'Title', 'Status', 'Labels', 'Assignees', 'Milestone', 'TestRun', 'IssueNumber'],
                rows: ctx.items.map(d => [
                    d.id,
                    d.title,
                    d.status,
                    d.labels.join(' '),
                    d.assignees.join(' '),
                    d.milestone || '',
                    d.testRunId || '',
                    d.issueNumber ?? ''
                ]),
                metadata: {
                    rawItems: ctx.items.map(d => {
                        const url = resolveItemUrl(d);
                        return {
                            id: d.id,
                            type: d.type,
                            title: d.title,
                            status: d.status,
                            labels: d.labels,
                            assignees: d.assignees,
                            milestone: d.milestone || '',
                            testRunId: d.testRunId || '',
                            testPlanId: d.testPlanId || '',
                            issueNumber: d.issueNumber,
                            url,
                            issueUrl: url,
                            custom_fields: d.custom_fields,
                            createdAt: d.createdAt,
                            updatedAt: d.updatedAt,
                            originalResource: d.originalResource
                        };
                    })
                }
            };

            return enrichWithCustomFields(resData, ctx.items, ctx.fields);
        }
    }
};

// Aliases for 2D pivot matrix
builtinReports['two-dimensional'] = builtinReports['bidimensional'];
builtinReports['matrix'] = builtinReports['bidimensional'];
builtinReports['matrix-2d'] = builtinReports['bidimensional'];
builtinReports['pivot'] = builtinReports['bidimensional'];
builtinReports['cross-bidimensional'] = builtinReports['bidimensional'];
builtinReports['cross-twodimensional'] = builtinReports['bidimensional'];
builtinReports['cross-two-dimensional'] = builtinReports['bidimensional'];

// Aliases for manual vs automated
builtinReports['manual-vs-automated'] = builtinReports['manual-vs-automated'];
builtinReports['manual-vs-auto'] = builtinReports['manual-vs-automated'];
builtinReports['automation'] = builtinReports['manual-vs-automated'];
builtinReports['automation-coverage'] = builtinReports['manual-vs-automated'];
builtinReports['cross-automation'] = builtinReports['manual-vs-automated'];

// Aliases for planned vs unplanned
builtinReports['planned-vs-unplanned'] = builtinReports['planned-vs-unplanned'];
builtinReports['planning'] = builtinReports['planned-vs-unplanned'];
builtinReports['cross-planning'] = builtinReports['planned-vs-unplanned'];

// Cross-scope and defect aliases
builtinReports['cross-defects'] = builtinReports['defects'];
builtinReports['bugs'] = builtinReports['defects'];
builtinReports['cross-traceability'] = builtinReports['traceability'];
builtinReports['rtm'] = builtinReports['traceability'];
builtinReports['cross-coverage'] = builtinReports['coverage'];
