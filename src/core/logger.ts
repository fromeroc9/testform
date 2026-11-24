import { cyan, green, yellow, red, gray, bold, dim } from 'chalk';
import { LogOptions, INotify } from './types';
import { TestformError } from './errors';

function cleanText(text: string): string {
    if (process.env.NO_COLOR === '1') {
        return text.replace(/\u001b\[[0-9;]*m/g, '');
    }
    return text;
}

export function sanitizeTitle(
    rawTitle: string,
    fallback: string = 'An unexpected error occurred'
): string {
    if (!rawTitle) return fallback;
    let title = rawTitle.trim();

    // 1. Repeatedly strip leading "Error:", "error:", "Warning:", "warning:" prefixes with colon
    while (/^(?:error|warning):\s*/i.test(title)) {
        title = title.replace(/^(?:error|warning):\s*/i, '').trim();
    }

    // 2. If it is literally just "error" or "warning" (case-insensitive)
    if (/^(?:error|warning)$/i.test(title)) {
        return fallback;
    }

    // 3. If it starts with "error " or "warning " followed by words
    // e.g. "error asking for approval: interrupted" -> "asking for approval: interrupted"
    if (/^error\s+/i.test(title)) {
        title = title.replace(/^error\s+/i, '').trim();
    } else if (/^warning\s+/i.test(title)) {
        title = title.replace(/^warning\s+/i, '').trim();
    }

    // 4. Check again after stripping
    if (!title || /^(?:error|warning)$/i.test(title)) {
        return fallback;
    }

    // 5. Capitalize first character if it's lowercase
    if (/^[a-z]/.test(title)) {
        title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    return title;
}

export class Logger {
    private verbose: boolean = false;
    private isJson: boolean = false;

    constructor(verbose: boolean = false, isJson: boolean = false) {
        this.verbose = verbose;
        this.isJson = isJson;
    }

    private print(text: string, isError: boolean = false): void {
        const out = cleanText(text);
        if (isError) {
            console.error(out);
        } else {
            console.log(out);
        }
    }

    private applyStyle(text: string, options?: LogOptions): string {
        let styled = text;
        if (options?.bold) styled = bold(styled);
        if (options?.dim) styled = dim(styled);
        return styled;
    }

    private emitJson(level: string, message: string, data?: any) {
        const payload: any = {
            "@level": level,
            "@message": message,
            "@module": "testform.ui",
            "@timestamp": new Date().toISOString(),
            "type": "log"
        };
        if (data) {
            payload.data = data;
        }
        console.log(JSON.stringify(payload));
    }

    private formatMessage(message: string | string[]): string {
        return Array.isArray(message) ? message.join('\n') : message;
    }

    debug(message: string | string[], options?: LogOptions): void {
        if (!this.verbose) return;
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("debug", msgStr, options?.data);
            return;
        }
        const showPrefix = options?.prefix !== false;
        const prefix = showPrefix ? dim(`[DEBUG] `) : '';
        const styledMsg = this.applyStyle(msgStr, options);
        this.print(`${prefix}${gray(styledMsg)}`);
        if (options?.data) this.print(gray(JSON.stringify(options.data, null, 2)));
    }

    info(message: string | string[], options?: LogOptions): void {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("info", msgStr, options?.data);
            return;
        }
        const showPrefix = options?.prefix === true; // No prefix by default
        const prefix = showPrefix ? cyan(`[INFO] `) : '';
        const styledMsg = this.applyStyle(msgStr, options);
        this.print(`${prefix}${styledMsg}`);
        if (options?.data && this.verbose) this.print(gray(JSON.stringify(options.data, null, 2)));
    }

    success(message: string | string[], options?: LogOptions): void {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("info", msgStr, options?.data);
            return;
        }
        const showPrefix = options?.prefix === true; // No prefix by default
        const prefix = showPrefix ? green(`[✓] `) : '';
        const styledMsg = this.applyStyle(green(msgStr), options);
        this.print(`${prefix}${styledMsg}`);
        if (options?.data && this.verbose) this.print(gray(JSON.stringify(options.data, null, 2)));
    }

    warn(message: string | string[], options?: LogOptions): void {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("warn", msgStr, options?.data);
            return;
        }
        this.print(yellow('╷'), true);
        const prefix = bold(yellow('Warning:'));
        const lines = msgStr.split('\n');
        const cleanFirst = sanitizeTitle(lines[0], 'Warning encountered');
        const styledMsg = this.applyStyle(cleanFirst, options);
        this.print(`${yellow('│')} ${prefix} ${styledMsg}`, true);
        for (let i = 1; i < lines.length; i++) {
            this.print(`${yellow('│')} ${lines[i]}`, true);
        }

        if (options?.data && this.verbose) {
            this.print(yellow('│'), true);
            const dataStr = JSON.stringify(options.data, null, 2);
            dataStr.split('\n').forEach(line => this.print(`${yellow('│')}   ${line}`, true));
        }
        this.print(yellow('╵'), true);
    }

    error(message: string | string[], error?: Error | any): void {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("error", msgStr, error ? (error instanceof Error ? error.stack : error) : undefined);
            const err = new TestformError(msgStr);
            (err as any).logged = true;
            throw err;
        }
        this.print(red('╷'), true);
        const prefix = bold(red('Error:'));

        const lines = msgStr.split('\n');
        const rawFirstLine = lines[0];
        const fallbackTitle = (error instanceof Error && error.message)
            ? sanitizeTitle(error.message, 'An unexpected error occurred')
            : 'An unexpected error occurred';
        const cleanFirstLine = sanitizeTitle(rawFirstLine, fallbackTitle);

        this.print(`${red('│')} ${prefix} ${bold(cleanFirstLine)}`, true);
        for (let i = 1; i < lines.length; i++) {
            this.print(`${red('│')} ${lines[i]}`, true);
        }

        if (error) {
            const errMsg = error instanceof Error ? error.message : (typeof error === 'object' ? '' : String(error));
            const isDuplicate = errMsg && (
                errMsg.trim().toLowerCase() === rawFirstLine.trim().toLowerCase() ||
                errMsg.trim().toLowerCase() === cleanFirstLine.trim().toLowerCase() ||
                sanitizeTitle(errMsg).toLowerCase() === cleanFirstLine.toLowerCase()
            );

            if (!isDuplicate || (this.verbose && error instanceof Error && error.stack)) {
                this.print(red('│'), true);
                if (error instanceof Error) {
                    if (!isDuplicate && error.message) {
                        const cleanErrMsg = sanitizeTitle(error.message);
                        this.print(`${red('│')}   ${cleanErrMsg}`, true);
                    }
                    if (this.verbose && error.stack) {
                        error.stack.split('\n').forEach(line => this.print(`${red('│')}   ${dim(line)}`, true));
                    }
                } else if (typeof error === 'object') {
                    const str = JSON.stringify(error, null, 2);
                    str.split('\n').forEach(line => this.print(`${red('│')}   ${line}`, true));
                } else {
                    this.print(`${red('│')}   ${String(error)}`, true);
                }
            }
        }
        this.print(red('╵'), true);
        const err = new TestformError(cleanFirstLine);
        (err as any).logged = true;
        throw err;
    }

    blank(): void {
        if (this.isJson) return;
        this.print('');
    }

    push(options: INotify) {
        const isWarning = options.type === 'warning';
        const prefixStr = isWarning ? bold(yellow('Warning:')) : bold(red('Error:'));
        const lineColor = isWarning ? yellow : red;
        const fallbackTitle = (options.detail && options.detail.length > 0 && options.detail[0].trim())
            ? options.detail[0].trim()
            : (isWarning ? 'Warning encountered' : 'An unexpected error occurred');
        const cleanTitleStr = sanitizeTitle(options.title, fallbackTitle);
        const title = bold(cleanTitleStr);
        const close = options.close ?? false;

        if (this.isJson) {
            this.emitJson(options.type === 'warning' ? "warn" : "error", cleanTitleStr, { detail: options.detail, extra: options.extra });
            if (close) {
                const err = new TestformError(cleanTitleStr);
                (err as any).logged = true;
                throw err;
            }
            return;
        }

        this.print(lineColor('╷'));
        this.print(`${lineColor('│')} ${prefixStr} ${title}`);
        this.print(lineColor('│'));

        if (options.detail) {
            for (const line of options.detail) {
                this.print(line ? `${lineColor('│')}   ${line}` : lineColor('│'));
            }
        }

        if (options.extra) {
            for (const line of options.extra) {
                this.print(`${lineColor('│')} ${line}`);
            }
        }

        this.print(lineColor('╵'));

        if (close) {
            const err = new TestformError(cleanTitleStr);
            (err as any).logged = true;
            throw err;
        }
    }

    refresh(resourceId: string, remoteId?: string) {
        if (this.isJson) return;
        const state = remoteId ? dim(`[id=${remoteId}]`) : '';
        this.print(`${cyan(resourceId)}: Refreshing state... ${state}`);
    }

}

export const logger = new Logger();