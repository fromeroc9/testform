"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taintCmd = void 0;
const chalk_1 = require("chalk");
const state_1 = require("../core/state");
const taintCmd = async (options) => {
    const { dir = '.', action, identityRaw, statePath, backupPath, allowMissing = false, lock = true, lockTimeout = '0s' } = options;
    const state = new state_1.State(dir, statePath, backupPath);
    await state.init();
    await state.acquireLock(lock, lockTimeout);
    try {
        const identity = identityRaw.replace(/^github_testcase\./, '');
        const res = state.getResources('github_testcase').find(r => r.identity === identity);
        if (!res) {
            if (allowMissing) {
                console.log((0, chalk_1.green)(`Resource not found in state, but allow-missing is set. Exiting successfully.`));
                process.exit(0);
            }
            console.error((0, chalk_1.red)(`Error: Resource not found in state.`));
            process.exit(1);
        }
        if (action === 'taint') {
            if (res.tainted) {
                console.log(`Resource instance ${identityRaw} is already tainted`);
            }
            else {
                res.tainted = true;
                state.upsertResource(res);
                await state.save();
                console.log((0, chalk_1.green)(`Resource instance ${identityRaw} has been marked as tainted.`));
            }
        }
        else {
            if (!res.tainted) {
                console.log(`Resource instance ${identityRaw} is not tainted`);
            }
            else {
                delete res.tainted;
                state.upsertResource(res);
                await state.save();
                console.log((0, chalk_1.green)(`Resource instance ${identityRaw} has been successfully untainted.`));
            }
        }
    }
    finally {
        await state.releaseLock();
    }
};
exports.taintCmd = taintCmd;
