"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const const_1 = require("../const");
const notify_1 = require("../notify");
class Config {
    dir;
    config = {};
    constructor(dir) {
        this.dir = dir;
        this.required();
    }
    resolve() {
        let currentDir = (0, path_1.resolve)(this.dir);
        const rootDir = (0, path_1.resolve)('/');
        while (currentDir !== rootDir) {
            const configPath = (0, path_1.resolve)(currentDir, const_1.FILE_CONFIG);
            if ((0, fs_1.existsSync)(configPath)) {
                return configPath;
            }
            const parentDir = (0, path_1.resolve)(currentDir, '..');
            if (parentDir === currentDir)
                break;
            currentDir = parentDir;
        }
        const cwd = (0, path_1.resolve)(process.cwd(), const_1.FILE_CONFIG);
        return (0, fs_1.existsSync)(cwd) ? cwd : null;
    }
    load(resolve) {
        const raw = (0, fs_1.readFileSync)(resolve, "utf-8");
        this.config = JSON.parse(raw);
        return this.config;
    }
    getConfig() {
        return this.config;
    }
    getGitHub() {
        const github = this.config.github;
        if (!github)
            return undefined;
        return {
            owner: github.owner,
            repository: github.repository,
            projectId: github.projectId || github.project_id,
            tokenEnv: github.tokenEnv || github.token_env || 'GITHUB_TOKEN'
        };
    }
    getBackend() {
        return this.config.backend;
    }
    getIdentity(scope) {
        const scopeConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, scope) ? this.config.scope[scope] : undefined;
        const id = scopeConf?.identity;
        if (scope == "testcase")
            return id ?? "tc-*";
        if (scope == "testrun")
            return id ?? "tr-*";
        if (scope == "testplan")
            return id ?? "tp-*";
    }
    getConvention(scope) {
        const globalConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, 'global') ? this.config.scope['global'] : undefined;
        const scopeConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, scope) ? this.config.scope[scope] : undefined;
        // Merge convention: scope overrides global
        if (!globalConf?.convention && !scopeConf?.convention)
            return undefined;
        return {
            ...(globalConf?.convention || {}),
            ...(scopeConf?.convention || {})
        };
    }
    getReportMapping(key) {
        return this.config.report_mapping ? this.config.report_mapping[key] : undefined;
    }
    getFields(scope) {
        const globalConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, 'global') ? this.config.scope['global'] : undefined;
        const globalFields = globalConf?.fields ?? [];
        const scopeConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, scope) ? this.config.scope[scope] : undefined;
        const scopeFields = scopeConf?.fields ?? [];
        // Merge fields, giving precedence to scope-specific fields
        const fieldMap = new Map();
        for (const f of globalFields) {
            if (f.name)
                fieldMap.set(f.name.toLowerCase(), f);
        }
        for (const f of scopeFields) {
            if (f.name)
                fieldMap.set(f.name.toLowerCase(), f);
        }
        return Array.from(fieldMap.values());
    }
    required() {
        const resolve = this.resolve();
        if (!resolve) {
            notify_1.notify.push({
                type: 'error',
                title: 'No configuration files',
                detail: [
                    'Plan requires configuration to be present. Planning without a configuration would mark everything for',
                    'destruction, which is normally not what is desired. If you would like to destroy everything, run plan with the',
                    `-destroy option. Otherwise, create a ${const_1.TITLE_APP} configuration file (.json file) and try again.`
                ],
                close: true
            });
        }
        const config = this.load(resolve);
        const version = config.version ?? "";
        if (version == null) {
            notify_1.notify.push({
                type: 'error',
                title: `${const_1.FILE_CONFIG} is missing the "version" field`,
                detail: [`Add a "version" field to your ${const_1.FILE_CONFIG} file and rerun init.`],
                close: true
            });
        }
        if (version !== const_1.VERSION_CONFIG) {
            notify_1.notify.push({
                type: 'error',
                title: `configuration version mismatch`,
                detail: [
                    `Found version "${this.config.version}", but expected "${const_1.VERSION_CONFIG}".`,
                    `Update ${const_1.FILE_CONFIG} to version ${const_1.VERSION_CONFIG} and rerun init.`,
                ],
                close: true
            });
        }
    }
}
exports.Config = Config;
