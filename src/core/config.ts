import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { FILE_CONFIG, TITLE_APP, VERSION_CONFIG } from '../core/const';
import { IConfig, IGitHubConfig, IField, IScope, ITest } from '../core/types';
import { logger as notify } from '../core/logger';

export class Config {

    private config: IConfig = {};

    constructor(
        private dir: string
    ) {
        this.required();
    }

    private resolve() {
        let currentDir = resolve(this.dir);
        const rootDir = resolve('/');

        while (currentDir !== rootDir) {
            const configPath = resolve(currentDir, FILE_CONFIG);
            if (existsSync(configPath)) {
                return configPath;
            }
            const parentDir = resolve(currentDir, '..');
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }

        const cwd = resolve(process.cwd(), FILE_CONFIG);
        return existsSync(cwd) ? cwd : null;
    }

    private load(resolve: string) {
        const raw = readFileSync(resolve!, "utf-8");
        this.config = JSON.parse(raw) as IConfig;
        return this.config;
    }

    getConfig() {
        return this.config;
    }

    getGitHub(): IGitHubConfig | undefined {
        const github = this.config.github as any;
        if (!github) return undefined;
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

    getIdentity(scope: IScope) {
        const scopeConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, scope) ? (this.config.scope as any)[scope] : undefined;
        const id = scopeConf?.identity;
        if (scope == "testcase") return id ?? "tc-*"
        if (scope == "testrun") return id ?? "tr-*"
        if (scope == "testplan") return id ?? "tp-*"
    }

    getConvention(scope: IScope) {
        const globalConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, 'global') ? (this.config.scope as any)['global'] : undefined;
        const scopeConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, scope) ? (this.config.scope as any)[scope] : undefined;
        
        // Merge convention: scope overrides global
        if (!globalConf?.convention && !scopeConf?.convention) return undefined;
        
        return {
            ...(globalConf?.convention || {}),
            ...(scopeConf?.convention || {})
        };
    }

    getReportMapping(key: string): string | undefined {
        return this.config.report_mapping ? this.config.report_mapping[key] : undefined;
    }

    getFields(scope: IScope): IField[] {
        const globalConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, 'global') ? (this.config.scope as any)['global'] : undefined;
        const globalFields = globalConf?.fields ?? [];
        const scopeConf = this.config.scope && Object.prototype.hasOwnProperty.call(this.config.scope, scope) ? (this.config.scope as any)[scope] : undefined;
        const scopeFields = scopeConf?.fields ?? [];

        // Merge fields, giving precedence to scope-specific fields
        const fieldMap = new Map<string, IField>();

        for (const f of globalFields) {
            if (f.name) fieldMap.set(f.name.toLowerCase(), f);
        }
        for (const f of scopeFields) {
            if (f.name) fieldMap.set(f.name.toLowerCase(), f);
        }

        return Array.from(fieldMap.values());
    }

    private required() {
        const resolve = this.resolve()

        if (!resolve) {
            notify.push({
                type: 'error',
                title: 'No configuration files',
                detail: [
                    'Plan requires configuration to be present. Planning without a configuration would mark everything for',
                    'destruction, which is normally not what is desired. If you would like to destroy everything, run plan with the',
                    `-destroy option. Otherwise, create a ${TITLE_APP} configuration file (.json file) and try again.`
                ],
                close: true
            })
        }

        const config = this.load(resolve!)
        const version = config.version ?? ""

        if (version == null) {
            notify.push({
                type: 'error',
                title: `${FILE_CONFIG} is missing the "version" field`,
                detail: [`Add a "version" field to your ${FILE_CONFIG} file and rerun init.`],
                close: true
            });
        }

        if (version !== VERSION_CONFIG) {
            notify.push({
                type: 'error',
                title: `configuration version mismatch`,
                detail: [
                    `Found version "${this.config.version}", but expected "${VERSION_CONFIG}".`,
                    `Update ${FILE_CONFIG} to version ${VERSION_CONFIG} and rerun init.`,
                ],
                close: true
            });
        }
    }
}