import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TITLE_CLI } from '../core/const';
import { logger } from '../core/logger';

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
        logger.warn('No .feature files found to format.');
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
                if (check) {
                    logger.warn(file);
                } else {
                    logger.success(file);
                }
            }
        }
    }

    if (check) {
        if (unformattedCount > 0) {
            logger.warn(`\n${unformattedCount} file(s) would be reformatted.`);
            process.exit(3); // fmt -check returns 3 if unformatted
        } else {
            logger.success('All files are formatted correctly.');
        }
    }
};

function findFeatureFiles(dir: string, recursive: boolean): string[] {
    try {
        const stat = statSync(dir);
        if (stat.isFile() && dir.endsWith('.feature')) {
            return [dir];
        }
        if (stat.isDirectory()) {
            // Ignore node_modules and .git
            if (dir.includes('node_modules') || dir.includes('.git')) return [];

            const entries = readdirSync(dir, { withFileTypes: true });
            const result: string[] = [];
            for (const entry of entries) {
                const filePath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (recursive) {
                        result.push(...findFeatureFiles(filePath, recursive));
                    }
                } else if (entry.name.endsWith('.feature')) {
                    result.push(filePath);
                }
            }
            return result;
        }
        return [];
    } catch (e) {
        return [];
    }
}

function formatGherkin(content: string): string {
    const lines = content.split('\n');
    const output: string[] = [];
    
    let expectedIndent = 0;
    let inDocString = false;
    let docStringIndent = 0;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Handle docstrings
        if (line.trim().startsWith('"""') || line.trim().startsWith('```')) {
            if (!inDocString) {
                inDocString = true;
                docStringIndent = 6;
                output.push(' '.repeat(docStringIndent) + line.trim());
            } else {
                inDocString = false;
                output.push(' '.repeat(docStringIndent) + line.trim());
            }
            continue;
        }
        
        if (inDocString) {
            output.push(line); // Keep docstring content as is
            continue;
        }
        
        let trimmed = line.trim();
        
        if (trimmed === '') {
            // Only add empty line if the previous line wasn't empty
            if (output.length > 0 && output[output.length - 1] !== '') {
                output.push('');
            }
            continue;
        }

        // Determine indentation based on keyword
        if (trimmed.startsWith('Feature:')) {
            expectedIndent = 0;
        } else if (trimmed.startsWith('Rule:') || trimmed.startsWith('Background:') || trimmed.startsWith('Scenario:') || trimmed.startsWith('Scenario Outline:') || trimmed.startsWith('Example:')) {
            expectedIndent = 2;
            // Add blank line before these blocks if needed
            if (output.length > 0 && output[output.length - 1] !== '' && !output[output.length - 1].trim().startsWith('@')) {
                output.push('');
            }
        } else if (trimmed.startsWith('Given ') || trimmed.startsWith('When ') || trimmed.startsWith('Then ') || trimmed.startsWith('And ') || trimmed.startsWith('But ') || trimmed.startsWith('* ')) {
            expectedIndent = 4;
        } else if (trimmed.startsWith('Examples:')) {
            expectedIndent = 4;
            if (output.length > 0 && output[output.length - 1] !== '') {
                output.push('');
            }
        } else if (trimmed.startsWith('|')) {
            expectedIndent = 6;
        } else if (trimmed.startsWith('@')) {
            // Tags go with the next element, so we peek ahead to see what it is
            let nextIndent = 0;
            for (let j = i + 1; j < lines.length; j++) {
                let nextTrimmed = lines[j].trim();
                if (nextTrimmed === '' || nextTrimmed.startsWith('@')) continue;
                if (nextTrimmed.startsWith('Feature:')) nextIndent = 0;
                else if (nextTrimmed.startsWith('Rule:') || nextTrimmed.startsWith('Background:') || nextTrimmed.startsWith('Scenario:') || nextTrimmed.startsWith('Scenario Outline:')) nextIndent = 2;
                else if (nextTrimmed.startsWith('Examples:')) nextIndent = 4;
                break;
            }
            expectedIndent = nextIndent;
            
            if (output.length > 0 && output[output.length - 1] !== '') {
                output.push('');
            }
        } else if (trimmed.startsWith('#')) {
            // Comments preserve expected indent
        } else {
            // Continuation of text (e.g. feature description)
            if (expectedIndent === 0) expectedIndent = 2; // Feature description
        }

        output.push(' '.repeat(expectedIndent) + trimmed);
    }
    
    // Ensure trailing newline
    if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
    }

    return output.join('\n');
}
