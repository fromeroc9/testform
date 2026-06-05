"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const index_1 = require("./index");
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
        await (0, index_1.main)();
    }
    catch (error) {
        core.setFailed(error.message);
    }
}
run();
