import { QueryResultItem, ReportStats, StateQuery } from '../core/query';

export interface ReportData {
    title: string;
    metrics?: Record<string, string | number>;
    headers: string[];
    rows: (string | number)[][];
    metadata?: Record<string, any>;
}

export interface ReportContext {
    items: QueryResultItem[];
    stats: ReportStats;
    variables: Record<string, string>;
    groupBy?: string;
    target?: string | string[];
    options: Record<string, any>;
    stateQuery: StateQuery;
}

export interface IReportFormat {
    readonly name: string;
    readonly extension: string;
    readonly isBinary?: boolean;
    render(data: ReportData, context: ReportContext, template?: string | Buffer): Promise<string | Buffer> | string | Buffer;
}

export interface IReport {
    readonly name: string;
    readonly description?: string;

    // Recolecta métricas y datos estructurados
    collect(context: ReportContext): ReportData | Promise<ReportData>;

    // Plantillas por formato (opcional)
    templates?: Record<string, string | Buffer | undefined> | ((format: string, context: ReportContext) => string | Buffer | undefined);

    // Formatos custom locales o sobreescritura de formato (opcional)
    formats?: Record<string, (data: ReportData, context: ReportContext) => Promise<string | Buffer> | string | Buffer>;
}

