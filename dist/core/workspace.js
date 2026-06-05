"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceManager = void 0;
const path_1 = require("path");
const fs_1 = require("fs");
class WorkspaceManager {
    envPath;
    statePath;
    constructor(dir) {
        const testformDir = (0, path_1.join)(dir, '.testform');
        if (!(0, fs_1.existsSync)(testformDir)) {
            (0, fs_1.mkdirSync)(testformDir, { recursive: true });
        }
        this.envPath = (0, path_1.join)(testformDir, 'environment');
        this.statePath = (0, path_1.join)(testformDir, 'testform.state');
    }
    getCurrentWorkspace() {
        if ((0, fs_1.existsSync)(this.envPath) && (0, fs_1.statSync)(this.envPath).isFile()) {
            const content = (0, fs_1.readFileSync)(this.envPath, 'utf8').trim();
            if (content.length > 0) {
                return content;
            }
        }
        return 'default';
    }
    setCurrentWorkspace(name) {
        (0, fs_1.writeFileSync)(this.envPath, name, 'utf8');
    }
    getActiveBackend() {
        if ((0, fs_1.existsSync)(this.statePath) && (0, fs_1.statSync)(this.statePath).isFile()) {
            try {
                const content = (0, fs_1.readFileSync)(this.statePath, 'utf8');
                const parsed = JSON.parse(content);
                return parsed.backend || null;
            }
            catch {
                return null;
            }
        }
        return null;
    }
    setActiveBackend(backend) {
        let stateObj = { version: 3 };
        if ((0, fs_1.existsSync)(this.statePath) && (0, fs_1.statSync)(this.statePath).isFile()) {
            try {
                stateObj = JSON.parse((0, fs_1.readFileSync)(this.statePath, 'utf8'));
            }
            catch {
                // Ignore parse errors, just overwrite
            }
        }
        stateObj.backend = backend;
        (0, fs_1.writeFileSync)(this.statePath, JSON.stringify(stateObj, null, 2), 'utf8');
    }
}
exports.WorkspaceManager = WorkspaceManager;
