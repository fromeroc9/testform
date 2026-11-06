import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { resource } from '../core/resources';
import { Logger } from '../core/logger';

const { bold, green, cyan, gray } = chalk;

export interface ResourceCmdOptions {
    dir: string;
    action?: string;
    name?: string;
    json?: boolean;
    verbose?: boolean;
}

export const resourceCmd = async (options: ResourceCmdOptions): Promise<void> => {
    const { dir, action, name, json: isJson, verbose } = options;
    const logger = new Logger(verbose);

    // 1. Auto-discover custom resources from .testform/resources, ./resources, and modules
    await resource.loadCustomResources(dir);

    const subAction = (action || '').toLowerCase().trim();

    // ─── Action: Scaffold New Resource Template ──────────────────────────────
    if (subAction === 'scaffold' || subAction === 'new' || subAction === 'init') {
        const targetName = (name || 'custom_resource').trim().replace(/\.ts$/i, '');
        const targetDir = resolve(dir, '.testform', 'resources');
        if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
        }
        const targetFile = resolve(targetDir, `${targetName}.ts`);
        const varName = targetName.replace(/[^a-zA-Z0-9_]/g, '_');

        const candidateTemplates = [
            resolve(__dirname, '../../templates/resource.template.ts'),
            resolve(__dirname, '../templates/resource.template.ts'),
            resolve(__dirname, 'templates/resource.template.ts'),
            resolve(process.cwd(), 'templates/resource.template.ts')
        ];
        const templatePath = candidateTemplates.find(p => existsSync(p));

        let content = '';
        if (templatePath && existsSync(templatePath)) {
            content = readFileSync(templatePath, 'utf-8')
                .replace(/\{\{RESOURCE_TYPE\}\}/g, targetName)
                .replace(/\{\{RESOURCE_VAR\}\}/g, varName);
        } else {
            content = `import { ResourceTemplate, ParserScenario } from '@fromeroc9/testform';

export const ${varName}Resource: ResourceTemplate = {
    type: "${targetName}",
    attributes: (scenario: ParserScenario) => ({
        title: scenario.name,
        description: scenario.description,
        tags: scenario.tags,
        ...scenario.custom?.fields
    }),
    state: {
        status: (scenario: ParserScenario) => scenario.custom?.fields?.status || 'active',
        synced_at: () => new Date().toISOString()
    }
};

export default ${varName}Resource;
`;
        }

        writeFileSync(targetFile, content, 'utf-8');
        if (isJson) {
            console.log(JSON.stringify({ scaffold: targetName, path: targetFile }));
        } else {
            console.log(green(`\n✔ Successfully scaffolded custom resource template at:`));
            console.log(bold(`  ${targetFile}\n`));
            console.log(`Resource type: ${cyan(targetName)}`);
            console.log(gray(`Edit the file to customize attributes, state fields, and lifecycle hooks.\n`));
        }
        return;
    }

    // ─── Action: Show Single Resource ────────────────────────────────────────
    if (subAction === 'show' || (subAction && !['list', 'scaffold', 'new', 'init'].includes(subAction) && !name)) {
        const targetType = name || action;
        const template = targetType ? resource.findTemplate(targetType) : undefined;
        if (!template) {
            logger.error(`Error: Resource type "${targetType}" was not found.`);
            process.exit(1);
        }

        if (isJson) {
            console.log(JSON.stringify(template, null, 2));
            return;
        }

        console.log('');
        console.log(bold(`Resource Template: ${cyan(template.type)}`));
        console.log(`  ${bold('Type:')}        ${template.type}`);
        console.log(`  ${bold('Attributes:')}  ${template.attributes ? (typeof template.attributes === 'function' ? 'function(scenario, context)' : Object.keys(template.attributes).join(', ')) : '(default)'}`);
        console.log(`  ${bold('State:')}       ${template.state ? Object.keys(template.state).join(', ') : '(default)'}`);
        console.log(`  ${bold('Lifecycle:')}   ${template.lifecycle ? Object.keys(template.lifecycle).join(', ') : 'none'}`);
        console.log('');
        return;
    }

    // ─── Action: List Resources (Default) ────────────────────────────────────
    const registered = resource.getRegisteredTypes().sort();

    if (isJson) {
        console.log(JSON.stringify(registered, null, 2));
        return;
    }

    if (registered.length === 0) {
        console.log(gray('\nNo resource templates registered in workspace.\n'));
        return;
    }

    console.log('');
    console.log(bold('REGISTERED RESOURCE TEMPLATES'));
    console.log(gray('─'.repeat(40)));
    for (const rType of registered) {
        const t = resource.findTemplate(rType);
        const hasLifecycle = t?.lifecycle ? chalk.green(' [lifecycle hooks]') : '';
        console.log(`  • ${cyan(rType.padEnd(28))}${hasLifecycle}`);
    }
    console.log('');
    console.log(gray(`Use '${bold('testform providers resource scaffold <name>')}' to generate a new template.`));
    console.log('');
};
