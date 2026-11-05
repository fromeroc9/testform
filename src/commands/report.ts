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
    fields?: string | string[];
    statePath?: string;
    template?: string;
    apply?: boolean;
    variables?: VariableParser;
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
        fields: rawFields,
        statePath,
        template: cliTemplate,
        variables
    } = options;

    if (!type || type.trim() === '') {
        console.log(HELP_REPORT);
        return;
    }

    try {
        // 1. Inicializar motor de StateQuery y filtrar items por target y filter
        const stateQuery = new StateQuery(dir, statePath);
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
            fields,
            options,
            stateQuery
        };

        let reportData = await report.collect(context);

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

        // 5. Resolver formato
        const format = await resolveFormat(report, requestedFormat, dir);

        // 6. Resolver plantilla
        const templateContent = resolveTemplate(report, format.name, cliTemplate, context, dir);

        // 7. Renderizar resultado
        const result = await format.render(reportData, context, templateContent);

        // 8. Salida
        if (out) {
            const outPath = resolve(dir, out);
            writeFileSync(outPath, result);
            console.log(green(`Report saved to ${out}`));
        } else {
            if (format.isBinary) {
                const defaultOut = `report${format.extension}`;
                const outPath = resolve(dir, defaultOut);
                writeFileSync(outPath, result);
                console.log(yellow(`Binary format "${format.name}" saved to default output: ${defaultOut}`));
            } else {
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
