"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceCmd = void 0;
const chalk_1 = require("chalk");
const logger_1 = require("../logger");
const state_1 = require("../core/state");
const const_1 = require("../const");
const workspaceCmd = async (options) => {
    const { dir, verbose, args } = options;
    const logger = new logger_1.Logger(verbose);
    const stateObj = new state_1.State(dir);
    const subcommand = args[0];
    const name = args[1];
    if (!subcommand) {
        logger.error(`Usage: ${const_1.TITLE_CLI} workspace [subcommand] [options] [args]`);
        process.exit(1);
    }
    await stateObj.init();
    const currentWorkspace = stateObj.getCurrentWorkspace();
    switch (subcommand) {
        case 'show':
            console.log(currentWorkspace);
            break;
        case 'list':
            const workspaces = await stateObj.listWorkspaces();
            for (const ws of workspaces) {
                if (ws === currentWorkspace) {
                    console.log((0, chalk_1.green)(`* ${ws}`));
                }
                else {
                    console.log(`  ${ws}`);
                }
            }
            break;
        case 'new':
            if (!name) {
                logger.error('Expected a workspace name');
                process.exit(1);
            }
            const existingForNew = await stateObj.listWorkspaces();
            if (existingForNew.includes(name)) {
                logger.error(`Workspace "${name}" already exists`);
                process.exit(1);
            }
            stateObj.setCurrentWorkspace(name);
            // Re-instantiate state to bind backend to the new workspace
            const newStateObj = new state_1.State(dir);
            await newStateObj.init();
            newStateObj.clearResources();
            await newStateObj.save();
            console.log((0, chalk_1.green)(`Created and switched to workspace "${name}"!`));
            console.log('');
            console.log(`You're now on a new, empty workspace. Workspaces isolate their state,`);
            console.log(`so if you run "${const_1.TITLE_CLI} plan" ${const_1.TITLE_CLI} will not see any existing state`);
            console.log(`for this configuration.`);
            break;
        case 'select':
            if (!name) {
                logger.error('Expected a workspace name');
                process.exit(1);
            }
            const existingForSelect = await stateObj.listWorkspaces();
            if (!existingForSelect.includes(name)) {
                logger.error(`Workspace "${name}" doesn't exist.\n\nYou can create this workspace with the "new" subcommand.`);
                process.exit(1);
            }
            stateObj.setCurrentWorkspace(name);
            console.log((0, chalk_1.green)(`Switched to workspace "${name}".`));
            break;
        case 'delete':
            if (!name) {
                logger.error('Expected a workspace name');
                process.exit(1);
            }
            if (name === 'default') {
                logger.error(`Workspace "default" cannot be deleted.`);
                process.exit(1);
            }
            if (name === currentWorkspace) {
                logger.error(`Workspace "${name}" is your active workspace.\n\nYou cannot delete the currently active workspace. Please switch\nto another workspace and try again.`);
                process.exit(1);
            }
            const existingForDelete = await stateObj.listWorkspaces();
            if (!existingForDelete.includes(name)) {
                logger.error(`Workspace "${name}" doesn't exist.`);
                process.exit(1);
            }
            const deleted = await stateObj.deleteWorkspace(name);
            if (deleted) {
                console.log((0, chalk_1.green)(`Deleted workspace "${name}"!`));
            }
            else {
                logger.error(`Failed to delete workspace "${name}".`);
                process.exit(1);
            }
            break;
        default:
            logger.error(`Invalid workspace subcommand: ${subcommand}`);
            process.exit(1);
    }
};
exports.workspaceCmd = workspaceCmd;
