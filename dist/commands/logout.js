"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logoutCmd = void 0;
const chalk_1 = require("chalk");
const credentials_1 = require("../core/credentials");
const logoutCmd = async (options = {}) => {
    let { hostname = 'github.com' } = options;
    // In TestForm we default to GitHub
    if (hostname === 'app.terraform.io')
        hostname = 'github.com';
    const creds = new credentials_1.Credentials();
    const removed = creds.removeToken(hostname);
    if (removed) {
        console.log(`\n${(0, chalk_1.green)('Success!')} Removed credentials for ${hostname}.`);
    }
    else {
        console.log(`\n${(0, chalk_1.yellow)('Warning:')} No credentials found for ${hostname}.`);
    }
};
exports.logoutCmd = logoutCmd;
