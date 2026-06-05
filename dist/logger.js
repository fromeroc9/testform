"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = void 0;
const chalk_1 = require("chalk");
class Logger {
    verbose = false;
    isJson = false;
    constructor(verbose = false, isJson = false) {
        this.verbose = verbose;
        this.isJson = isJson;
    }
    applyStyle(text, options) {
        let styled = text;
        if (options?.bold)
            styled = (0, chalk_1.bold)(styled);
        if (options?.dim)
            styled = (0, chalk_1.dim)(styled);
        return styled;
    }
    emitJson(level, message, data) {
        const payload = {
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
    formatMessage(message) {
        return Array.isArray(message) ? message.join('\n') : message;
    }
    debug(message, options) {
        if (!this.verbose)
            return;
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("debug", msgStr, options?.data);
            return;
        }
        const showPrefix = options?.prefix !== false;
        const prefix = showPrefix ? (0, chalk_1.dim)(`[DEBUG] `) : '';
        const styledMsg = this.applyStyle(msgStr, options);
        console.log(`${prefix}${(0, chalk_1.gray)(styledMsg)}`);
        if (options?.data)
            console.log((0, chalk_1.gray)(JSON.stringify(options.data, null, 2)));
    }
    info(message, options) {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("info", msgStr, options?.data);
            return;
        }
        const showPrefix = options?.prefix === true; // No prefix by default
        const prefix = showPrefix ? (0, chalk_1.cyan)(`[INFO] `) : '';
        const styledMsg = this.applyStyle(msgStr, options);
        console.log(`${prefix}${styledMsg}`);
        if (options?.data && this.verbose)
            console.log((0, chalk_1.gray)(JSON.stringify(options.data, null, 2)));
    }
    success(message, options) {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("info", msgStr, options?.data);
            return;
        }
        const showPrefix = options?.prefix === true; // No prefix by default
        const prefix = showPrefix ? (0, chalk_1.green)(`[✓] `) : '';
        const styledMsg = this.applyStyle((0, chalk_1.green)(msgStr), options);
        console.log(`${prefix}${styledMsg}`);
        if (options?.data && this.verbose)
            console.log((0, chalk_1.gray)(JSON.stringify(options.data, null, 2)));
    }
    warn(message, options) {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("warn", msgStr, options?.data);
            return;
        }
        console.error((0, chalk_1.yellow)('╷'));
        const prefix = (0, chalk_1.bold)((0, chalk_1.yellow)('Warning:'));
        const styledMsg = this.applyStyle(msgStr, options);
        console.error(`${(0, chalk_1.yellow)('│')} ${prefix} ${styledMsg}`);
        if (options?.data && this.verbose) {
            console.error((0, chalk_1.yellow)('│'));
            const dataStr = JSON.stringify(options.data, null, 2);
            dataStr.split('\n').forEach(line => console.error(`${(0, chalk_1.yellow)('│')}   ${line}`));
        }
        console.error((0, chalk_1.yellow)('╵'));
    }
    error(message, error) {
        const msgStr = this.formatMessage(message);
        if (this.isJson) {
            this.emitJson("error", msgStr, error ? (error instanceof Error ? error.stack : error) : undefined);
            process.exit(1);
            return;
        }
        console.error((0, chalk_1.red)('╷'));
        const prefix = (0, chalk_1.bold)((0, chalk_1.red)('Error:'));
        const lines = msgStr.split('\n');
        console.error(`${(0, chalk_1.red)('│')} ${prefix} ${(0, chalk_1.bold)(lines[0])}`);
        for (let i = 1; i < lines.length; i++) {
            console.error(`${(0, chalk_1.red)('│')} ${lines[i]}`);
        }
        if (error) {
            console.error((0, chalk_1.red)('│'));
            if (error instanceof Error) {
                console.error(`${(0, chalk_1.red)('│')}   ${error.message}`);
                if (this.verbose && error.stack) {
                    error.stack.split('\n').forEach(line => console.error(`${(0, chalk_1.red)('│')}   ${(0, chalk_1.dim)(line)}`));
                }
            }
            else if (typeof error === 'object') {
                const str = JSON.stringify(error, null, 2);
                str.split('\n').forEach(line => console.error(`${(0, chalk_1.red)('│')}   ${line}`));
            }
            else {
                console.error(`${(0, chalk_1.red)('│')}   ${String(error)}`);
            }
        }
        console.error((0, chalk_1.red)('╵'));
        process.exit(1);
    }
    blank() {
        if (this.isJson)
            return;
        console.log('');
    }
}
exports.Logger = Logger;
exports.logger = new Logger();
