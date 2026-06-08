import { join, dirname } from 'path';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { Config } from '../core/config';
import { IScope } from '../core/types';
import { logger } from '../core/logger';

interface GenerateCmdOptions {
    dir: string;
    scope: IScope;
    title?: string;
    rules?: string[];
}

function findFeatures(dirPath: string): string[] {
    const result: string[] = [];
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    result.push(...findFeatures(fullPath));
                }
            } else if (entry.name.endsWith('.feature')) {
                result.push(fullPath);
            }
        }
} catch (e) { }
    return result;
}

function findNextIdentity(dirPath: string, pattern: string): string | null {
    if (!pattern.includes('*')) return null;
    
    const prefix = pattern.split('*')[0].replace(/^@/, '');
    const suffix = pattern.split('*')[1] || '';
    
    const regex = new RegExp(`@${prefix}(\\d+)${suffix}\\b`, 'g');
    let max = 0;
    
    const allFeatures = findFeatures(dirPath);
    for (const file of allFeatures) {
        const content = require('fs').readFileSync(file, 'utf-8');
        let match;
        while ((match = regex.exec(content)) !== null) {
            const num = parseInt(match[1], 10);
            if (num > max) max = num;
        }
    }
    
    return `@${prefix}${max + 1}${suffix}`;
}

export const generateCmd = async (options: GenerateCmdOptions) => {
    const { dir, scope, title } = options;
    const config = new Config(dir);

    const convention = config.getConvention(scope);
    const identityPattern = config.getIdentity(scope);
    
    const scopeExt = scope.replace('test', ''); // e.g., 'run', 'case', 'plan'

    // Default directory is the root if not specified in convention
    const outDir = convention?.directory || '';

    const fileTpl = convention?.filename || `{YYYYMMDD}_{HHmmss}.${scopeExt}.feature`;

    const now = new Date();
    const YYYYMMDD = now.toISOString().split('T')[0].replace(/-/g, '');
    const HHmmss = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const timestamp = now.getTime().toString();

    let generatedTitle = title;
    let slug = '';

    if (generatedTitle) {
        slug = generatedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    let filename = fileTpl
        .replace(/{YYYYMMDD}/g, YYYYMMDD)
        .replace(/{HHmmss}/g, HHmmss)
        .replace(/{timestamp}/g, timestamp)
        .replace(/{slug}/g, slug);

    // Clean up any stray underscores or hyphens left by an empty slug (e.g. "_.run.feature" -> ".run.feature")
    // or "_2026.run.feature" -> "2026.run.feature"
    filename = filename.replace(/^[_\-]+/, '').replace(/[_\-]+(\.)/g, '$1');

    // Generate a short 6-character random hash for unique identity
    const shortHash = Math.random().toString(16).substring(2, 8);

    // Always resolve the extension to .feature and inject the hash before the scope extension
    if (filename.endsWith('.feature')) {
        // If they already included .feature in the template, we inject the hash before the extension
        if (filename.endsWith(`.${scopeExt}.feature`)) {
            filename = filename.replace(`.${scopeExt}.feature`, `_${shortHash}.${scopeExt}.feature`);
        } else {
            filename = filename.replace(`.feature`, `_${shortHash}.feature`);
        }
    } else {
        // If it doesn't end with .feature, append hash then extension
        if (filename.endsWith(`.${scopeExt}`)) {
            filename = filename.replace(`.${scopeExt}`, `_${shortHash}.${scopeExt}.feature`);
        } else {
            filename += `_${shortHash}.${scopeExt}.feature`;
        }
    }

    // If title was not provided, use the generated filename EXACTLY without .feature
    if (!generatedTitle) {
        generatedTitle = filename.replace(/\.feature$/, '');
    }

    const fullPath = join(dir, outDir, filename);

    if (existsSync(fullPath)) {
        logger.error(`File already exists: ${fullPath}`);
        process.exit(1);
    }

    if (options.rules && options.rules.length > 0) {
        const allFeatures = findFeatures(dir);

        for (const rule of options.rules) {
            const ruleFile = rule.includes('::') ? rule.split('::')[0] : rule;
            const exists = allFeatures.some(f => f.endsWith(ruleFile) || f.includes(ruleFile));

            if (!exists) {
                logger.error([
                    `Not Found`,
                    `The feature file for Rule '${ruleFile}' does not exist in the workspace.`
                ]);
                process.exit(1);
            }
        }
    }

    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
    }

    const nextIdentityTag = (scope === 'testrun' || scope === 'testplan') && identityPattern 
        ? findNextIdentity(dir, identityPattern) 
        : null;
    
    let content = `@${scope}`;
    if (nextIdentityTag) {
        content += ` ${nextIdentityTag}`;
    }
    content += `\nFeature: ${generatedTitle}\n`;

    if (options.rules && options.rules.length > 0) {
        content += `\n`;
        for (const rule of options.rules) {
            content += `  Rule: ${rule}\n`;
        }
    }

    try {
        writeFileSync(fullPath, content, 'utf-8');
        logger.success(`Generated ${scope} file: ${fullPath}`, { bold: true });
    } catch (e: any) {
        logger.error(`Failed to generate file: ${e.message}`);
        process.exit(1);
    }
};
