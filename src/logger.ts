import { cyan, green, yellow, red, gray, bold, dim } from 'chalk';
import { LogLevel, LogOptions } from './types';

export class Logger {
    private verbose: boolean = false;
    private isJson: boolean = false;

    constructor(verbose: boolean = false, isJson: boolean = false) {
        this.verbose = verbose;
        this.isJson = isJson;
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
        console.log(`${prefix}${gray(styledMsg)}`);
        if (options?.data) console.log(gray(JSON.stringify(options.data, null, 2)));
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
        console.log(`${prefix}${styledMsg}`);
        if (options?.data && this.verbose) console.log(gray(JSON.stringify(options.data, null, 2)));
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
        console.log(`${prefix}${styledMsg}`);
        if (options?.data && this.verbose) console.log(gray(JSON.stringify(options.data, null, 2)));
    }

    warn(message: string | string[], options?: LogOptions): void {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("warn", msgStr, options?.data);
            return;
        }
        console.error(yellow('╷'));
        const prefix = bold(yellow('Warning:'));
        const styledMsg = this.applyStyle(msgStr, options);
        console.error(`${yellow('│')} ${prefix} ${styledMsg}`);

        if (options?.data && this.verbose) {
            console.error(yellow('│'));
            const dataStr = JSON.stringify(options.data, null, 2);
            dataStr.split('\n').forEach(line => console.error(`${yellow('│')}   ${line}`));
        }
        console.error(yellow('╵'));
    }

    error(message: string | string[], error?: Error | any): void {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("error", msgStr, error ? (error instanceof Error ? error.stack : error) : undefined);
            process.exit(1);
            return;
        }
        console.error(red('╷'));
        const prefix = bold(red('Error:'));

        const lines = msgStr.split('\n');
        console.error(`${red('│')} ${prefix} ${bold(lines[0])}`);
        for (let i = 1; i < lines.length; i++) {
            console.error(`${red('│')} ${lines[i]}`);
        }

        if (error) {
            console.error(red('│'));
            if (error instanceof Error) {
                console.error(`${red('│')}   ${error.message}`);
                if (this.verbose && error.stack) {
                    error.stack.split('\n').forEach(line => console.error(`${red('│')}   ${dim(line)}`));
                }
            } else if (typeof error === 'object') {
                const str = JSON.stringify(error, null, 2);
                str.split('\n').forEach(line => console.error(`${red('│')}   ${line}`));
            } else {
                console.error(`${red('│')}   ${String(error)}`);
            }
        }
        console.error(red('╵'));
        process.exit(1);
    }

    blank(): void {
        if (this.isJson) return;
        console.log('');
    }
}

export const logger = new Logger();