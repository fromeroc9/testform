"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VariableParser = void 0;
const fs_1 = require("fs");
const notify_1 = require("../notify");
class VariableParser {
    vars = {};
    workDir;
    constructor(varArgs, varFileArgs, workDir = '.') {
        this.workDir = workDir;
        this.parseVarFiles(varFileArgs);
        this.parseVars(varArgs);
    }
    parseVars(varArgs) {
        if (!varArgs)
            return;
        const items = Array.isArray(varArgs) ? varArgs : [varArgs];
        for (const item of items) {
            const idx = item.indexOf('=');
            if (idx === -1) {
                notify_1.notify.push({
                    type: 'warning',
                    title: `Invalid variable format: ${item}`,
                    detail: ['Variables must be in the format key=value']
                });
                continue;
            }
            const key = item.substring(0, idx).trim();
            const value = item.substring(idx + 1).trim();
            this.vars[key] = value;
        }
    }
    parseVarFiles(varFileArgs) {
        if (!varFileArgs)
            return;
        const items = Array.isArray(varFileArgs) ? varFileArgs : [varFileArgs];
        for (let filePath of items) {
            const path = require('path');
            filePath = path.resolve(this.workDir, filePath);
            if (!(0, fs_1.existsSync)(filePath)) {
                notify_1.notify.push({
                    type: 'error',
                    title: `Variable file not found: ${filePath}`,
                    detail: [],
                    close: true
                });
                process.exit(1);
            }
            try {
                const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
                let fileVars = {};
                if (filePath.endsWith('.json')) {
                    fileVars = JSON.parse(content);
                }
                else {
                    // Simple tfvars format parser (key = "value")
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//'))
                            continue;
                        const idx = trimmed.indexOf('=');
                        if (idx !== -1) {
                            const key = trimmed.substring(0, idx).trim();
                            let value = trimmed.substring(idx + 1).trim();
                            // Remove surrounding quotes if present
                            if (value.startsWith('"') && value.endsWith('"')) {
                                value = value.substring(1, value.length - 1);
                            }
                            else if (value.startsWith("'") && value.endsWith("'")) {
                                value = value.substring(1, value.length - 1);
                            }
                            fileVars[key] = value;
                        }
                    }
                }
                // Merge into existing vars
                this.vars = { ...this.vars, ...fileVars };
            }
            catch (error) {
                notify_1.notify.push({
                    type: 'error',
                    title: `Failed to parse variable file: ${filePath}`,
                    detail: [error.message],
                    close: true
                });
                process.exit(1);
            }
        }
    }
    getVars() {
        return this.vars;
    }
    /**
     * Replaces ${var.name} in the given template string
     * with the corresponding values from the variables.
     */
    applyToTemplate(template) {
        let result = template;
        // Match ${var.NAME}
        const regex = /\$\{var\.([a-zA-Z0-9_-]+)\}/g;
        result = result.replace(regex, (match, key) => {
            return this.vars[key] !== undefined ? this.vars[key] : match;
        });
        return result;
    }
}
exports.VariableParser = VariableParser;
