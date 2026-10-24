import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { State } from './state';
import { normalizeAddress, addressesMatch } from './utils';

export interface DataSourceDeclaration {
    address?: string;
    repository?: string;
    filter?: Record<string, any>;
    file?: string;
    [key: string]: any;
}

export class DataResolver {
    private declaredData: Record<string, DataSourceDeclaration> = {};
    private fileCache: Map<string, any> = new Map();
    private workDir: string;

    constructor(workDir: string = '.') {
        this.workDir = workDir;
        this.loadDeclarations();
    }

    /**
     * Loads data source declarations from testform.yml, data.yml, and domain files.
     */
    public loadDeclarations(): void {
        const dataMap: Record<string, DataSourceDeclaration> = {};

        // 1. Root testform.yml / testform.yaml
        for (const name of ['testform.yml', 'testform.yaml']) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    if (parsed && typeof parsed.data === 'object') {
                        this.registerDataBlock(parsed.data, dataMap);
                    }
                } catch {
                    // ignore
                }
            }
        }

        // 2. Root data.yml / data.yaml
        for (const name of ['data.yml', 'data.yaml']) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    if (parsed && typeof parsed === 'object') {
                        const target = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
                        this.registerDataBlock(target, dataMap);
                    }
                } catch {
                    // ignore
                }
            }
        }

        // 3. Domain and module files
        const domainFiles = this.findDomainConfigFiles(this.workDir);
        for (const f of domainFiles) {
            try {
                const parsed = YAML.parse(readFileSync(f, 'utf-8'));
                if (parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object') {
                    this.registerDataBlock(parsed.data, dataMap);
                }
            } catch {
                // ignore
            }
        }

        this.declaredData = dataMap;
    }

    private registerDataBlock(block: Record<string, any>, dest: Record<string, DataSourceDeclaration>): void {
        const KNOWN_SCOPES = new Set(['testcase', 'testrun', 'testplan']);

        for (const [key, val] of Object.entries(block)) {
            if (!val || typeof val !== 'object') continue;

            // Check if key is a scope grouping (e.g. data.testcase.login_core)
            if (KNOWN_SCOPES.has(key)) {
                for (const [subKey, subVal] of Object.entries(val)) {
                    if (subVal && typeof subVal === 'object') {
                        // Register both scoped and scopeless for maximum flexibility
                        dest[`${key}.${subKey}`] = subVal as DataSourceDeclaration;
                        dest[subKey] = subVal as DataSourceDeclaration;
                    }
                }
            } else {
                // Direct scopeless declaration (e.g. data.login_core)
                dest[key] = val as DataSourceDeclaration;
            }
        }
    }

    private findDomainConfigFiles(dir: string): string[] {
        const results: string[] = [];
        if (!existsSync(dir)) return results;

        const IGNORED_DIRS = new Set(['node_modules', '.git', '.testform', '.terraform', 'dist', 'coverage', '.system_generated']);
        const RESERVED_FILES = new Set(['testform.yml', 'testform.yaml', 'vars.yml', 'vars.yaml', 'local.yml', 'local.yaml', 'outputs.yml', 'outputs.yaml', 'data.yml', 'data.yaml']);

        const scan = (currentDir: string) => {
            try {
                const entries = readdirSync(currentDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                            scan(resolve(currentDir, entry.name));
                        }
                    } else if (entry.isFile()) {
                        const lower = entry.name.toLowerCase();
                        if ((lower.endsWith('.yml') || lower.endsWith('.yaml')) && !RESERVED_FILES.has(lower)) {
                            results.push(resolve(currentDir, entry.name));
                        }
                    }
                }
            } catch {
                // Ignore
            }
        };

        scan(dir);
        return results.sort();
    }

    public getDeclarations(): Record<string, DataSourceDeclaration> {
        return this.declaredData;
    }

    /**
     * Resolves a data source by name.
     */
    public resolveSource(sourceName: string, state?: State): any {
        const decl = this.declaredData[sourceName];
        if (!decl) return undefined;

        // Mode 1: File dataset / fixture
        if (decl.file) {
            const filePath = resolve(this.workDir, decl.file);
            if (this.fileCache.has(filePath)) {
                return this.fileCache.get(filePath);
            }
            if (existsSync(filePath)) {
                try {
                    const raw = readFileSync(filePath, 'utf-8');
                    const parsed = filePath.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);
                    this.fileCache.set(filePath, parsed);
                    return parsed;
                } catch {
                    return undefined;
                }
            }
            return undefined;
        }

        // Mode 2: Resource address reference
        if (decl.address) {
            return this.resolveAddress(decl.address, state);
        }

        // Mode 3: Filter reference
        if (decl.filter && state) {
            return this.resolveFilter(decl.filter, state);
        }

        return decl;
    }

    private resolveAddress(address: string, state?: State): any {
        // First check state if available
        if (state) {
            const resources = state.getResources();
            const res = resources.find(r => 
                addressesMatch(r.identity, address) ||
                addressesMatch(`${r.type}.${r.identity}`, address) ||
                addressesMatch(r.identity, address.replace(/^(github_|local_)?(testcase|testrun|testplan)\./, ''))
            );

            if (res) {
                const attrs = res.attributes || ({} as any);
                const featureIdx = res.identity.indexOf('.feature');
                let tag = '';
                let uri = res.identity;

                if (featureIdx !== -1) {
                    uri = res.identity.substring(0, featureIdx + 8);
                    const remaining = res.identity.substring(featureIdx + 8);
                    const tagMatch = remaining.match(/@([a-zA-Z0-9_-]+)/);
                    tag = tagMatch ? `@${tagMatch[1]}` : (remaining ? `@${remaining.replace(/^\./, '')}` : '');
                } else {
                    const tagMatch = res.identity.match(/@([a-zA-Z0-9_-]+)$/);
                    tag = tagMatch ? `@${tagMatch[1]}` : '';
                    uri = res.identity.replace(/\.@[a-zA-Z0-9_-]+$/, '');
                }

                return {
                    ...attrs,
                    id: attrs.remoteId || attrs.id || '',
                    remoteId: attrs.remoteId || attrs.id || '',
                    issueNumber: attrs.issueNumber !== undefined ? attrs.issueNumber : 0,
                    number: attrs.issueNumber !== undefined ? attrs.issueNumber : 0,
                    identity: res.identity,
                    address: res.identity,
                    tag,
                    uri,
                    title: attrs.title || '',
                    labels: attrs.labels || [],
                    status: attrs.status || '',
                    custom_fields: attrs.custom_fields || {}
                };
            }
        }

        // Fallback: parse address components from static reference
        const norm = normalizeAddress(address);
        const featureIdx = norm.indexOf('.feature');
        let tag = '';
        let uri = norm;

        if (featureIdx !== -1) {
            uri = norm.substring(0, featureIdx + 8);
            const remaining = norm.substring(featureIdx + 8);
            const tagMatch = remaining.match(/@([a-zA-Z0-9_-]+)/);
            tag = tagMatch ? `@${tagMatch[1]}` : (remaining ? `@${remaining.replace(/^\./, '')}` : '');
        } else {
            const tagMatch = norm.match(/@([a-zA-Z0-9_-]+)$/);
            tag = tagMatch ? `@${tagMatch[1]}` : '';
            uri = norm.replace(/\.@[a-zA-Z0-9_-]+$/, '');
        }

        // Try reading title from local file if it exists
        let title = '';
        const localFilePath = resolve(this.workDir, uri);
        if (existsSync(localFilePath)) {
            try {
                const lines = readFileSync(localFilePath, 'utf-8').split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (tag && line.includes(tag)) {
                        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                            const next = lines[j].trim();
                            if (next.startsWith('Scenario:') || next.startsWith('Feature:')) {
                                title = next.split(':').slice(1).join(':').trim();
                                break;
                            }
                        }
                    }
                }
            } catch {
                // ignore
            }
        }

        return {
            id: '',
            remoteId: '',
            issueNumber: 0,
            number: 0,
            identity: norm,
            address: norm,
            tag,
            uri,
            title,
            labels: tag ? [tag.replace('@', '')] : [],
            status: '',
            custom_fields: {}
        };
    }

    private resolveFilter(filter: Record<string, any>, state: State): any[] {
        const resources = state.getResources();
        return resources.filter(r => {
            const attrs = r.attributes || ({} as any);
            if (filter.tags && Array.isArray(filter.tags)) {
                const rLabels = attrs.labels || [];
                const hasAll = filter.tags.every((t: string) => {
                    const cleanTag = t.startsWith('@') ? t.substring(1) : t;
                    return rLabels.includes(cleanTag) || rLabels.includes(t);
                });
                if (!hasAll) return false;
            }
            for (const [k, v] of Object.entries(filter)) {
                if (k === 'tags') continue;
                if (attrs[k] !== v && attrs.custom_fields?.[k] !== v) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Resolves a dotted path like "usuarios_saucedemo.standard_user.username"
     * or "login_testcase.id" or "testcase.login_testcase.tag".
     */
    public resolvePath(pathStr: string, state?: State): any {
        const parts = pathStr.split('.');

        // 1. Try finding matching declared source with longest key match
        for (let i = parts.length; i >= 1; i--) {
            const candidateSource = parts.slice(0, i).join('.');
            if (this.declaredData[candidateSource]) {
                const dataObj = this.resolveSource(candidateSource, state);
                const subPath = parts.slice(i);

                if (subPath.length === 0) {
                    return dataObj;
                }

                let current = dataObj;
                for (const p of subPath) {
                    if (current === undefined || current === null) break;
                    current = current[p];
                }
                return current;
            }
        }

        return undefined;
    }
}
