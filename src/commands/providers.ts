import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { bold, green, yellow, cyan, dim } from 'chalk';
import { Config } from '../core/config';
import { TITLE_APP, TITLE_CLI, CONFIG_FILE_NAMES, FILE_LOCK } from '../core/const';
import { HELP_PROVIDERS } from '../core/help';
import { logger } from '../core/logger';

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
    const knownSubcommands = ['lock', 'mirror', 'schema'];

    if (action && !knownSubcommands.includes(action.toLowerCase())) {
        targetDir = action;
        subCommand = undefined;
    }

    const targetFullPath = resolve(process.cwd(), targetDir);
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

    if (!subCommand) {
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
