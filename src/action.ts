import * as core from '@actions/core';
import { main } from './index';

async function run() {
    try {
        const command = core.getInput('command', { required: true });
        const workingDirectory = core.getInput('working-directory');
        const argsStr = core.getInput('args');

        // Parse arguments
        const args = argsStr ? argsStr.split(' ') : [];

        // Construct process.argv simulating CLI
        // argv[0] = node, argv[1] = testform, argv[2] = command
        const mockArgv = ['node', 'testform'];

        if (workingDirectory && workingDirectory !== '.') {
            mockArgv.push(`-chdir=${workingDirectory}`);
        }

        mockArgv.push(command);
        mockArgv.push(...args);

        process.argv = mockArgv;

        await main();

    } catch (error: any) {
        core.setFailed(error.message);
    }
}

run();
