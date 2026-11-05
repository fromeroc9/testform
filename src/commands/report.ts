import { StateQuery } from '../core/query';
import { VariableParser } from '../core/variables';
import { resolveReport, resolveFormat, resolveTemplate } from '../reports/loader';
import { ReportContext } from '../reports/types';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { green, red, yellow, bold } from 'chalk';
import { logger } from '../core/logger';
import { TestformError } from '../core/errors';
import { TITLE_CLI } from '../core/const';

export interface ReportCmdOptions {
    dir: string;
    type?: string;
    format?: string;
    filter?: string | string[];
    target?: string | string[];
    out?: string;
    groupBy?: string;
    statePath?: string;
    template?: string;
    apply?: boolean;
    variables?: VariableParser;
}

function printReportUsage(): void {
    console.log(`
${bold('Usage:')} ${TITLE_CLI} report <type> [options]

  Generate multi-dimensional test execution reports from local or remote state.
  Specifying the report <type> is required.

${bold('Available Report Types:')}
  testcase-summary    Execution overview and pass/fail metrics of testcases
  testrun-summary     Aggregate metrics grouped by testrun suite
  testrun-detailed    Detailed test case execution records per testrun
  testplan-summary    High-level rollup status and coverage across testplans
  defects             Failed and blocked testcases with defect/issue tracking
  traceability        Requirement-to-test traceability matrix
  coverage            Distribution and pass rates grouped by tags and labels

${bold('Available Formats:')}
  md                  Markdown table format (default)
  json                Structured JSON data
  csv                 Comma-separated values spreadsheet
  xlsx                Microsoft Excel workbook (supports custom templates)
  docx                Microsoft Word document (supports custom templates)

${bold('Options:')}
  -format=<fmt>       Report output format (md, json, csv, xlsx, docx)
  -target=<target>    Filter by target resource, testrun (@tr-N), or testplan (@tp-N)
  -filter=<expr>      Filter records (e.g. -filter="status=failed" or -filter="smoke")
  -group-by=<field>   Group records dynamically by field (e.g. -group-by=feature)
  -template=<path>    Custom template file for xlsx, docx, or markdown
  -o, -out=<path>     Save report output to destination file

${bold('Examples:')}
  ${TITLE_CLI} report testcase-summary
  ${TITLE_CLI} report testrun-summary -target="@tr-1"
  ${TITLE_CLI} report defects -format=csv -out=defects.csv
  ${TITLE_CLI} report traceability -group-by=feature -format=md
  ${TITLE_CLI} report testplan-summary -target="@tp-1" -format=xlsx -out=sprint_report.xlsx
`.trim());
}

export const reportCmd = async (options: ReportCmdOptions): Promise<void> => {
    const {
        dir = '.',
        type,
        format: requestedFormat = 'markdown',
        filter,
        target,
        out,
        groupBy,
        statePath,
        template: cliTemplate,
        variables
    } = options;

    if (!type) {
        printReportUsage();
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

        // 3. Resolver reporte (del catálogo o autocarga de .testform/reports/)
        const report = await resolveReport(type, dir);

        // 4. Preparar contexto y recolectar datos
        const context: ReportContext = {
            target,
            items: filteredItems,
            stats,
            variables: varsRecord,
            groupBy,
            options,
            stateQuery
        };

        const reportData = await report.collect(context);

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
            console.log(green(`✓ Report saved to ${out}`));
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
