"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCmd = void 0;
const const_1 = require("../const");
const prompt_1 = require("../core/prompt");
const fs_1 = require("fs");
const config_1 = require("../core/config");
const logger_1 = require("../logger");
const path_1 = require("path");
const state_1 = require("../core/state");
const workspace_1 = require("../core/workspace");
const resolvePaths = (dir) => ({
    configPath: (0, path_1.join)(dir, const_1.FILE_CONFIG),
    statePath: (0, path_1.join)(dir, const_1.FILE_STATE),
});
const ensureWorkingDirectory = (dir, logger) => {
    if ((0, fs_1.existsSync)(dir))
        return;
    (0, fs_1.mkdirSync)(dir, { recursive: true });
    logger.info(`Created ${dir} directory`);
};
const createConfigIfNotExists = (configPath, logger) => {
    if ((0, fs_1.existsSync)(configPath)) {
        return true;
    }
    const initialConfig = {
        version: const_1.VERSION_CONFIG,
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
    (0, fs_1.writeFileSync)(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
    return false;
};
const ensureStateExists = (statePath, logger) => {
    if ((0, fs_1.existsSync)(statePath))
        return;
    const state = {
        version: const_1.VERSION_STATE,
        lastSync: new Date().toISOString(),
        testcase: [],
        testrun: [],
        testplan: [],
    };
    (0, fs_1.writeFileSync)(statePath, JSON.stringify(state, null, 2), 'utf-8');
};
const loadValidatedConfig = (dir) => {
    const config = new config_1.Config(dir);
    return config;
};
const printInitSummary = (logger, config) => {
    logger.info(`- Configuration: ${const_1.FILE_CONFIG} (v${config.getConfig().version})`);
    logger.info(`- State backend: ready`);
    logger.blank();
};
const printNextSteps = (logger) => {
    logger.success(`${const_1.TITLE_APP} has been successfully initialized!`, { bold: true });
    logger.blank();
    logger.info(`You may now begin working with ${const_1.TITLE_APP}. Try running "${const_1.TITLE_CLI} plan" to see`);
    logger.info('any changes that are required for your test management resources.');
    logger.blank();
    logger.info(`If you ever set or change configuration for ${const_1.TITLE_APP}, rerun this command to`);
    logger.info('reinitialize your working directory.');
};
const initCmd = async (options = {}) => {
    const { dir = '.', verbose = false, backendConfigRaw, lock = true, lockTimeout = '0s', reconfigure = false, backendEnabled = true, isJson = false } = options;
    const logger = new logger_1.Logger(verbose, isJson);
    const paths = resolvePaths(dir);
    // INPUT
    ensureWorkingDirectory(dir, logger);
    const wasAlreadyInitialized = createConfigIfNotExists(paths.configPath, logger);
    // PROCESS
    logger.info('Initializing the backend...', { bold: true });
    logger.info(`Initializing ${const_1.TITLE_APP} configuration...`, { bold: true });
    const config = loadValidatedConfig(dir);
    let backendConfig = config.getBackend();
    if (!backendEnabled) {
        backendConfig = { type: 'local', config: {} };
    }
    const workspaceManager = new workspace_1.WorkspaceManager(dir);
    const activeBackend = workspaceManager.getActiveBackend();
    // Check if backend changed
    let wantsMigration = false;
    const isBackendChanged = activeBackend && backendConfig && JSON.stringify(activeBackend) !== JSON.stringify(backendConfig);
    if (wasAlreadyInitialized && !isBackendChanged && !reconfigure) {
        logger.error([
            `${const_1.TITLE_APP} initialized in not empty directory!`,
            `The directory has ${const_1.TITLE_APP} configuration files. You may begin working`,
            `with ${const_1.TITLE_APP} immediately by creating ${const_1.TITLE_APP} resources.`
        ]);
        return;
    }
    if (isBackendChanged && backendConfig) {
        if (reconfigure) {
            logger.warn('Backend configuration changed. -reconfigure passed, skipping migration.');
        }
        else {
            const inputEnabled = options.inputEnabled ?? true;
            if (!inputEnabled && options.migrateState === undefined) {
                logger.error('Backend configuration changed.\nError: input is disabled and -migrate-state was not passed.');
                return;
            }
            let doMigrate = options.migrateState;
            if (doMigrate === undefined && inputEnabled) {
                doMigrate = await (0, prompt_1.askMigrationApproval)(backendConfig.type);
            }
            if (doMigrate) {
                wantsMigration = true;
            }
        }
    }
    if (!backendConfig || backendConfig.type === 'local') {
        ensureStateExists(paths.statePath, logger);
    }
    const stateObj = new state_1.State(dir, undefined, undefined, !backendEnabled, backendConfigRaw);
    try {
        await stateObj.acquireLock(lock, lockTimeout);
        if (wantsMigration && activeBackend && backendConfig) {
            logger.info(`Migrating state from ${activeBackend.type} to ${backendConfig.type}...`);
            const oldStateObj = new state_1.State(dir, undefined, undefined, false, undefined, activeBackend);
            try {
                // Initialize old backend and grab its state
                await oldStateObj.init();
                const oldData = oldStateObj.getState();
                // Initialize new backend and replace its state
                await stateObj.init();
                stateObj.replaceState(oldData);
                await stateObj.save();
                logger.success(`Successfully migrated state to ${backendConfig.type} backend!`);
            }
            catch (err) {
                logger.error(`Failed to migrate state: ${err.message}`);
                return;
            }
        }
        else {
            await stateObj.init();
            // If it's empty/new, save the initial state structure
            if (stateObj.getState().serial === 0) {
                await stateObj.save();
            }
        }
        // Save active backend in local tracking file
        workspaceManager.setActiveBackend(backendConfig);
    }
    catch (err) {
        logger.error(`Failed to initialize remote backend: ${err.message}`);
        return;
    }
    finally {
        await stateObj.releaseLock();
    }
    // OUTPUT
    printInitSummary(logger, config);
    printNextSteps(logger);
};
exports.initCmd = initCmd;
