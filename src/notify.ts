import { yellow, red, cyan, dim, bold } from 'chalk';
import { INotify } from './types';

class Notify {

    push(options: INotify) {
        const isWarning = options.type === 'warning';
        const prefix = isWarning ? bold(yellow('Warning:')) : bold(red('Error:'));
        const lineColor = isWarning ? yellow : red;
        const title = bold(options.title);
        const close = options.close ?? false

        console.log(lineColor('╷'));
        console.log(`${lineColor('│')} ${prefix} ${title}`);
        console.log(lineColor('│'));

        if (options.detail) {
            const detailLines = options.detail
            for (const line of detailLines) {
                console.log(`${lineColor('│')}   ${line}`);
            }
        }

        if (options.extra) {
            const extraLines = options.extra
            for (const line of extraLines) {
                console.log(`${lineColor('│')} ${line}`);
            }
        }

        console.log(lineColor('╵'));

        if (close) process.exit(1)
    }

    refresh(resourceId: string, remoteId?: string) {
        const state = remoteId ? dim(`[id=${remoteId}]`) : '';
        console.log(`${cyan(resourceId)}: Refreshing state... ${state}`);
    }
}
export const notify = new Notify()