import { existsSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import YAML from "yaml";
import { CONFIG_FILE_NAMES, FILE_CONFIG, TITLE_APP, VERSION_CONFIG } from '../core/const';
import { IConfig, IGitHubConfig, IField, IScope, ITest, IScopeConfig, IBackendConfig } from '../core/types';
import { logger as notify } from '../core/logger';

export class Config {

    private config: IConfig = {};
    private resolvedPath: string | null = null;

    constructor(
        private dir: string,
        private requiredConfig: boolean = true
    ) {
        if (this.requiredConfig) {
            this.required();
        } else {
            const resolved = this.resolve();
            if (resolved) {
                this.load(resolved);
            }
        }
    }

    private resolve(): string | null {
        let currentDir = resolve(this.dir);
        const rootDir = resolve('/');

        while (currentDir !== rootDir) {
            for (const name of CONFIG_FILE_NAMES) {
                const configPath = resolve(currentDir, name);
                if (existsSync(configPath)) {
                    this.resolvedPath = configPath;
                    return configPath;
                }
            }
            const parentDir = resolve(currentDir, '..');
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }

        for (const name of CONFIG_FILE_NAMES) {
            const cwd = resolve(process.cwd(), name);
            if (existsSync(cwd)) {
                this.resolvedPath = cwd;
                return cwd;
            }
        }
        return null;
    }

    private load(resolvedPath: string) {
        const raw = readFileSync(resolvedPath, "utf-8");
        this.config = (YAML.parse(raw) || {}) as IConfig;
        return this.config;
    }

    getResolvedPath(): string | null {
        return this.resolvedPath;
    }

    getConfig() {
        return this.config;
    }

    getProviderType(): string {
        const raw: any = this.config.provider;
        if (!raw) {
            if ((this.config as any).github) return 'github';
            return 'local';
        }

        // 1. String scalar, e.g. "provider: local"
        if (typeof raw === 'string') {
            return raw.trim().toLowerCase();
        }

        // 2. Dictionary format:
        // provider:
        //   github:
        //     owner: ...
        const KNOWN_PROVIDERS = ['github', 'gitlab', 'custom', 'local'];
        for (const p of KNOWN_PROVIDERS) {
            if ((raw as any)[p] !== undefined && ((raw as any)[p] === null || typeof (raw as any)[p] === 'object')) {
                return p;
            }
        }

        // 3. Legacy type-based format:
        // provider:
        //   type: github
        if ((raw as any).type) {
            return (raw as any).type.toLowerCase();
        }

        const keys = Object.keys(raw);
        if (keys.length > 0 && ((raw as any)[keys[0]] === null || typeof (raw as any)[keys[0]] === 'object')) {
            return keys[0].toLowerCase();
        }

        return 'local';
    }

    getAdapterType(): 'github' | 'local' | string {
        return this.getProviderType();
    }

    getProviderConfig(type?: string): Record<string, any> {
        const targetType = type || this.getProviderType();
        const raw = this.config.provider;

        if (!raw || typeof raw === 'string') {
            if (targetType === 'github' && (this.config as any).github) {
                return (this.config as any).github;
            }
            return {};
        }

        // Dictionary format: raw[targetType]
        if ((raw as any)[targetType] !== undefined && typeof (raw as any)[targetType] === 'object') {
            return (raw as any)[targetType] || {};
        }

        // Legacy format: raw.config
        if ((raw as any).config && typeof (raw as any).config === 'object') {
            return (raw as any).config;
        }

        // Flat format: { type: 'github', owner: '...' }
        if ((raw as any).type) {
            const { type: _t, ...rest } = raw as any;
            return rest;
        }

        if (targetType === 'github' && (this.config as any).github) {
            return (this.config as any).github;
        }

        return raw as Record<string, any>;
    }

    getGitHub(): IGitHubConfig | undefined {
        const type = this.getProviderType();
        const hasGithub = type === 'github' || (this.config as any).github !== undefined || (this.config.provider as any)?.github !== undefined;
        if (!hasGithub) return undefined;
        const gh = this.getProviderConfig('github') || {};
        return {
            owner: gh.owner,
            repository: gh.repository,
            projectId: gh.projectId || gh.project_id,
            tokenEnv: gh.tokenEnv || gh.token_env || 'GITHUB_TOKEN'
        };
    }

    getBackend(): IBackendConfig | undefined {
        const raw = this.config.backend;
        if (raw === undefined) return undefined;
        if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
            return {
                type: '' as any,
                config: {}
            };
        }

        // 1. Support string scalar, e.g. "backend: local"
        if (typeof raw === 'string') {
            return {
                type: raw.trim().toLowerCase() as any,
                config: {}
            };
        }

        // 2. Support optimized format where backend type is the root key:
        // backend:
        //   s3:
        //     bucket: my-bucket
        const KNOWN_BACKENDS = ['local', 'github', 's3', 'azurerm', 'gcs', 'oci'];
        for (const type of KNOWN_BACKENDS) {
            if ((raw as any)[type] !== undefined && typeof (raw as any)[type] === 'object') {
                return {
                    type: type as any,
                    config: (raw as any)[type] || {}
                };
            }
        }

        // 2. Support direct / flat format:
        // backend:
        //   type: s3
        //   bucket: my-bucket
        if (raw.type) {
            if (raw.config && typeof raw.config === 'object') {
                return raw as IBackendConfig;
            }
            const { type, ...rest } = raw as any;
            return {
                type,
                config: rest
            };
        }

        return raw as IBackendConfig;
    }

    getScopeConf(scope: IScope | 'global'): IScopeConfig | undefined {
        const scopes = this.config.scopes || this.config.scope;
        if (!scopes) return undefined;
        return Object.prototype.hasOwnProperty.call(scopes, scope) ? (scopes as any)[scope] : undefined;
    }

    getMatch(scope: IScope): string | undefined {
        const scopeConf = this.getScopeConf(scope);
        if (!scopeConf?.match) return undefined;
        return scopeConf.match.trim();
    }

    getIdentity(scope: IScope): string {
        const defaultId = scope === 'testcase' ? 'tc-*' : scope === 'testrun' ? 'tr-*' : scope === 'testplan' ? 'tp-*' : '*';
        const scopeConf = this.getScopeConf(scope);

        let id = scopeConf?.identity;
        if (!id && scopeConf?.match && scopeConf.match.includes('.feature.')) {
            const candidate = scopeConf.match.slice(scopeConf.match.indexOf('.feature.') + 9).trim();
            if (candidate && candidate !== '*') {
                id = candidate;
            }
        }

        if (!id || id === '*') {
            return defaultId;
        }

        return id;
    }

    getConvention(scope: IScope) {
        const globalConf = this.getScopeConf('global');
        const scopeConf = this.getScopeConf(scope);
        
        const globalScaffold = globalConf?.scaffold || globalConf?.convention;
        const scopeScaffold = scopeConf?.scaffold || scopeConf?.convention;

        // Merge convention/scaffold: scope overrides global
        if (!globalScaffold && !scopeScaffold) return undefined;
        
        const merged: any = {
            ...(globalScaffold || {}),
            ...(scopeScaffold || {})
        };
        if (merged.pattern && !merged.filename) {
            merged.filename = merged.pattern;
        }
        return merged;
    }

    getReportMapping(key: string): string | undefined {
        return this.config.report_mapping ? this.config.report_mapping[key] : undefined;
    }

    getFields(scope: IScope): IField[] {
        const globalScopeRaw = this.getScopeConf('global')?.fields;
        const globalTopRaw = this.config.fields?.global;
        const globalFields = [
            ...this.normalizeFields(globalScopeRaw),
            ...this.normalizeFields(globalTopRaw)
        ];

        const scopeRaw = this.getScopeConf(scope)?.fields;
        const scopeTopRaw = this.config.fields && Object.prototype.hasOwnProperty.call(this.config.fields, scope) ? (this.config.fields as any)[scope] : undefined;
        const scopeFields = [
            ...this.normalizeFields(scopeRaw),
            ...this.normalizeFields(scopeTopRaw)
        ];

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

    private normalizeFields(raw: any): IField[] {
        if (!raw) return [];
        if (Array.isArray(raw)) {
            return raw.map((item) => {
                if (!item || typeof item !== 'object') return null;
                const isTag = item.source === 'tag' || item.source === 'tags' || item.type === 'tags';
                const values = item.enum ?? item.values;
                return {
                    name: item.name,
                    type: isTag ? 'tags' : 'keywords',
                    source: isTag ? 'tag' : (item.source || 'step'),
                    values,
                    enum: values,
                    required: item.required,
                    default: item.default
                } as IField;
            }).filter(Boolean) as IField[];
        }
        if (typeof raw === 'object') {
            const result: IField[] = [];
            for (const [name, val] of Object.entries(raw)) {
                const fieldObj: any = (typeof val === 'object' && val !== null) ? val : {};
                const isTag = fieldObj.source === 'tag' || fieldObj.source === 'tags' || fieldObj.type === 'tags';
                const values = fieldObj.enum ?? fieldObj.values;
                result.push({
                    name: fieldObj.name ?? name,
                    type: isTag ? 'tags' : 'keywords',
                    source: isTag ? 'tag' : (fieldObj.source || 'step'),
                    values,
                    enum: values,
                    required: fieldObj.required,
                    default: fieldObj.default
                });
            }
            return result;
        }
        return [];
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
                    `-destroy option. Otherwise, create a ${TITLE_APP} configuration file (${FILE_CONFIG}) and try again.`
                ],
                close: true
            })
        }

        const config = this.load(resolve!)
        const version = config.version ?? ""

        if (version == null) {
            notify.push({
                type: 'error',
                title: `Configuration is missing the "version" field`,
                detail: [`Add a "version" field to your ${basename(resolve!)} file and rerun init.`],
                close: true
            });
        }

        if (version !== VERSION_CONFIG) {
            notify.push({
                type: 'error',
                title: `configuration version mismatch`,
                detail: [
                    `Found version "${this.config.version}", but expected "${VERSION_CONFIG}".`,
                    `Update ${basename(resolve!)} to version ${VERSION_CONFIG} and rerun init.`,
                ],
                close: true
            });
        }
    }
}