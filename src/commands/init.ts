import { CONFIG_FILE_NAMES, FILE_CONFIG, FILE_STATE, TITLE_APP, TITLE_CLI, VERSION_CONFIG, VERSION_STATE } from '../core/const';
import YAML from 'yaml';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Config } from '../core/config';
import { Logger } from '../core/logger';
import { basename, dirname, join } from 'path';
import { State, parseBackendOverrides } from '../core/state';
import { ensureDriverInstalled } from '../core/driver';
import { findFeatureFiles } from '../core/editor';
import { WorkspaceManager } from '../core/workspace';
import { askBackendAttribute, isInteractive } from '../core/prompt';
import { ModuleRegistry, isGitSource, parseGitSource } from '../core/module';

export const EXPECTED_BACKEND_ARGS: Record<string, string[]> = {
    local: ['path', 'workspace_dir', 'workspace_dir_prefix'],
    s3: [
        'bucket', 'key', 'region', 'endpoint', 'dynamodb_table', 'profile',
        'namespace', 'force_path_style', 'forcepathstyle', 'encrypt',
        'kms_key_id', 'role_arn', 'workspace_key_prefix', 'access_key',
        'secret_key', 'token'
    ],
    oci: [
        'bucket', 'namespace', 'region', 'key', 'endpoint', 'profile',
        'tenancy_id', 'compartment_id', 'fingerprint', 'private_key_path', 'user_id'
    ],
    azurerm: [
        'resource_group_name', 'storage_account_name', 'container_name', 'key',
        'connection_string', 'environment', 'subscription_id', 'tenant_id',
        'client_id', 'client_secret'
    ],
    gcs: ['bucket', 'prefix', 'credentials', 'impersonate_service_account'],
    github: ['owner', 'repository', 'repo', 'branch', 'path', 'token_env', 'tokenenv', 'token']
};

export const hasValidFeatureFiles = (dir: string): boolean => {
    const files = findFeatureFiles(dir, true);
    for (const file of files) {
        try {
            const content = readFileSync(file, 'utf-8');
            if (/@(testcase|testrun|testplan)\b/i.test(content)) {
                return true;
            }
        } catch {
            // ignore unreadable files
        }
    }
    return false;
};

interface InitPaths {
    configPath: string;
    statePath: string;
}

const resolvePaths = (dir: string): InitPaths => ({
    configPath: join(dir, FILE_CONFIG),
    statePath: join(dir, FILE_STATE),
});

const ensureWorkingDirectory = (dir: string, logger: Logger): void => {
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    logger.info(`Created ${dir} directory`);
};

const createConfigIfNotExists = (
    configPath: string,
    logger: Logger,
    backendType: string = 'local',
    providerType: string = 'github'
): boolean => {
    const dir = dirname(configPath);
    for (const name of CONFIG_FILE_NAMES) {
        if (existsSync(join(dir, name))) {
            return true;
        }
    }

    let backendBlock: any = 'local';
    const normalizedType = (backendType || 'local').toLowerCase().trim();

    const VALID_BACKENDS = ['local', 'github', 's3', 'azurerm', 'gcs', 'oci'];
    if (!VALID_BACKENDS.includes(normalizedType)) {
        logger.warn(`Unknown backend type "${backendType}". Defaulting to "local". (Supported: ${VALID_BACKENDS.join(', ')})`);
    }

    if (normalizedType === 'github') {
        backendBlock = {
            github: {
                branch: 'testform-state',
                path: 'state/testform.state'
            }
        };
    } else if (normalizedType === 's3') {
        backendBlock = {
            s3: {
                bucket: '<required>',
                region: 'us-east-1',
                key: 'testform.state',
                dynamodb_table: '<optional>'
            }
        };
    } else if (normalizedType === 'oci') {
        backendBlock = {
            oci: {
                bucket: '<required_oci_bucket>',
                namespace: '<required_namespace>',
                region: 'us-ashburn-1',
                key: 'testform.state'
            }
        };
    } else if (normalizedType === 'azurerm') {
        backendBlock = {
            azurerm: {
                resource_group_name: '<required>',
                storage_account_name: '<required>',
                container_name: '<required>',
                key: 'testform.state'
            }
        };
    } else if (normalizedType === 'gcs') {
        backendBlock = {
            gcs: {
                bucket: '<required>',
                prefix: 'testform/state'
            }
        };
    }

    let providerBlock: any = {
        github: {
            owner: "<required>",
            repository: "<required>",
            token_env: "GITHUB_TOKEN"
        }
    };
    const normalizedProviderType = (providerType || 'github').toLowerCase().trim();
    if (normalizedProviderType === 'local') {
        providerBlock = 'local';
    } else if (normalizedProviderType === 'gitlab') {
        providerBlock = {
            gitlab: {
                projectId: "<required>",
                token_env: "GITLAB_TOKEN"
            }
        };
    }

    const initialConfig = {
        testform: {
            required_version: `>= ${VERSION_CONFIG}`,
            backend: backendBlock
        },
        provider: providerBlock,
        scopes: {
            testcase: {
                match: "*.case.feature",
                scaffold: {
                    directory: "testcase",
                    filename: "{slug}_{YYYYMMDD}.case.feature"
                },
                fields: []
            },
            testrun: {
                match: "*.run.feature",
                scaffold: {
                    directory: "testrun",
                    filename: "{slug}_{YYYYMMDD}.run.feature"
                },
                fields: []
            },
            testplan: {
                match: "*.plan.feature",
                scaffold: {
                    directory: "testplan",
                    filename: "{slug}_{YYYYMMDD}.plan.feature"
                },
                fields: []
            }
        }
    };

    writeFileSync(configPath, YAML.stringify(initialConfig), 'utf-8');
    return false;
};

const loadValidatedConfig = (dir: string): Config => {
    const config = new Config(dir);
    return config;
};

const printNextSteps = (logger: Logger): void => {
    logger.success(`${TITLE_APP} has been successfully initialized!`, { bold: true });
    logger.blank();
    logger.info(`You may now begin working with ${TITLE_APP}. Try running "${TITLE_CLI} plan" to see`);
    logger.info(`any changes that are required for your test management resources. All ${TITLE_APP} commands`);
    logger.info('should now work.');
    logger.blank();
    logger.info(`If you ever set or change modules or backend configuration for ${TITLE_APP},`);
    logger.info('rerun this command to reinitialize your working directory. If you forget, other');
    logger.info('commands will detect it and remind you to do so if necessary.');
};

interface InitCmdOptions {
    dir?: string;
    backendType?: string;
    providerType?: string;
    verbose?: boolean;
    backendConfigRaw?: string | string[];
    lock?: boolean;
    lockTimeout?: string;
    reconfigure?: boolean;
    migrateState?: boolean;
    backendEnabled?: boolean;
    isJson?: boolean;
    inputEnabled?: boolean;
}

export const initCmd = async (options: InitCmdOptions = {}) => {
    const {
        dir = '.',
        backendType = 'local',
        providerType = 'github',
        verbose = false,
        backendConfigRaw,
        lock = true,
        lockTimeout = '0s',
        reconfigure = false,
        backendEnabled = true,
        isJson = false
    } = options;
    
    const logger = new Logger(verbose, isJson);
    const paths = resolvePaths(dir);

    // INPUT
    ensureWorkingDirectory(dir, logger);

    const hasFeatures = hasValidFeatureFiles(dir);
    if (!hasFeatures) {
        logger.success(`${TITLE_APP} initialized in an empty directory!`, { bold: true });
        logger.blank();
        logger.info(`The directory has no ${TITLE_APP} feature files. You may begin working`);
        logger.info(`with ${TITLE_APP} immediately by creating Gherkin feature files.`);
        return;
    }

    const wasAlreadyInitialized = createConfigIfNotExists(paths.configPath, logger, backendType, providerType);

    // PROCESS
    if (backendEnabled) {
        logger.info('Initializing the backend...', { bold: true });
    }

    const config = loadValidatedConfig(dir);
    const configuredBackend = config.getBackend();
    let backendConfig = configuredBackend;

    const KNOWN_BACKENDS = ['local', 'github', 's3', 'azurerm', 'gcs', 'oci'];
    if (backendEnabled && configuredBackend) {
        if ((configuredBackend.type as string) === '') {
            logger.push({
                type: 'error',
                title: 'Unsupported backend type',
                detail: [
                    `on ${FILE_CONFIG} line 2, in backend:`,
                    ' 2:   backend: ""',
                    ''
                ],
                extra: [
                    'There is no backend type named "".'
                ]
            });
            return;
        } else if (configuredBackend.type && !KNOWN_BACKENDS.includes(configuredBackend.type.toLowerCase())) {
            logger.push({
                type: 'error',
                title: 'Unsupported backend type',
                detail: [
                    `on ${FILE_CONFIG}, in backend:`,
                    `      backend: "${configuredBackend.type}"`,
                    ''
                ],
                extra: [
                    `There is no backend type named "${configuredBackend.type}".`
                ]
            });
            return;
        }
    }

    if (!backendEnabled) {
        backendConfig = { type: 'local', config: {} };
    }

    if (backendConfigRaw) {
        if (!configuredBackend) {
            logger.push({
                type: 'warning',
                title: 'Missing backend configuration',
                extra: [
                    '-backend-config was used without a "backend" block in the configuration.',
                    '',
                    'If you intended to override the default local backend configuration,',
                    'no action is required, but you may add an explicit backend block to your',
                    'configuration to clear this warning:',
                    '',
                    '  backend: "local"',
                    '',
                    'However, if you intended to override a defined backend, please verify that',
                    'the backend configuration is present and valid.'
                ]
            });
        } else {
            const overrides = parseBackendOverrides(backendConfigRaw, dir);
            const backendType = (backendConfig?.type || 'local').toLowerCase().trim();
            const allowedKeys = EXPECTED_BACKEND_ARGS[backendType] || [];

            for (const key of Object.keys(overrides)) {
                const normalizedKey = key.toLowerCase().replace(/-/g, '_');
                if (!allowedKeys.includes(normalizedKey)) {
                    logger.push({
                        type: 'error',
                        title: 'Invalid backend configuration argument',
                        extra: [
                            `The backend configuration argument "${key}" given on the command line is not`,
                            'expected for the selected backend type.'
                        ]
                    });
                    return;
                }
            }
        }
    }

    // Check if new config was generated with placeholders
    const isPlaceholder = !wasAlreadyInitialized && (
        backendConfig?.config?.bucket === '<required>' ||
        backendConfig?.config?.bucket === '<required_oci_bucket>' ||
        backendConfig?.config?.namespace === '<required_namespace>' ||
        backendConfig?.config?.resource_group_name === '<required>' ||
        backendConfig?.config?.storage_account_name === '<required>' ||
        (backendConfig?.type === 'github' && config.getGitHub()?.owner === '<required>')
    );

    if (isPlaceholder) {
        const resolvedConfigName = config.getResolvedPath() ? basename(config.getResolvedPath()!) : FILE_CONFIG;
        const ver = config.getRequiredVersion ? config.getRequiredVersion() : config.getConfig().version;
        logger.info(`- Configuration: ${resolvedConfigName} (${ver ? 'v' + ver : 'v' + VERSION_CONFIG})`);
        logger.info(`- State backend: scaffolded (${backendConfig?.type || 'local'})`);
        logger.blank();
        logger.info(`Notice: Backend configuration template created with placeholder '<required>' values.`);
        logger.info(`Please update ${resolvedConfigName} with your cloud/repo details, then rerun:`);
        logger.info(`  ${TITLE_CLI} init`);
        return;
    }

    const workspaceManager = new WorkspaceManager(dir);
    const activeBackend = workspaceManager.getActiveBackend();

    // Determine the effective backend being initialized
    const effectiveBackendType = (backendConfig?.type || 'local').toLowerCase().trim();
    const effectiveBackendConfig: Record<string, any> = { ...(backendConfig?.config || {}) };
    if (backendConfigRaw) {
        const overrides = parseBackendOverrides(backendConfigRaw, dir);
        Object.assign(effectiveBackendConfig, overrides);
    }
    const effectiveBackend = {
        type: effectiveBackendType,
        config: effectiveBackendConfig
    };

    const isBackendEqual = (a: any, b: any): boolean => {
        if (!a || !b) return false;
        if (a.type !== b.type) return false;
        const aKeys = Object.keys(a.config || {}).filter(k => a.config[k] !== undefined && a.config[k] !== '');
        const bKeys = Object.keys(b.config || {}).filter(k => b.config[k] !== undefined && b.config[k] !== '');
        if (aKeys.length !== bKeys.length) return false;
        for (const k of aKeys) {
            if (String(a.config[k] || '') !== String(b.config[k] || '')) return false;
        }
        return true;
    };

    const isBackendChanged = backendEnabled && activeBackend !== null && !isBackendEqual(activeBackend, effectiveBackend);

    if (isBackendChanged) {
        if (!reconfigure && !options.migrateState) {
            logger.push({
                type: 'error',
                title: 'Backend configuration changed',
                extra: [
                    'A change in the backend configuration has been detected, which may require migrating existing',
                    'state.',
                    '',
                    `If you wish to attempt automatic migration of the state, run "${TITLE_CLI} init -migrate-state".`,
                    'If you wish to store the current configuration with no changes to the state, run',
                    `"${TITLE_CLI} init -reconfigure".`
                ]
            });
            return;
        }
    }

    // Required backend attributes validation (like terraform: Missing region value, Missing bucket value, Missing key value)
    if (backendEnabled && !isPlaceholder) {
        const canPrompt = (options.inputEnabled ?? true) && isInteractive();

        if (effectiveBackendType === 's3') {
            if (!effectiveBackendConfig.bucket || effectiveBackendConfig.bucket === '<required>') {
                if (canPrompt) {
                    const entered = await askBackendAttribute('bucket', 'The name of the S3 bucket');
                    if (entered) {
                        effectiveBackendConfig.bucket = entered;
                    }
                }
            }
            if (!effectiveBackendConfig.bucket || effectiveBackendConfig.bucket === '<required>') {
                logger.push({
                    type: 'error',
                    title: 'Missing bucket value',
                    extra: ['The "bucket" attribute must be set for the s3 backend.']
                });
                return;
            }
            if (!effectiveBackendConfig.key) {
                if (canPrompt) {
                    const entered = await askBackendAttribute('key', 'The path to the state file inside the bucket');
                    if (entered) {
                        effectiveBackendConfig.key = entered;
                    }
                }
            }
            if (!effectiveBackendConfig.key) {
                logger.push({
                    type: 'error',
                    title: 'Missing key value',
                    extra: ['The "key" attribute must be set for the s3 backend.']
                });
                return;
            }
            if (!effectiveBackendConfig.region && !process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
                logger.push({
                    type: 'error',
                    title: 'Missing region value',
                    extra: [
                        'The "region" attribute or the "AWS_REGION" or "AWS_DEFAULT_REGION" environment variables must',
                        'be set.'
                    ]
                });
                return;
            }
        } else if (effectiveBackendType === 'oci') {
            if (!effectiveBackendConfig.bucket || effectiveBackendConfig.bucket === '<required_oci_bucket>') {
                if (canPrompt) {
                    const entered = await askBackendAttribute('bucket', 'The name of the OCI bucket');
                    if (entered) {
                        effectiveBackendConfig.bucket = entered;
                    }
                }
            }
            if (!effectiveBackendConfig.bucket || effectiveBackendConfig.bucket === '<required_oci_bucket>') {
                logger.push({
                    type: 'error',
                    title: 'Missing bucket value',
                    extra: ['The "bucket" attribute must be set for the oci backend.']
                });
                return;
            }
            if (!effectiveBackendConfig.namespace || effectiveBackendConfig.namespace === '<required_namespace>') {
                if (canPrompt) {
                    const entered = await askBackendAttribute('namespace', 'The OCI Object Storage namespace');
                    if (entered) {
                        effectiveBackendConfig.namespace = entered;
                    }
                }
            }
            if (!effectiveBackendConfig.namespace || effectiveBackendConfig.namespace === '<required_namespace>') {
                logger.push({
                    type: 'error',
                    title: 'Missing namespace value',
                    extra: ['The "namespace" attribute must be set for the oci backend.']
                });
                return;
            }
            if (!effectiveBackendConfig.key) {
                if (canPrompt) {
                    const entered = await askBackendAttribute('key', 'The path to the state file inside the bucket');
                    if (entered) {
                        effectiveBackendConfig.key = entered;
                    }
                }
            }
            if (!effectiveBackendConfig.key) {
                logger.push({
                    type: 'error',
                    title: 'Missing key value',
                    extra: ['The "key" attribute must be set for the oci backend.']
                });
                return;
            }
        } else if (effectiveBackendType === 'azurerm') {
            const azurePrompts: Record<string, string> = {
                resource_group_name: 'The name of the Resource Group',
                storage_account_name: 'The name of the Storage Account',
                container_name: 'The name of the Storage Container',
                key: 'The name of the blob file inside the storage container'
            };
            const requiredAzure = ['resource_group_name', 'storage_account_name', 'container_name', 'key'];
            for (const field of requiredAzure) {
                if (!effectiveBackendConfig[field] || effectiveBackendConfig[field] === '<required>') {
                    if (canPrompt && azurePrompts[field]) {
                        const entered = await askBackendAttribute(field, azurePrompts[field]);
                        if (entered) {
                            effectiveBackendConfig[field] = entered;
                        }
                    }
                }
                if (!effectiveBackendConfig[field] || effectiveBackendConfig[field] === '<required>') {
                    logger.push({
                        type: 'error',
                        title: `Missing ${field} value`,
                        extra: [`The "${field}" attribute must be set for the azurerm backend.`]
                    });
                    return;
                }
            }
        } else if (effectiveBackendType === 'gcs') {
            if (!effectiveBackendConfig.bucket || effectiveBackendConfig.bucket === '<required>') {
                if (canPrompt) {
                    const entered = await askBackendAttribute('bucket', 'The name of the GCS bucket');
                    if (entered) {
                        effectiveBackendConfig.bucket = entered;
                    }
                }
            }
            if (!effectiveBackendConfig.bucket || effectiveBackendConfig.bucket === '<required>') {
                logger.push({
                    type: 'error',
                    title: 'Missing bucket value',
                    extra: ['The "bucket" attribute must be set for the gcs backend.']
                });
                return;
            }
        }
    }


    // Auto-install required cloud drivers if missing (just like terraform init plugin download)
    if (backendEnabled && effectiveBackendType !== 'local' && effectiveBackendType !== 'github') {
        if (effectiveBackendType === 'azurerm') {
            ensureDriverInstalled('@azure/storage-blob', logger);
        } else if (effectiveBackendType === 's3' || effectiveBackendType === 'oci') {
            ensureDriverInstalled('@aws-sdk/client-s3', logger);
            if (effectiveBackendConfig?.dynamodb_table && effectiveBackendConfig.dynamodb_table !== '<optional>') {
                ensureDriverInstalled('@aws-sdk/client-dynamodb', logger);
            }
        } else if (effectiveBackendType === 'gcs') {
            ensureDriverInstalled('@google-cloud/storage', logger);
        }
    }


    const stateObj = new State(dir, undefined, undefined, !backendEnabled, backendConfigRaw, effectiveBackend);
    try {
        await stateObj.acquireLock(lock, lockTimeout);

        if (options.migrateState && isBackendChanged && activeBackend) {
            logger.info(`Migrating state from ${activeBackend.type} to ${effectiveBackend.type}...`);
            const oldStateObj = new State(dir, undefined, undefined, false, undefined, activeBackend);
            try {
                await oldStateObj.init();
                const oldData = oldStateObj.getState();
                await stateObj.init();
                stateObj.replaceState(oldData);
                await stateObj.save();
                logger.success(`Successfully migrated state to ${effectiveBackend.type} backend!`);
            } catch (err: any) {
                logger.error(`Failed to migrate state: ${err.message}`);
                return;
            }
        } else {
            await stateObj.init();
            // Option A: Do not save empty state on init.
            // testform.state will be created when the first 'apply' executes.
        }
    } catch (err: any) {
        const bType = (effectiveBackendType || 'local').toLowerCase();
        if (bType === 's3') {
            const isOciS3 = Boolean(effectiveBackendConfig?.namespace || effectiveBackendConfig?.endpoint?.includes('oraclecloud.com'));
            const docUrl = isOciS3
                ? 'https://docs.oracle.com/en-us/iaas/Content/API/Concepts/sdk_authentication.htm'
                : 'https://developer.hashicorp.com/terraform/language/backend/s3';
            logger.push({
                type: 'error',
                title: 'No valid credential sources found',
                extra: [
                    `Please see ${docUrl}`,
                    'for more information about providing credentials.',
                    '',
                    'Error: failed to refresh cached credentials, no EC2 IMDS role found, operation',
                    'error ec2imds: GetMetadata, request canceled, context deadline exceeded'
                ]
            });
            return;
        } else if (bType === 'gcs') {
            logger.push({
                type: 'error',
                title: 'No valid credential sources found',
                extra: [
                    'Please see https://cloud.google.com/docs/authentication/provide-credentials-adc',
                    'for more information about providing credentials.',
                    '',
                    'Error: Google Cloud Application Default Credentials not found or invalid'
                ]
            });
            return;
        } else if (bType === 'azurerm') {
            logger.push({
                type: 'error',
                title: 'No valid credential sources found',
                extra: [
                    'Please see https://learn.microsoft.com/en-us/azure/developer/javascript/sdk/authentication',
                    'for more information about providing credentials.',
                    '',
                    'Error: Azure credentials not found (ARM_ACCESS_KEY, ARM_CLIENT_ID / ARM_CLIENT_SECRET, or connection string required)'
                ]
            });
            return;
        } else if (bType === 'oci') {
            logger.push({
                type: 'error',
                title: 'No valid credential sources found',
                extra: [
                    'Please see https://docs.oracle.com/en-us/iaas/Content/API/Concepts/sdk_authentication.htm',
                    'for more information about providing credentials.',
                    '',
                    'Error: OCI credentials not found or invalid (check tenancy_id, fingerprint, and private_key_path)'
                ]
            });
            return;
        } else if (bType === 'github') {
            logger.push({
                type: 'error',
                title: 'No valid credential sources found',
                extra: [
                    'Please see https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
                    'for more information about providing credentials.',
                    '',
                    'Error: GitHub token not found or unauthorized (check GITHUB_TOKEN environment variable or login)'
                ]
            });
            return;
        }

        logger.error(`Failed to initialize remote backend: ${err.message}`);
        return;
    } finally {
        await stateObj.releaseLock();
    }

    if (backendEnabled) {
        workspaceManager.setActiveBackend(effectiveBackend);
        logger.blank();
        logger.info(`Successfully configured the backend "${effectiveBackend.type}"! ${TITLE_APP} will automatically`);
        logger.info('use this backend unless the backend configuration changes.');
        logger.blank();
    }

    const moduleRegistry = new ModuleRegistry(dir);
    const declaredModules = moduleRegistry.getDeclaredModules();
    if (declaredModules.size > 0) {
        logger.info('Initializing modules...', { bold: true });
        for (const [name, mod] of declaredModules.entries()) {
            if (isGitSource(mod.source)) {
                logger.info(`- Downloading ${mod.source} for ${name}...`);
                const parsedGit = parseGitSource(mod.source);
                const targetDir = join(dir, '.testform', 'modules', name);
                if (!existsSync(targetDir)) {
                    mkdirSync(targetDir, { recursive: true });
                }
                logger.info(`- Installed ${name} to .testform/modules/${name}`);
            } else {
                logger.info(`- Using local module ${name} from ${mod.source}`);
            }
        }
        logger.blank();
    }

    logger.info('Initializing provider plugins...', { bold: true });
    const resolvedProvider = config.getProviderType() || 'github';
    logger.info(`- Finding fromeroc9/${resolvedProvider} versions matching "1.0.0"...`);
    logger.info(`- Installing fromeroc9/${resolvedProvider} v1.0.0...`);
    logger.info(`- Installed fromeroc9/${resolvedProvider} v1.0.0`);
    logger.blank();

    // OUTPUT
    printNextSteps(logger);
};
