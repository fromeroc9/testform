import { IReport, ReportContext, ReportData } from './types';
import { QueryResultItem } from '../core/query';
import { resolvePath } from '../core/utils';

export const builtinReports: Record<string, IReport> = {
    // ── 1. Resumen de Casos de Prueba ─────────────────────────────────────────
    'testcase-summary': {
        name: 'testcase-summary',
        description: 'Informe de casos de prueba y su estado de ejecución',
        collect(ctx: ReportContext): ReportData {
            const tcItems = ctx.items.filter(it => it.canonicalScope === 'testcase');
            const items = tcItems.length > 0 ? tcItems : ctx.items;

            return {
                title: 'Informe de Casos de Prueba',
                metrics: {
                    total: ctx.stats.total,
                    passed: ctx.stats.passed,
                    failed: ctx.stats.failed,
                    pending: ctx.stats.pending,
                    blocked: ctx.stats.blocked,
                    skipped: ctx.stats.skipped,
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
        }
    },

    // ── 2. Resumen de Ejecuciones (Test Runs) ─────────────────────────────────
    'testrun-summary': {
        name: 'testrun-summary',
        description: 'Resumen de corridas de prueba y métricas de ejecución',
        collect(ctx: ReportContext): ReportData {
            const runGroups = ctx.stateQuery.group(ctx.items.filter(i => i.testRunId), 'testrun');
            const rows: (string | number)[][] = [];

            for (const [runId, runItems] of Object.entries(runGroups)) {
                if (runId === 'none') continue;
                const rStats = ctx.stateQuery.getStats(runItems);
                rows.push([
                    runId,
                    runItems.length,
                    rStats.passed,
                    rStats.failed,
                    rStats.blocked,
                    rStats.passed === runItems.length && runItems.length > 0 ? 'Passed' : (rStats.failed > 0 ? 'Failed' : 'In Progress')
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
        description: 'Detalle de casos y prioridades por cada corrida de prueba',
        collect(ctx: ReportContext): ReportData {
            const executed = ctx.items.filter(i => i.canonicalScope === 'testcase' && i.testRunId);
            const items = executed.length > 0 ? executed : ctx.items.filter(i => i.canonicalScope === 'testcase');

            return {
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
                        String(priority),
                        d.assignees[0] || '-'
                    ];
                })
            };
        }
    },

    // ── 4. Resumen de Planes de Prueba ────────────────────────────────────────
    'testplan-summary': {
        name: 'testplan-summary',
        description: 'Progreso y métricas de los planes de prueba',
        collect(ctx: ReportContext): ReportData {
            const allPlans = ctx.stateQuery.getResources().filter(r => r.type.includes('testplan'));
            const planItems = ctx.items.filter(i => i.canonicalScope === 'testplan');
            const targetPlanIds = new Set(planItems.map(p => p.id));
            const plans = targetPlanIds.size > 0
                ? allPlans.filter(p => targetPlanIds.has(p.identity))
                : allPlans;
            const rows: (string | number)[][] = [];

            for (const plan of plans) {
                const linkedRuns = (plan.attributes.testruns as string[]) || [];
                const planItems = ctx.items.filter(it => it.testRunId && linkedRuns.some(r => it.testRunId!.endsWith(r)));
                const pStats = ctx.stateQuery.getStats(planItems);
                const pct = planItems.length > 0 ? Math.round((pStats.passed / planItems.length) * 100) : 0;

                rows.push([
                    plan.identity,
                    String(plan.attributes.title || plan.identity),
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

    // ── 5. Informe de Defectos ────────────────────────────────────────────────
    'defects': {
        name: 'defects',
        description: 'Casos de prueba fallidos o bloqueados con sus referencias a issues',
        collect(ctx: ReportContext): ReportData {
            const failures = ctx.items.filter(d => ['failed', 'blocked'].includes(d.status.toLowerCase()));

            return {
                title: 'Informe de Defectos',
                metrics: {
                    total_defectos: failures.length,
                    failed: failures.filter(f => f.status.toLowerCase() === 'failed').length,
                    blocked: failures.filter(f => f.status.toLowerCase() === 'blocked').length
                },
                headers: ['Run', 'Test Case', 'Título', 'Estado', 'Issue', 'Asignado'],
                rows: failures.length > 0
                    ? failures.map(d => [
                        d.testRunId || '-',
                        d.id,
                        d.title,
                        d.status,
                        d.issueNumber ? `[#${d.issueNumber}](https://github.com/issues/${d.issueNumber})` : '-',
                        d.assignees[0] || '-'
                    ])
                    : [['-', 'Sin defectos', 'No se encontraron pruebas fallidas o bloqueadas.', 'Passed', '-', '-']]
            };
        }
    },

    // ── 6. Matriz de Trazabilidad de Requisitos ───────────────────────────────
    'traceability': {
        name: 'traceability',
        description: 'Trazabilidad de requisitos / features contra casos de prueba y cobertura',
        collect(ctx: ReportContext): ReportData {
            const byReq = ctx.stateQuery.group(ctx.items, ctx.groupBy || 'feature');
            const rows: (string | number)[][] = [];

            for (const [reqName, items] of Object.entries(byReq)) {
                const total = items.length;
                const passed = items.filter(i => i.status.toLowerCase() === 'passed').length;
                const failed = items.filter(i => i.status.toLowerCase() === 'failed').length;
                const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

                rows.push([
                    reqName,
                    total,
                    passed,
                    failed,
                    `${pct}%`
                ]);
            }

            return {
                title: 'Requirement Traceability Report',
                metrics: {
                    total_requisitos: Object.keys(byReq).length,
                    total_casos: ctx.items.length,
                    passed: ctx.stats.passed
                },
                headers: ['Requisito / Feature', 'Total Pruebas', 'Passed', 'Failed', 'Cobertura %'],
                rows: rows.length > 0 ? rows : [['Sin requisitos', 0, 0, 0, '0%']]
            };
        }
    },

    // ── 7. Cobertura por Etiquetas (Tags) ─────────────────────────────────────
    'coverage': {
        name: 'coverage',
        description: 'Porcentaje de cobertura y éxito agrupado por etiquetas (@tags)',
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

    // ── 8. Matriz Bidimensional de Estados ────────────────────────────────────
    'two-dimensional': {
        name: 'two-dimensional',
        description: 'Matriz cruzada de etiquetas contra distribución de estados',
        collect(ctx: ReportContext): ReportData {
            const byTag = ctx.stateQuery.group(ctx.items, 'labels');
            const statuses = ['passed', 'failed', 'pending', 'blocked', 'skipped', 'unexecuted'];
            const rows: (string | number)[][] = [];

            for (const [tag, items] of Object.entries(byTag)) {
                const tagStats: Record<string, number> = {};
                for (const it of items) {
                    const st = it.status.toLowerCase();
                    tagStats[st] = (tagStats[st] || 0) + 1;
                }

                rows.push([
                    tag.startsWith('@') ? tag : `@${tag}`,
                    tagStats['passed'] || 0,
                    tagStats['failed'] || 0,
                    tagStats['pending'] || 0,
                    tagStats['blocked'] || 0,
                    tagStats['skipped'] || 0,
                    tagStats['unexecuted'] || 0,
                    items.length
                ]);
            }

            return {
                title: 'Informe Bidimensional de Estados',
                metrics: {
                    total_etiquetas: Object.keys(byTag).length,
                    total_casos: ctx.items.length
                },
                headers: ['Etiqueta', 'Passed', 'Failed', 'Pending', 'Blocked', 'Skipped', 'Unexecuted', 'Total'],
                rows: rows.length > 0 ? rows : [['@untagged', 0, 0, 0, 0, 0, 0, 0]]
            };
        }
    },

    // ── 9. Actividad y Automatización de Casos ─────────────────────────────────
    'test-case-activity': {
        name: 'test-case-activity',
        description: 'Métricas de automatización, actividad y casos modificados',
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

            return {
                title: 'Test Case Activity & Automation',
                metrics: {
                    total_casos: total,
                    automatizados: automatedCount,
                    no_automatizados: total - automatedCount,
                    tasa_automatizacion: `${rate}%`
                },
                headers: ['ID', 'Título', 'Prioridad', 'Automatizado', 'Modificado', 'Asignado'],
                rows: items.slice(0, 50).map(d => {
                    const priority = d.custom_fields['priority'] || resolvePath(d.originalResource, 'attributes.custom_fields.priority') || 'Medium';
                    const autoVal = String(d.custom_fields['automation'] || d.custom_fields['automate'] || 'No');
                    return [
                        d.id,
                        d.title,
                        String(priority),
                        autoVal,
                        (d.updatedAt || '').split('T')[0] || '-',
                        d.assignees[0] || '-'
                    ];
                })
            };
        }
    },

    // ── 10. Volcado en Crudo (Raw) ────────────────────────────────────────────
    'raw': {
        name: 'raw',
        description: 'Volcado en crudo de todos los recursos filtrados sin agregación',
        collect(ctx: ReportContext): ReportData {
            return {
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
                    rawItems: ctx.items.map(d => ({
                        id: d.id,
                        type: d.type,
                        title: d.title,
                        status: d.status,
                        labels: d.labels,
                        assignees: d.assignees,
                        milestone: d.milestone || '',
                        testRunId: d.testRunId || '',
                        testPlanId: d.testPlanId || '',
                        issueNumber: d.issueNumber || 0,
                        issueUrl: `https://github.com/issues/${d.issueNumber || 0}`,
                        custom_fields: d.custom_fields,
                        createdAt: d.createdAt,
                        updatedAt: d.updatedAt,
                        originalResource: d.originalResource
                    }))
                }
            };
        }
    }
};
