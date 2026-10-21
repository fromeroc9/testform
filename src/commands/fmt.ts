import { readFileSync, writeFileSync } from 'fs';
import { logger } from '../core/logger';
import { findFeatureFiles, formatGherkin } from '../core/editor';

interface FmtCmdOptions {
    dir?: string;
    check?: boolean;
    list?: boolean;
    write?: boolean;
    recursive?: boolean;
}

export const fmtCmd = async (options: FmtCmdOptions) => {
    const {
        dir = '.',
        check = false,
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
            if (!check && write) {
                writeFileSync(file, formatted, 'utf8');
            }
            if (list) {
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
