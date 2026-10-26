import { IReport, IReportFormat, ReportContext, ReportData } from './types';
import { builtinReports } from './catalog';
import { coreFormats } from './formats';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { red, bold } from 'chalk';

export async function resolveReport(name: string, dir: string = process.cwd()): Promise<IReport> {
    const cleanName = (name || 'testcase-summary').trim().toLowerCase();

    // 1. Core catalog
    if (builtinReports[cleanName]) {
        return builtinReports[cleanName];
    }

    // 2. Autocarga desde .testform/reports/
    const candidatePaths = [
        resolve(dir, '.testform', 'reports', `${cleanName}.ts`),
        resolve(dir, '.testform', 'reports', `${cleanName}.js`),
        resolve(dir, '.testform', 'reports', cleanName, 'index.ts'),
        resolve(dir, '.testform', 'reports', cleanName, 'index.js'),
    ];

    for (const p of candidatePaths) {
        if (existsSync(p)) {
            try {
                let mod: any;
                try {
                    mod = await import(pathToFileURL(p).href);
                } catch {
                    mod = require(p);
                }
                const reportObj: IReport = mod.default || mod.report || mod;
                if (reportObj && typeof reportObj.collect === 'function') {
                    return reportObj;
                }
            } catch (err: any) {
                console.error(red(`Error loading custom report from ${p}: ${err.message || err}`));
            }
        }
    }

    const available = Object.keys(builtinReports).join(', ');
    throw new Error(`Report type "${cleanName}" not found.\nAvailable core reports: ${available}\nOr create .testform/reports/${cleanName}.ts`);
}

export async function resolveFormat(
    report: IReport,
    formatName: string = 'markdown',
    dir: string = process.cwd()
): Promise<IReportFormat> {
    const cleanFmt = (formatName || 'markdown').trim().toLowerCase();

    // 1. Formato local exclusivo definido dentro del reporte
    if (report.formats && report.formats[cleanFmt]) {
        const customRender = report.formats[cleanFmt];
        return {
            name: cleanFmt,
            extension: `.${cleanFmt}`,
            render: async (data: ReportData, context: ReportContext) => {
                return customRender(data, context);
            }
        };
    }

    // 2. Formato del core (md, json, csv, docx, xlsx)
    if (coreFormats[cleanFmt]) {
        return coreFormats[cleanFmt];
    }

    // 3. Autocarga de formato global desde .testform/reports/
    const candidatePaths = [
        resolve(dir, '.testform', 'reports', `${cleanFmt}.format.ts`),
        resolve(dir, '.testform', 'reports', `${cleanFmt}.format.js`),
        resolve(dir, '.testform', 'reports', `${cleanFmt}.ts`),
        resolve(dir, '.testform', 'reports', `${cleanFmt}.js`),
    ];

    for (const p of candidatePaths) {
        if (existsSync(p)) {
            try {
                let mod: any;
                try {
                    mod = await import(pathToFileURL(p).href);
                } catch {
                    mod = require(p);
                }
                const formatObj: IReportFormat = mod.default || mod.format || mod;
                if (formatObj && typeof formatObj.render === 'function') {
                    return formatObj;
                }
            } catch (err: any) {
                console.error(red(`Error loading custom format from ${p}: ${err.message || err}`));
            }
        }
    }

    const available = Object.keys(coreFormats).join(', ');
    throw new Error(`Format "${cleanFmt}" not found.\nAvailable core formats: ${available}\nOr create .testform/reports/${cleanFmt}.format.ts`);
}

export function resolveTemplate(
    report: IReport,
    formatName: string,
    cliTemplate?: string,
    context?: ReportContext,
    dir: string = process.cwd()
): string | Buffer | undefined {
    // 1. CLI flag explícito (--template=ruta)
    if (cliTemplate) {
        const resolved = resolve(dir, cliTemplate);
        if (existsSync(resolved)) {
            return readFileSync(resolved);
        }
        return cliTemplate;
    }

    // 2. Plantilla configurada dentro de la definición del reporte
    if (report.templates) {
        if (typeof report.templates === 'function') {
            return report.templates(formatName, context!);
        }
        if (typeof report.templates === 'object' && report.templates[formatName]) {
            const tpl = report.templates[formatName]!;
            if (typeof tpl === 'string' && existsSync(resolve(dir, tpl))) {
                return readFileSync(resolve(dir, tpl));
            }
            return tpl;
        }
    }

    // 3. Convención automática en .testform/reports/
    const conventionFile = resolve(dir, '.testform', 'reports', `report.${formatName}`);
    if (existsSync(conventionFile)) {
        return readFileSync(conventionFile);
    }

    return undefined;
}

