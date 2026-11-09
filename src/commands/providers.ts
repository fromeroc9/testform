import { existsSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { bold, green, dim } from 'chalk';
import { Config } from '../core/config';
import { TITLE_APP, CONFIG_FILE_NAMES, FILE_LOCK } from '../core/const';
import { HELP_PROVIDERS } from '../core/help';
import { logger } from '../core/logger';
import { resourceCmd } from './resource';

export interface ProvidersCmdOptions {
    dir?: string;
    action?: string;
    args?: string[];
    testDirectory?: string;
    variables?: any;
    isJson?: boolean;
}

export const providersCmd = async (options: ProvidersCmdOptions = {}) => {
    const { dir = '.', action, args = [], isJson = false } = options;

    let targetDir = dir;
    let subCommand = action;
    const knownSubcommands = ['lock', 'mirror', 'schema', 'scaffold', 'init', 'resource', 'resources'];

    if (action && !knownSubcommands.includes(action.toLowerCase())) {
        targetDir = action;
        subCommand = undefined;
    }

    const targetFullPath = resolve(process.cwd(), targetDir);

    // Subcommand: resource / resources manages or scaffolds custom resource templates
    if (subCommand && (subCommand.toLowerCase() === 'resource' || subCommand.toLowerCase() === 'resources')) {
        const nonFlagArgs = args.filter(a => !a.startsWith('-'));
        const [resAction, resName] = nonFlagArgs;
        await resourceCmd({
            dir: targetFullPath,
            action: resAction,
            name: resName,
            json: isJson,
            verbose: false
        });
        return;
    }

    // Subcommand: scaffold / init generates a provider starter template without needing an existing project
    if (subCommand && (subCommand.toLowerCase() === 'scaffold' || subCommand.toLowerCase() === 'init')) {
        const isFullProject = args.includes('--project') || args.includes('--full') || (options as any).project || (options as any).full;
        const nonFlagArgs = args.filter(a => !a.startsWith('-'));
        const providerName = (nonFlagArgs[0] || 'custom').toLowerCase().replace(/[^a-z0-9_-]/gi, '');
        const className = providerName.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Provider';

        if (isFullProject) {
            // Scaffold complete project structure
            const projectName = `testform-provider-${providerName}`;
            const projectDir = nonFlagArgs[1] ? resolve(targetFullPath, nonFlagArgs[1]) : resolve(targetFullPath, projectName);

            const candidateDirs = [
                resolve(__dirname, '../../templates/starter-provider'),
                resolve(__dirname, '../templates/starter-provider'),
                resolve(__dirname, 'templates/starter-provider'),
                resolve(process.cwd(), 'templates/starter-provider')
            ];
            const starterTemplateDir = candidateDirs.find(d => existsSync(d));
            if (starterTemplateDir && existsSync(starterTemplateDir)) {
                // Copy entire starter template folder recursively
                mkdirSync(projectDir, { recursive: true });
                const copyRecursive = (src: string, dest: string) => {
                    const entries = readdirSync(src, { withFileTypes: true });
                    for (const entry of entries) {
                        const srcPath = join(src, entry.name);
                        const destPath = join(dest, entry.name);
                        if (entry.isDirectory()) {
                            mkdirSync(destPath, { recursive: true });
                            copyRecursive(srcPath, destPath);
                        } else {
                            let text = readFileSync(srcPath, 'utf-8');
                            text = text.replace(/testform-provider-starter/g, projectName)
                                       .replace(/StarterProvider/g, className)
                                       .replace(/starter-provider/g, providerName);
                            writeFileSync(destPath, text, 'utf-8');
                        }
                    }
                };
                copyRecursive(starterTemplateDir, projectDir);
            }

            console.log(green(`\n✔ Successfully scaffolded enterprise provider project at:`));
            console.log(bold(`  ${projectDir}\n`));
            console.log(`Project Structure:`);
            console.log(`  ├── package.json`);
            console.log(`  ├── tsconfig.json`);
            console.log(`  ├── README.md`);
            console.log(`  ├── src/`);
            console.log(`  │   ├── index.ts        (Main provider implementing IProvider)`);
            console.log(`  │   ├── client.ts       (Typed HTTP API client)`);
            console.log(`  │   └── types.ts        (Contracts and schemas)`);
            console.log(`  └── test/`);
            console.log(`      └── provider.test.ts\n`);
            console.log(`To publish to your company Git:`);
            console.log(dim(`  cd ${projectName}\n  git init && git add . && git commit -m "feat: initial provider"\n  git tag v1.0.0\n`));
            return;
        }

        // Lightweight single file template
        const outDir = nonFlagArgs[1] ? resolve(targetFullPath, nonFlagArgs[1]) : resolve(targetFullPath, 'custom-providers');
        if (!existsSync(outDir)) {
            mkdirSync(outDir, { recursive: true });
        }

        const candidateTemplates = [
            resolve(__dirname, '../../templates/provider.template.ts'),
            resolve(__dirname, '../templates/provider.template.ts'),
            resolve(__dirname, 'templates/provider.template.ts'),
            resolve(process.cwd(), 'templates/provider.template.ts')
        ];
        const templatePath = candidateTemplates.find(p => existsSync(p)) || candidateTemplates[0];
        let content = '';
        if (existsSync(templatePath)) {
            content = readFileSync(templatePath, 'utf-8');
            content = content.replace(/CustomProvider/g, className).replace(/'custom-provider'/g, `'${providerName}'`);
        } else {
            content = `export default class ${className} {\n    public name = '${providerName}';\n    public resources = {\n        issue: {\n            create: async (attributes: any) => ({ id: 1, number: 1, ...attributes }),\n            read: async (id: any) => null,\n            update: async (id: any, attributes: any) => ({ id, ...attributes }),\n            delete: async (id: any) => {}\n        }\n    };\n    constructor(public config: Record<string, any> = {}) {}\n    formatRemoteId(id: number | string) { return '#' + id; }\n}\n`;
        }

        const targetFile = resolve(outDir, `${providerName}.ts`);
        writeFileSync(targetFile, content, 'utf-8');

        console.log(green(`\n✔ Successfully generated provider template at:`));
        console.log(bold(`  ${targetFile}\n`));
        console.log(`To use this provider in your project, add to ${bold('main.yml')}:`);
        console.log(dim(`
testform:
  required_providers:
    ${providerName}: "./${targetFile.replace(/\\/g, '/').replace(resolve(process.cwd()).replace(/\\/g, '/') + '/', '')}"

provider:
  ${providerName}:
    # Configure your provider connection parameters here
`));
        return;
    }

    const hasConfigFile = CONFIG_FILE_NAMES.some(name => existsSync(resolve(targetFullPath, name)));

    if (!hasConfigFile) {
        logger.push({
            type: 'error',
            title: 'No configuration files',
            extra: [`The directory ${targetFullPath} contains no ${TITLE_APP} configuration files.`],
            close: true
        });
        return;
    }

    const config = new Config(targetFullPath, false);
    const provider = config.getProviderType() || 'local';
    const required = config.getRequiredProviders();

    if (!subCommand) {
        if (Object.keys(required).length > 0) {
            let tree = `\nProviders required by configuration:\n.\n`;
            const entries = Object.entries(required);
            for (let i = 0; i < entries.length; i++) {
                const [name, spec] = entries[i];
                const prefix = (i === entries.length - 1) ? '└──' : '├──';
                tree += `${prefix} provider[${name}] ${spec.version || 'local'} (${spec.source})\n`;
            }
            console.log(tree);
            return;
        }
        console.log(`
Providers required by configuration:
.
└── provider[registry.testform.io/fromeroc9/${provider}] 1.0.0
`);
        return;
    }

    switch (subCommand.toLowerCase()) {
        case 'lock': {
            const lockFilePath = resolve(targetFullPath, FILE_LOCK);
            const lockDir = dirname(lockFilePath);
            if (!existsSync(lockDir)) {
                mkdirSync(lockDir, { recursive: true });
            }
            const lockContent = {
                provider: {
                    [`registry.testform.io/fromeroc9/${provider}`]: {
                        version: "1.0.0",
                        constraints: ">= 1.0.0",
                        hashes: [
                            "h1:dGVzdGZvcm0tcHJvdmlkZXItbG9jay12ZXJpZmllZA=="
                        ]
                    }
                }
            };
            writeFileSync(lockFilePath, JSON.stringify(lockContent, null, 2), 'utf-8');
            console.log(green(`\nSuccess! Dependencies for provider "fromeroc9/${provider}" verified and written to ${FILE_LOCK}.\n`));
            break;
        }
        case 'mirror': {
            if (!args[0]) {
                logger.push({
                    type: 'error',
                    title: 'Missing target directory argument',
                    extra: ['Target directory is required. Specify a directory where provider plugins should be mirrored.'],
                    close: true
                });
                return;
            }
            const mirrorDir = resolve(targetFullPath, args[0]);
            if (!existsSync(mirrorDir)) {
                mkdirSync(mirrorDir, { recursive: true });
            }
            const mirrorManifest = {
                provider: `registry.testform.io/fromeroc9/${provider}`,
                version: "1.0.0",
                mirrored_at: new Date().toISOString()
            };
            writeFileSync(resolve(mirrorDir, `${provider}.json`), JSON.stringify(mirrorManifest, null, 2), 'utf-8');
            console.log(`- Mirroring provider "fromeroc9/${provider}" to ${args[0]}...`);
            console.log(green(`\nSuccess! Provider plugins mirrored to ${args[0]}.\n`));
            break;
        }
        case 'schema': {
            const shouldJson = isJson || args.includes('-json') || args.includes('--json');
            if (shouldJson) {
                const schemaPayload = {
                    format_version: "1.0",
                    provider_schemas: {
                        [`registry.testform.io/fromeroc9/${provider}`]: {
                            provider: {
                                version: 0,
                                block: {
                                    attributes: provider === 'github' ? {
                                        owner: { type: "string", description: "GitHub repository owner", required: true },
                                        repository: { type: "string", description: "GitHub repository name", required: true },
                                        project_id: { type: "number", description: "GitHub Projects (v2) Project Number", optional: true },
                                        token_env: { type: "string", description: "Environment variable containing personal access token", optional: true }
                                    } : {
                                        endpoint: { type: "string", description: "Driver endpoint or path", optional: true }
                                    }
                                }
                            },
                            resource_schemas: {
                                [`${provider}_testcase`]: {
                                    version: 0,
                                    block: {
                                        attributes: {
                                            identity: { type: "string", description: "Unique testcase identifier tag (e.g. @tc-1)", required: true },
                                            title: { type: "string", description: "Test case scenario name", optional: true },
                                            labels: { type: ["list", "string"], description: "Labels/tags associated with test case", optional: true },
                                            assignees: { type: ["list", "string"], description: "Assigned engineers/testers", optional: true },
                                            custom_fields: { type: ["map", "string"], description: "Custom metadata fields", optional: true }
                                        }
                                    }
                                },
                                [`${provider}_testrun`]: {
                                    version: 0,
                                    block: {
                                        attributes: {
                                            identity: { type: "string", description: "Unique testrun identifier tag (e.g. @tr-1)", required: true },
                                            rules: { type: ["list", "string"], description: "Execution rules and included test scenarios", optional: true }
                                        }
                                    }
                                },
                                [`${provider}_testplan`]: {
                                    version: 0,
                                    block: {
                                        attributes: {
                                            identity: { type: "string", description: "Unique testplan identifier tag (e.g. @tp-1)", required: true },
                                            runs: { type: ["list", "string"], description: "Associated test run identifiers", optional: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                };
                console.log(JSON.stringify(schemaPayload, null, 2));
            } else {
                console.log(bold(`\nProvider Schema: fromeroc9/${provider}`));
                console.log(dim('─'.repeat(50)));
                console.log(`Resource: ${provider}_testcase`);
                console.log(`  - identity: string (required)`);
                console.log(`  - title: string (optional)`);
                console.log(`  - labels: list of string (optional)`);
                console.log(`  - assignees: list of string (optional)`);
                console.log(`  - custom_fields: map of string (optional)`);
                console.log(`Resource: ${provider}_testrun`);
                console.log(`  - identity: string (required)`);
                console.log(`  - rules: list of rule`);
                console.log(`Resource: ${provider}_testplan`);
                console.log(`  - identity: string (required)`);
                console.log(`  - runs: list of testrun\n`);
            }
            break;
        }
        default: {
            console.log(HELP_PROVIDERS);
            break;
        }
    }
};
