import { readFileSync, writeFileSync } from 'fs';
import { red, green } from 'chalk';
import { logger } from '../core/logger';
import { findFeatureFiles, formatGherkin } from '../core/editor';

interface FmtCmdOptions {
    dir?: string;
    check?: boolean;
    diff?: boolean;
    list?: boolean;
    write?: boolean;
    recursive?: boolean;
}

function printUnifiedDiff(filePath: string, original: string, formatted: string): void {
    console.log(`--- ${filePath}`);
    console.log(`+++ ${filePath}`);
    const origLines = original.split('\n');
    const formLines = formatted.split('\n');
    const max = Math.max(origLines.length, formLines.length);
    for (let i = 0; i < max; i++) {
        const o = origLines[i];
        const f = formLines[i];
        if (o !== f) {
            if (o !== undefined) console.log(red(`-${o}`));
            if (f !== undefined) console.log(green(`+${f}`));
        }
    }
}

export const fmtCmd = async (options: FmtCmdOptions) => {
    const {
        dir = '.',
        check = false,
        diff = false,
        list = true,
        write = true,
        recursive = false
    } = options;
    const files = findFeatureFiles(dir, recursive);
    if (files.length === 0) {
        console.log('No .feature files found.');
        return;
    }

    let unformattedCount = 0;

    for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const formatted = formatGherkin(content);

        if (content !== formatted) {
            unformattedCount++;
            if (diff) {
                printUnifiedDiff(file, content, formatted);
            } else if (!check && write) {
                writeFileSync(file, formatted, 'utf8');
            }
            if (list && !diff) {
                console.log(file);
            }
        }
    }

    if (check) {
        if (unformattedCount > 0) {
            console.log(`\n${unformattedCount} file(s) would be reformatted.`);
            process.exit(3); // fmt -check returns 3 if unformatted
        } else {
            logger.success('All files are formatted correctly.');
        }
    }
};
