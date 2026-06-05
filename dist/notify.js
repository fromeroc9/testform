"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = void 0;
const chalk_1 = require("chalk");
class Notify {
    push(options) {
        const isWarning = options.type === 'warning';
        const prefix = isWarning ? (0, chalk_1.bold)((0, chalk_1.yellow)('Warning:')) : (0, chalk_1.bold)((0, chalk_1.red)('Error:'));
        const lineColor = isWarning ? chalk_1.yellow : chalk_1.red;
        const title = (0, chalk_1.bold)(options.title);
        const close = options.close ?? false;
        console.log(lineColor('╷'));
        console.log(`${lineColor('│')} ${prefix} ${title}`);
        console.log(lineColor('│'));
        if (options.detail) {
            const detailLines = options.detail;
            for (const line of detailLines) {
                console.log(`${lineColor('│')}   ${line}`);
            }
        }
        if (options.extra) {
            const extraLines = options.extra;
            for (const line of extraLines) {
                console.log(`${lineColor('│')} ${line}`);
            }
        }
        console.log(lineColor('╵'));
        if (close)
            process.exit(1);
    }
    refresh(resourceId, remoteId) {
        const state = remoteId ? (0, chalk_1.dim)(`[id=${remoteId}]`) : '';
        console.log(`${(0, chalk_1.cyan)(resourceId)}: Refreshing state... ${state}`);
    }
}
exports.notify = new Notify();
