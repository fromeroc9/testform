import { existsSync, readFileSync } from "fs";
import { resolve, basename, dirname } from "path";
import YAML from "yaml";
import { CONFIG_FILE_NAMES, FILE_CONFIG, TITLE_APP, VERSION_CONFIG } from '../core/const';
import { IConfig, IGitHubConfig, IField, IScope, ITest, IScopeConfig, IBackendConfig } from '../core/types';
import { logger as notify } from '../core/logger';
import { resource } from '../core/resources';

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

        // Auto-load external resource.yml / resource.yaml if present in the workspace
        const dir = dirname(resolvedPath);
        for (const resourceName of ['resource.yml', 'resource.yaml']) {
            const resourcePath = resolve(dir, resourceName);
            if (existsSync(resourcePath)) {
                try {
                    const content = readFileSync(resourcePath, 'utf-8');
                    const parsed = YAML.parse(content) || {};
                    const extResources = parsed.resource || parsed;
                    if (extResources && typeof extResources === 'object') {
                        const currentResources = (this.config.resource || {}) as Record<string, any>;
                        const mergedResources: Record<string, any> = { ...extResources };
                        for (const [key, val] of Object.entries(currentResources)) {
                            if (val && typeof val === 'object' && mergedResources[key] && typeof mergedResources[key] === 'object') {
                                mergedResources[key] = { ...mergedResources[key], ...val };
                            } else {
                                mergedResources[key] = val;
                            }
                        }
                        this.config.resource = mergedResources;
                    }
                } catch {
                    // Ignore parse error here; validated during validateCmd
                }
                break;
            }
        }

        // Validate resource declarations strictly to prevent mistakes
        const res = this.config.resource;
        if (res && typeof res === 'object') {
            const registered = resource.getRegisteredTypes();
            const ALLOWED = [...new Set(['testcase', 'testrun', 'testplan', 'global', ...registered])];
            for (const key of Object.keys(res)) {
                if (!ALLOWED.includes(key)) {
                    notify.push({
                        type: 'error',
                        title: `Unknown resource type in configuration: "${key}"`,
                        detail: [
                            `The resource block only allows declaring: ${ALLOWED.filter(a => a !== 'global').join(', ')} (and global).`,
                            `Verify your main.yml or resource.yml configuration.`
                        ],
                        close: true
                    });
                }
            }
        }

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
            if (raw[p] !== undefined && (raw[p] === null || typeof raw[p] === 'object')) {
                return p;
            }
        }

        const keys = Object.keys(raw);
        if (keys.length > 0 && (raw[keys[0]] === null || typeof raw[keys[0]] === 'object')) {
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
            return {};
        }

        // Dictionary format: raw[targetType]
        if ((raw as any)[targetType] !== undefined && typeof (raw as any)[targetType] === 'object') {
            return (raw as any)[targetType] || {};
        }

        return {};
    }

    getGitHub(): IGitHubConfig | undefined {
        const type = this.getProviderType();
        if (type !== 'github') return undefined;
        const gh = this.getProviderConfig('github') || {};
        return {
            owner: gh.owner,
            repository: gh.repository,
            projectId: gh.project_id,
            tokenEnv: gh.token_env || 'GITHUB_TOKEN'
        };
    }

    getRequiredVersion(): string | undefined {
        const tfBlock = (this.config as any).testform;
        if (tfBlock) {
            if (typeof tfBlock === 'string') return tfBlock;
            if (typeof tfBlock === 'object') return tfBlock.required_version || tfBlock.version;
        }
        return this.config.version;
    }

    getBackend(): IBackendConfig | undefined {
        const tfBlock = (this.config as any).testform;
        const raw = (tfBlock && typeof tfBlock === 'object' && tfBlock.backend !== undefined)
            ? tfBlock.backend
            : this.config.backend;

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

        // 2. Dictionary format where backend type is the root key:
        // backend:
        //   s3:
        //     bucket: my-bucket
        const KNOWN_BACKENDS = ['local', 'github', 's3', 'azurerm', 'gcs', 'oci', 'http', 'rest', 'custom'];
        for (const type of KNOWN_BACKENDS) {
            if ((raw as any)[type] !== undefined && typeof (raw as any)[type] === 'object') {
                return {
                    type: type as any,
                    config: (raw as any)[type] || {}
                };
            }
        }

        const keys = Object.keys(raw);
        if (keys.length > 0 && typeof (raw as any)[keys[0]] === 'object') {
            return {
                type: keys[0].toLowerCase() as any,
                config: (raw as any)[keys[0]] || {}
            };
        }

        return undefined;
    }

    getPolicies(): Record<string, any> | undefined {
        return this.config.policy;
    }

    getScopeConf(scope: IScope | 'global'): IScopeConfig | undefined {
        const resource = this.config.resource;
        if (!resource) return undefined;
        return Object.prototype.hasOwnProperty.call(resource, scope) ? (resource as any)[scope] : undefined;
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
        
        const globalScaffold = globalConf?.scaffold;
        const scopeScaffold = scopeConf?.scaffold;

        if (!globalScaffold && !scopeScaffold) return undefined;
        
        const merged: any = {
            ...(globalScaffold || {}),
            ...(scopeScaffold || {})
        };
        return merged;
    }

    getReportMapping(key: string): string | undefined {
        return this.config.report_mapping ? this.config.report_mapping[key] : undefined;
    }

    getFields(scope: IScope): IField[] {
        const globalScopeRaw = this.getScopeConf('global')?.fields;
        const globalFields = this.normalizeFields(globalScopeRaw);

        const scopeRaw = this.getScopeConf(scope)?.fields;
        const scopeFields = this.normalizeFields(scopeRaw);

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
                const source = (item.source === 'tag' || item.source === 'tags' || item.type === 'tags') ? 'tag' : 'step';
                const enumValues = item.enum ?? item.values;
                return {
                    name: item.name,
                    source,
                    enum: enumValues,
                    required: item.required,
                    default: item.default
                } as IField;
            }).filter(Boolean) as IField[];
        }
        if (typeof raw === 'object') {
            const result: IField[] = [];
            for (const [name, val] of Object.entries(raw)) {
                const fieldObj: any = (typeof val === 'object' && val !== null) ? val : {};
                const source = (fieldObj.source === 'tag' || fieldObj.source === 'tags' || fieldObj.type === 'tags') ? 'tag' : 'step';
                const enumValues = fieldObj.enum ?? fieldObj.values;
                result.push({
                    name: fieldObj.name ?? name,
                    source,
                    enum: enumValues,
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
        let version = config.version;
        if (!version && (config as any).testform) {
            const tf = (config as any).testform;
            version = typeof tf === 'string' ? tf : (tf.required_version || tf.version);
        }

        if (version == null || version === '') {
            notify.push({
                type: 'error',
                title: `Configuration is missing the "version" or "testform" field`,
                detail: [`Add a "testform" or "version" field to your ${basename(resolve!)} file and rerun init.`],
                close: true
            });
            return;
        }

        const versionStr = String(version);
        const isCompatible = versionStr === VERSION_CONFIG || 
            versionStr === '1.0.0' ||
            versionStr.startsWith(`${VERSION_CONFIG}`) || 
            versionStr.includes(`>= ${VERSION_CONFIG}`) ||
            versionStr.includes(`>=${VERSION_CONFIG}`) ||
            versionStr.startsWith('v1.0') ||
            versionStr.startsWith('1.');

        if (!isCompatible) {
            notify.push({
                type: 'error',
                title: `configuration version mismatch`,
                detail: [
                    `Found version "${version}", but expected "${VERSION_CONFIG}".`,
                    `Update ${basename(resolve!)} to version ${VERSION_CONFIG} and rerun init.`,
                ],
                close: true
            });
        }
    }
}