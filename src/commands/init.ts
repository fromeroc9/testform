import { FILE_CONFIG, FILE_STATE, TITLE_APP, TITLE_CLI, VERSION_CONFIG, VERSION_STATE } from '../const';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Config } from '../core/config';
import { Logger } from '../logger';
import { join } from 'path';
import { State } from '../core/state';
import { WorkspaceManager } from '../core/workspace';

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

const createConfigIfNotExists = (configPath: string, logger: Logger): boolean => {
    if (existsSync(configPath)) {
        return true;
    }

    const initialConfig = {
        version: VERSION_CONFIG,
        github: {
            owner: "<required>",
            repository: "<required>"
        },
        backend: {
            type: "local",
            config: {}
        },
        scope: {
            testcase: { fields: [] },
            testrun: { fields: [] },
            testplan: { fields: [] }
        }
    };

    writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
    return false;
};

const ensureStateExists = (statePath: string, logger: Logger): void => {
    if (existsSync(statePath)) return;

    const state = {
        version: VERSION_STATE,
        lastSync: new Date().toISOString(),
        testcase: [],
        testrun: [],
        testplan: [],
    };

    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
};

const loadValidatedConfig = (dir: string): Config => {
    const config = new Config(dir);
    return config;
};

const printInitSummary = (logger: Logger, config: Config): void => {
    logger.info(`- Configuration: ${FILE_CONFIG} (v${config.getConfig().version})`);
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

export interface InitCmdOptions {
    dir?: string;
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
    const wasAlreadyInitialized = createConfigIfNotExists(paths.configPath, logger);

    // PROCESS
    logger.info('Initializing the backend...', { bold: true });
    logger.info(`Initializing ${TITLE_APP} configuration...`, { bold: true });

    const config = loadValidatedConfig(dir);
    let backendConfig = config.getBackend();

    if (!backendEnabled) {
        backendConfig = { type: 'local', config: {} };
    }

    const workspaceManager = new WorkspaceManager(dir);
    const activeBackend = workspaceManager.getActiveBackend();

    // Check if backend changed
    let wantsMigration = false;
    const isBackendChanged = activeBackend && backendConfig && JSON.stringify(activeBackend) !== JSON.stringify(backendConfig);

    if (wasAlreadyInitialized && !isBackendChanged && !reconfigure) {
        logger.error([
            `${TITLE_APP} initialized in not empty directory!`,
            `The directory has ${TITLE_APP} configuration files. You may begin working`,
            `with ${TITLE_APP} immediately by creating ${TITLE_APP} resources.`
        ]);
        return;
    }

    if (isBackendChanged && backendConfig) {
        if (reconfigure) {
            logger.warn('Backend configuration changed. -reconfigure passed, skipping migration.');
        } else {
            const inputEnabled = options.inputEnabled ?? true;
            if (!inputEnabled && options.migrateState === undefined) {
                logger.error('Backend configuration changed.\nError: input is disabled and -migrate-state was not passed.');
                return;
            }

            let doMigrate = options.migrateState;
            if (doMigrate === undefined && inputEnabled) {
                const { askMigrationApproval } = require('../core/prompt');
                doMigrate = await askMigrationApproval(backendConfig.type);
            }

            if (doMigrate) {
                wantsMigration = true;
            }
        }
    }

    if (!backendConfig || backendConfig.type === 'local') {
        ensureStateExists(paths.statePath, logger);
    }

    const stateObj = new State(dir, undefined, undefined, !backendEnabled, backendConfigRaw);
    try {
        await stateObj.acquireLock(lock, lockTimeout);

        if (wantsMigration && activeBackend && backendConfig) {
            logger.info(`Migrating state from ${activeBackend.type} to ${backendConfig.type}...`);
            const oldStateObj = new State(dir, undefined, undefined, false, undefined, activeBackend);
            
            try {
                // Initialize old backend and grab its state
                await oldStateObj.init();
                const oldData = oldStateObj.getState();
                
                // Initialize new backend and replace its state
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
            // If it's empty/new, save the initial state structure
            if (stateObj.getState().serial === 0) {
                await stateObj.save();
            }
        }

        // Save active backend in local tracking file
        workspaceManager.setActiveBackend(backendConfig);
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
