"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Credentials = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
class Credentials {
    credsPath;
    constructor() {
        const home = (0, os_1.homedir)();
        const configDir = (0, path_1.join)(home, '.testform.d');
        if (!(0, fs_1.existsSync)(configDir)) {
            (0, fs_1.mkdirSync)(configDir, { recursive: true });
        }
        this.credsPath = (0, path_1.join)(configDir, 'credentials.json');
    }
    load() {
        if (!(0, fs_1.existsSync)(this.credsPath)) {
            return { credentials: {} };
        }
        try {
            const raw = (0, fs_1.readFileSync)(this.credsPath, 'utf8');
            return JSON.parse(raw);
        }
        catch {
            return { credentials: {} };
        }
    }
    save(data) {
        (0, fs_1.writeFileSync)(this.credsPath, JSON.stringify(data, null, 2), 'utf8');
    }
    getToken(hostname = 'github.com') {
        const data = this.load();
        return data.credentials?.[hostname]?.token;
    }
    setToken(hostname = 'github.com', token) {
        const data = this.load();
        if (!data.credentials)
            data.credentials = {};
        data.credentials[hostname] = { token };
        this.save(data);
    }
    removeToken(hostname = 'github.com') {
        const data = this.load();
        if (data.credentials?.[hostname]) {
            delete data.credentials[hostname];
            this.save(data);
            return true;
        }
        return false;
    }
}
exports.Credentials = Credentials;
