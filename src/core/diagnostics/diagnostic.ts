import { logger } from '../logger';
import { INotify } from '../types';
import { DiagnosticProps, IDiagnosticComponent, SourceLocation } from './types';

export class Diagnostic implements IDiagnosticComponent {
    public readonly type: 'error' | 'warning';
    public readonly title: string;
    public readonly location?: SourceLocation;
    public readonly detail: string[];
    public readonly help?: string[];
    public readonly extra?: string[];
    public readonly close: boolean;

    constructor(props: DiagnosticProps) {
        this.type = props.type || 'error';
        this.title = props.title;
        this.location = props.location;
        this.close = props.close ?? false;

        const detailLines: string[] = [];

        // Format location if present (Terraform style)
        if (props.location) {
            const loc = props.location;
            const filePart = loc.file;
            const linePart = loc.line !== undefined ? ` line ${loc.line}` : '';
            const scopePart = loc.scope ? `, in ${loc.scope}` : '';
            detailLines.push(`on ${filePart}${linePart}${scopePart}:`);

            if (loc.snippet !== undefined) {
                const lineNum = loc.line !== undefined ? String(loc.line).padStart(4, ' ') : '    ';
                detailLines.push(`${lineNum}:   ${loc.snippet}`);
            }
            detailLines.push('');
        }

        // Format main detail
        if (props.detail) {
            const lines = Array.isArray(props.detail) ? props.detail : props.detail.split('\n');
            detailLines.push(...lines);
        }

        // Format help / suggestions
        if (props.help) {
            const helpLines = Array.isArray(props.help) ? props.help : props.help.split('\n');
            if (detailLines.length > 0 && detailLines[detailLines.length - 1] !== '') {
                detailLines.push('');
            }
            detailLines.push(...helpLines);
        }

        this.detail = detailLines;
        this.extra = props.extra;
    }

    toNotify(): INotify {
        return {
            type: this.type,
            title: this.title,
            detail: this.detail,
            extra: this.extra,
            close: this.close,
        };
    }

    emit(): void {
        logger.push(this.toNotify());
    }

    abort(): never {
        this.emit();
        process.exit(1);
    }
}
