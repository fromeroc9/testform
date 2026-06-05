"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forceUnlockCmd = void 0;
const chalk_1 = require("chalk");
const state_1 = require("../core/state");
const const_1 = require("../const");
const forceUnlockCmd = async (options) => {
    const { dir = '.', lockId, force = false, statePath } = options;
    const stateObj = new state_1.State(dir, statePath);
    await stateObj.init();
    const executeUnlock = async () => {
        const result = await stateObj.forceUnlock(lockId);
        if (result.success) {
            console.log((0, chalk_1.green)(`\n${const_1.TITLE_APP} state has been successfully unlocked!\n`));
            if (!force) {
                console.log(`The state has been unlocked, and ${const_1.TITLE_APP} commands should now be able to`);
                console.log(`obtain a new lock on the remote state.`);
            }
        }
        else {
            if (result.currentLockId) {
                console.error((0, chalk_1.red)(`Error: Lock ID does not match.\n\nExpected: ${lockId}\nActual:   ${result.currentLockId}\n`));
            }
            else if (result.error) {
                console.error((0, chalk_1.red)(`${result.error}\n`));
            }
            process.exit(1);
        }
    };
    if (force) {
        await executeUnlock();
        return;
    }
    console.log(`Do you really want to force-unlock?`);
    console.log(`  ${const_1.TITLE_APP} will remove the lock on the remote state.`);
    console.log(`  This will allow local ${const_1.TITLE_APP} commands to modify this state, even though it`);
    console.log(`  may be still be in use. Only 'yes' will be accepted to confirm.`);
    console.log('');
    const { createInterface } = require('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolveReject) => {
        rl.question('  Enter a value: ', async (answer) => {
            rl.close();
            if (answer.trim().toLowerCase() === 'yes') {
                await executeUnlock();
            }
            else {
                console.error((0, chalk_1.red)(`\nUnlock cancelled.\n`));
                process.exitCode = 1;
            }
            resolveReject();
        });
    });
};
exports.forceUnlockCmd = forceUnlockCmd;
