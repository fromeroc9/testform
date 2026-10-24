import { cyan, green, yellow, red, gray, bold, dim } from 'chalk';
import { LogLevel, LogOptions, INotify } from './types';
import { TestformError } from './errors';

function cleanText(text: string): string {
    if (process.env.NO_COLOR === '1') {
        return text.replace(/\u001b\[[0-9;]*m/g, '');
    }
    return text;
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
        const styledMsg = this.applyStyle(msgStr, options);
        this.print(`${yellow('│')} ${prefix} ${styledMsg}`, true);

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
            throw new TestformError(msgStr);
        }
        this.print(red('╷'), true);
        const prefix = bold(red('Error:'));

        const lines = msgStr.split('\n');
        this.print(`${red('│')} ${prefix} ${bold(lines[0])}`, true);
        for (let i = 1; i < lines.length; i++) {
            this.print(`${red('│')} ${lines[i]}`, true);
        }

        if (error) {
            this.print(red('│'), true);
            if (error instanceof Error) {
                this.print(`${red('│')}   ${error.message}`, true);
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
        this.print(red('╵'), true);
        throw new TestformError(msgStr);
    }

    blank(): void {
        if (this.isJson) return;
        this.print('');
    }

    push(options: INotify) {
        const isWarning = options.type === 'warning';
        const prefixStr = isWarning ? bold(yellow('Warning:')) : bold(red('Error:'));
        const lineColor = isWarning ? yellow : red;
        const title = bold(options.title);
        const close = options.close ?? false;

        if (this.isJson) {
            this.emitJson(options.type === 'warning' ? "warn" : "error", options.title, { detail: options.detail, extra: options.extra });
            if (close) throw new TestformError(options.title);
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

        if (close) throw new TestformError(options.title);
    }

    refresh(resourceId: string, remoteId?: string) {
        if (this.isJson) return;
        const state = remoteId ? dim(`[id=${remoteId}]`) : '';
        this.print(`${cyan(resourceId)}: Refreshing state... ${state}`);
    }

}

export const logger = new Logger();