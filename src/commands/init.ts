import { CONFIG_FILE_NAMES, FILE_CONFIG, FILE_STATE, TITLE_APP, TITLE_CLI, VERSION_CONFIG, VERSION_STATE } from '../core/const';
import YAML from 'yaml';

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Config } from '../core/config';
import { Logger } from '../core/logger';
import { basename, dirname, join } from 'path';
import { State } from '../core/state';
import { ensureDriverInstalled } from '../core/driver';

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
        version: VERSION_CONFIG,
        provider: providerBlock,
        backend: backendBlock,
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

const printInitSummary = (logger: Logger, config: Config): void => {
    const resolvedConfigName = config.getResolvedPath() ? basename(config.getResolvedPath()!) : FILE_CONFIG;
    logger.info(`- Configuration: ${resolvedConfigName} (v${config.getConfig().version})`);
    logger.info(`- State backend: ready`);
    logger.blank();
};

const printNextSteps = (logger: Logger): void => {
    logger.success(`${TITLE_APP} has been successfully initialized!`, { bold: true });
    logger.blank();
    logger.info(`You may now begin working with ${TITLE_APP}. Try running "${TITLE_CLI} plan" to see`);
    logger.info('any changes that are required for your test management resources.');
    logger.blank();
    logger.info(`If you ever set or change configuration for ${TITLE_APP}, rerun this command to`);
    logger.info('reinitialize your working directory.');
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
    const wasAlreadyInitialized = createConfigIfNotExists(paths.configPath, logger, backendType, providerType);

    // PROCESS
    logger.info('Initializing the backend...', { bold: true });
    logger.info(`Initializing ${TITLE_APP} configuration...`, { bold: true });

    const config = loadValidatedConfig(dir);
    let backendConfig = config.getBackend();

    if (!backendEnabled) {
        backendConfig = { type: 'local', config: {} };
    }

    // Auto-install required cloud drivers if missing (just like terraform init plugin download)
    if (backendEnabled && backendConfig && backendConfig.type !== 'local' && backendConfig.type !== 'github') {
        if (backendConfig.type === 'azurerm') {
            ensureDriverInstalled('@azure/storage-blob', logger);
        } else if (backendConfig.type === 's3' || backendConfig.type === 'oci') {
            ensureDriverInstalled('@aws-sdk/client-s3', logger);
            if (backendConfig.config?.dynamodb_table && backendConfig.config.dynamodb_table !== '<optional>') {
                ensureDriverInstalled('@aws-sdk/client-dynamodb', logger);
            }
        } else if (backendConfig.type === 'gcs') {
            ensureDriverInstalled('@google-cloud/storage', logger);
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
        logger.info(`- Configuration: ${resolvedConfigName} (v${config.getConfig().version})`);
        logger.info(`- State backend: scaffolded (${backendConfig?.type || 'local'})`);
        logger.blank();
        logger.info(`Notice: Backend configuration template created with placeholder '<required>' values.`);
        logger.info(`Please update ${resolvedConfigName} with your cloud/repo details, then rerun:`);
        logger.info(`  ${TITLE_CLI} init`);
        return;
    }

    if (wasAlreadyInitialized && !reconfigure) {
        logger.info([
            `${TITLE_APP} initialized in not empty directory!`,
            `The directory has ${TITLE_APP} configuration files. You may begin working`,
            `with ${TITLE_APP} immediately by creating ${TITLE_APP} resources.`
        ]);
    }

    

    const stateObj = new State(dir, undefined, undefined, !backendEnabled, backendConfigRaw);
    try {
        await stateObj.acquireLock(lock, lockTimeout);

        if (options.migrateState && backendConfig && backendConfig.type !== 'local' && existsSync(paths.statePath)) {
            logger.info(`Migrating state from local to ${backendConfig.type}...`);
            const oldStateObj = new State(dir, paths.statePath, undefined, true);
            try {
                await oldStateObj.init();
                const oldData = oldStateObj.getState();
                await stateObj.init();
                stateObj.replaceState(oldData);
                await stateObj.save();
                logger.success(`Successfully migrated state to ${backendConfig.type} backend!`);
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
        logger.error(`Failed to initialize remote backend: ${err.message}`);
        return;
    } finally {
        await stateObj.releaseLock();
    }

    // OUTPUT
    printInitSummary(logger, config);
    printNextSteps(logger);
};
