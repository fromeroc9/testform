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
exports.loginCmd = void 0;
const chalk_1 = require("chalk");
const readline = __importStar(require("readline"));
const credentials_1 = require("../core/credentials");
const loginCmd = async (options = {}) => {
    let { hostname = 'github.com' } = options;
    // In TestForm we default to GitHub
    if (hostname === 'app.terraform.io')
        hostname = 'github.com';
    console.log(`
TestForm must now request an API token for ${(0, chalk_1.bold)(hostname)}.
This token will be stored in plain text at ~/.testform.d/credentials.json.

If you are logging into GitHub, you can generate a Personal Access Token (classic)
with the 'repo' scope at: https://github.com/settings/tokens
`);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(`Token for ${hostname}: `, (token) => {
            rl.close();
            const trimmed = token.trim();
            if (!trimmed) {
                console.log('\nToken cannot be empty. Login aborted.');
                process.exit(1);
            }
            const creds = new credentials_1.Credentials();
            creds.setToken(hostname, trimmed);
            console.log(`\n${(0, chalk_1.green)('Success!')} Logged in to ${hostname}.`);
            resolve();
        });
    });
};
exports.loginCmd = loginCmd;
