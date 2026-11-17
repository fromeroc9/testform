import { StateQuery } from '../core/query';
import { VariableParser } from '../core/variables';
import { resolveReport, resolveFormat, resolveTemplate } from '../reports/loader';
import { ReportContext } from '../reports/types';
import { enrichWithCustomFields } from '../reports/catalog';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { green, yellow } from 'chalk';
import { logger } from '../core/logger';
import { TestformError } from '../core/errors';
import { HELP_REPORT } from '../core/help';

export interface ReportCmdOptions {
    dir: string;
    type?: string;
    format?: string;
    filter?: string | string[];
    target?: string | string[];
    out?: string;
    groupBy?: string;
    secondaryGroupBy?: string;
    fields?: string | string[];
    statePath?: string;
    template?: string;
    apply?: boolean;
    variables?: VariableParser;
    source?: 'state' | 'files' | 'simulation';
    fromFiles?: boolean;
    simulation?: boolean;
}

export const reportCmd = async (options: ReportCmdOptions): Promise<void> => {
    const {
        dir = '.',
        type,
        format: requestedFormat = 'md',
        filter,
        target,
        out,
        groupBy,
        secondaryGroupBy,
        fields: rawFields,
        statePath,
        template: cliTemplate,
        variables,
        source,
        fromFiles,
        simulation
    } = options;

    if (!type || type.trim() === '') {
        console.log(HELP_REPORT);
        return;
    }

    const isFromFiles = Boolean(
        fromFiles ||
        simulation ||
        source === 'files' ||
        source === 'simulation'
    );

    try {
        // 1. Inicializar motor de StateQuery (soporta State oficial y Simulación Filesystem)
        const stateQuery = new StateQuery(dir, statePath, undefined, {
            source: isFromFiles ? 'files' : 'state',
            fromFiles: isFromFiles,
            variables
        });
        await stateQuery.init();

        const targetedItems = stateQuery.filterByTarget(target);
        const filterArr = Array.isArray(filter) ? filter : (filter ? [filter] : []);
        const filteredItems = filterArr.length > 0 ? stateQuery.filter(filterArr, targetedItems) : targetedItems;
        const stats = stateQuery.getStats(filteredItems);

        // 2. Extraer variables del proyecto
        const varsRecord: Record<string, string> = variables ? variables.getVars() : {};

        // 3. Parsear campos adicionales solicitados (--fields)
        let fields: string[] | undefined;
        if (typeof rawFields === 'string') {
            fields = rawFields.split(',').map(s => s.trim()).filter(Boolean);
        } else if (Array.isArray(rawFields)) {
            fields = rawFields.map(s => String(s).trim()).filter(Boolean);
        }

        // 4. Resolver reporte (del catálogo o autocarga de .testform/reports/)
        const report = await resolveReport(type, dir);

        // 5. Preparar contexto y recolectar datos
        const context: ReportContext = {
            target,
            items: filteredItems,
            stats,
            variables: varsRecord,
            groupBy,
            secondaryGroupBy,
            fields,
            options,
            stateQuery,
            isStateVerified: stateQuery.isStateVerified,
            source: stateQuery.dataSource,
            signature: stateQuery.signature
        };

        let reportData = await report.collect(context);

        // Stamp simulation metadata and governance signature
        if (!stateQuery.isStateVerified) {
            reportData.isStateVerified = false;
            reportData.source = 'files';
            reportData.signature = stateQuery.signature;
            reportData.metadata = {
                ...(reportData.metadata || {}),
                is_state_verified: false,
                source: 'filesystem_simulation',
                signature: stateQuery.signature,
                disclaimer: 'Report generated directly from filesystem files. Data not consolidated in testform.state.'
            };
        } else {
            reportData.isStateVerified = true;
            reportData.source = 'state';
            reportData.metadata = {
                ...(reportData.metadata || {}),
                is_state_verified: true,
                source: 'state'
            };
        }

        // Fallback: si el reporte no incluyó los campos adicionales y los rows coinciden con los items
        if (reportData.rows.length === filteredItems.length && (!context.fields || !context.fields.some(f => f.toLowerCase() === 'none'))) {
            const hasExtraFields = reportData.headers.some(h =>
                (context.fields && context.fields.length > 0)
                    ? context.fields.some(f => f.toLowerCase() === h.toLowerCase().replace(/\s+/g, '_'))
                    : false
            );
            if (!hasExtraFields) {
                reportData = enrichWithCustomFields(reportData, filteredItems, context.fields);
            }
        }

        // 6. Resolver formato
        const format = await resolveFormat(report, requestedFormat, dir);

        // 7. Resolver plantilla
        const templateContent = resolveTemplate(report, format.name, cliTemplate, context, dir);

        // 8. Renderizar resultado
        const result = await format.render(reportData, context, templateContent);

        // 9. Salida
        if (out) {
            const outPath = resolve(dir, out);
            writeFileSync(outPath, result);
            console.log(green(`Report saved to ${out}`));
            if (!stateQuery.isStateVerified) {
                console.log(yellow(`⚠️  ADVERTENCIA: Reporte generado en modo SIMULACIÓN (data no consolidada en testform.state).`));
            }
        } else {
            if (format.isBinary) {
                const defaultOut = `report${format.extension}`;
                const outPath = resolve(dir, defaultOut);
                writeFileSync(outPath, result);
                console.log(yellow(`Binary format "${format.name}" saved to default output: ${defaultOut}`));
                if (!stateQuery.isStateVerified) {
                    console.log(yellow(`⚠️  ADVERTENCIA: Reporte generado en modo SIMULACIÓN (data no consolidada en testform.state).`));
                }
            } else {
                if (!stateQuery.isStateVerified && (requestedFormat === 'md' || requestedFormat === 'markdown' || requestedFormat === 'console')) {
                    console.log(yellow(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠️  MODO SIMULACIÓN / DRY-RUN (DATA NO CONSOLIDADA EN STATE)                │
│ Este reporte fue leído directamente de archivos locales (.feature).         │
│ No representa el estado oficial consolidado en testform.state.              │
│ Regla del proyecto: Los resultados oficiales deben estar en el state.       │
└─────────────────────────────────────────────────────────────────────────────┘`));
                }
                console.log(typeof result === 'string' ? result : result.toString('utf-8'));
            }
        }
    } catch (err: any) {
        if (err instanceof TestformError) {
            process.exitCode = err.exitCode || 1;
            return;
        }
        logger.push({
            type: 'error',
            title: err.name && err.name !== 'Error' ? err.name : 'Report generation error',
            detail: err.message ? err.message.split('\n') : [String(err)]
        });
        process.exitCode = 1;
    }
};
