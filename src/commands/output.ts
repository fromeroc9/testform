import { red } from 'chalk';
import { State } from '../core/state';
import { OutputResolver } from '../core/outputs';
import { VariableParser } from '../core/variables';
import { TITLE_CLI } from '../core/const';

export interface OutputCmdOptions {
    dir?: string;
    name?: string;
    statePath?: string;
    backupPath?: string;
    isJson?: boolean;
    raw?: boolean;
    variables?: VariableParser;
}

const ERROR_NO_STATE = `No state file was found!

State management commands require a state file. Run this command
in a directory where ${TITLE_CLI} has been run or use the -state flag
to point the command to a specific state location.`;

export const outputCmd = async (options: OutputCmdOptions) => {
    const {
        dir = '.',
        name,
        statePath,
        backupPath,
        isJson = false,
        raw = false,
        variables
    } = options;

    const state = new State(dir, statePath, backupPath);

    if (typeof state.hasState === 'function' && !(await state.hasState())) {
        console.error(red(ERROR_NO_STATE));
        process.exitCode = 1;
        return;
    }

    await state.init();

    const resolver = new OutputResolver(dir);
    let outputs = state.getOutputs();

    // If state has no outputs saved yet, or if declarations exist, resolve them against current state
    if (!outputs || Object.keys(outputs).length === 0) {
        const vars = variables || new VariableParser(undefined, undefined, dir);
        outputs = resolver.resolve(state, vars);
        // Persist newly resolved outputs into state
        if (Object.keys(outputs).length > 0) {
            state.setOutputs(outputs);
            await state.save();
        }
    }

    try {
        const formatted = resolver.format(outputs, { json: isJson, raw, name });
        console.log(formatted);
    } catch (e: any) {
        console.error(red(e.message));
        process.exitCode = 1;
    }
};
