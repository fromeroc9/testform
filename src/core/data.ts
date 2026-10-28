import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { State } from './state';
import { normalizeAddress, addressesMatch } from './utils';
import { CONFIG_FILE_NAMES } from './const';
import { resource } from './resources';

export interface DataSourceDeclaration {
    address?: string;
    repository?: string;
    filter?: Record<string, any>;
    file?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    request_headers?: Record<string, string>;
    body?: any;
    request_body?: any;
    timeout?: number;
    [key: string]: any;
}

export class DataResolver {
    private declaredData: Record<string, DataSourceDeclaration> = {};
    private fileCache: Map<string, any> = new Map();
    private httpCache: Map<string, any> = new Map();
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

        // 1. Root main.yml / CONFIG_FILE_NAMES
        for (const name of CONFIG_FILE_NAMES) {
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
        const KNOWN_SCOPES = new Set([
            'testcase', 'testrun', 'testplan', 'local_file', 'http'
        ]);

        for (const [key, val] of Object.entries(block)) {
            if (val === undefined || val === null) continue;

            // 1. Grouped by scope/type: e.g. local_file: { users: "..." } or http: { api: "..." } or testcase: { login: "..." }
            if (KNOWN_SCOPES.has(key) && typeof val === 'object' && !Array.isArray(val)) {
                for (const [subKey, subVal] of Object.entries(val)) {
                    if (typeof subVal === 'string') {
                        let decl: DataSourceDeclaration;
                        if (key === 'local_file') {
                            decl = { type: 'local_file', file: subVal };
                        } else if (key === 'http') {
                            decl = { type: 'http', url: subVal, method: 'GET' };
                        } else {
                            decl = { type: key, address: subVal };
                        }
                        dest[`${key}.${subKey}`] = decl;
                        dest[subKey] = decl;
                    } else if (subVal && typeof subVal === 'object') {
                        const decl: DataSourceDeclaration = { type: key, ...(subVal as any) };
                        dest[`${key}.${subKey}`] = decl;
                        dest[subKey] = decl;
                    }
                }
                continue;
            }

            // 2. Inline single-line string at root: e.g. users: "fixtures/users.json" or api: "https://api..." or login: "auth/login.case.feature.@tc-1"
            if (typeof val === 'string') {
                const lower = val.toLowerCase().trim();
                const isHttp = lower.startsWith('http://') || lower.startsWith('https://');
                const isFile = lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.csv');

                if (isHttp) {
                    const decl: DataSourceDeclaration = { type: 'http', url: val, method: 'GET' };
                    dest[key] = decl;
                    dest[`http.${key}`] = decl;
                    continue;
                }

                const decl: DataSourceDeclaration = isFile ? { type: 'local_file', file: val } : { address: val };
                dest[key] = decl;

                if (isFile) {
                    dest[`local_file.${key}`] = decl;
                } else if (lower.includes('.case.') || lower.includes('@tc')) {
                    dest[`testcase.${key}`] = decl;
                } else if (lower.includes('.run.') || lower.includes('@tr')) {
                    dest[`testrun.${key}`] = decl;
                } else if (lower.includes('.plan.') || lower.includes('@tp')) {
                    dest[`testplan.${key}`] = decl;
                }
                continue;
            }

            // 3. Direct dictionary object: e.g. login: { address: "..." } or users: { file: "..." } or api: { url: "..." }
            if (typeof val === 'object') {
                dest[key] = val as DataSourceDeclaration;
            }
        }
    }

    private findDomainConfigFiles(dir: string): string[] {
        const results: string[] = [];
        if (!existsSync(dir)) return results;

        const IGNORED_DIRS = new Set(['node_modules', '.git', '.testform', '.terraform', 'dist', 'coverage', '.system_generated']);
        const RESERVED_FILES = new Set([
            ...CONFIG_FILE_NAMES,
            'variables.yml', 'variables.yaml',
            'vars.yml', 'vars.yaml',
            'locals.yml', 'locals.yaml',
            'local.yml', 'local.yaml',
            'outputs.yml', 'outputs.yaml',
            'data.yml', 'data.yaml'
        ]);

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

        // Mode 2: HTTP endpoint data source (Terraform data "http" parity, GET & POST)
        if (decl.type === 'http' || decl.url || sourceName.startsWith('http.')) {
            return this.resolveHttp(decl);
        }

        // Mode 3: Resource address reference
        if (decl.address) {
            return this.resolveAddress(decl.address, state);
        }

        // Mode 4: Filter reference
        if (decl.filter && state) {
            return this.resolveFilter(decl.filter, state);
        }

        return decl;
    }

    private resolveHttp(decl: DataSourceDeclaration): any {
        const url = decl.url || decl.address || '';
        if (!url) return undefined;

        const method = (decl.method || (decl.body || decl.request_body ? 'POST' : 'GET')).toUpperCase();
        const headers: Record<string, string> = { ...(decl.headers || decl.request_headers || {}) };
        let body = decl.body || decl.request_body;
        if (body && typeof body === 'object') {
            body = JSON.stringify(body);
            if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
                headers['Content-Type'] = 'application/json';
            }
        }

        const cacheKey = `${method}:${url}:${body || ''}`;
        if (this.httpCache.has(cacheKey)) {
            return this.httpCache.get(cacheKey);
        }

        try {
            const { execFileSync } = require('child_process');
            const script = `
                const input = JSON.parse(process.argv[1]);
                const opts = {
                    method: input.method,
                    headers: input.headers || {}
                };
                if (input.body) opts.body = input.body;

                fetch(input.url, opts)
                    .then(async res => {
                        const text = await res.text();
                        const headersObj = {};
                        res.headers.forEach((v, k) => { headersObj[k] = v; });
                        process.stdout.write(JSON.stringify({
                            status_code: res.status,
                            response_headers: headersObj,
                            response_body: text
                        }));
                    })
                    .catch(err => {
                        process.stdout.write(JSON.stringify({
                            error: err.message,
                            status_code: 0,
                            response_headers: {},
                            response_body: ''
                        }));
                    });
            `;

            const payload = JSON.stringify({ url, method, headers, body });
            const out = execFileSync(process.execPath, ['-e', script, payload], {
                encoding: 'utf-8',
                timeout: decl.timeout || 10000,
                stdio: ['ignore', 'pipe', 'ignore']
            });

            const parsed = JSON.parse(out.trim());
            let jsonBody: any = null;
            if (parsed.response_body) {
                try {
                    jsonBody = JSON.parse(parsed.response_body);
                } catch {
                    jsonBody = null;
                }
            }

            const result = {
                id: url,
                url,
                method,
                status_code: parsed.status_code,
                response_headers: parsed.response_headers || {},
                response_body: parsed.response_body,
                body: jsonBody !== null ? jsonBody : parsed.response_body,
                data: jsonBody !== null ? jsonBody : parsed.response_body,
                ...(typeof jsonBody === 'object' && jsonBody !== null && !Array.isArray(jsonBody) ? jsonBody : {}),
            };

            this.httpCache.set(cacheKey, result);
            return result;
        } catch {
            return {
                id: url,
                url,
                method,
                status_code: 0,
                response_headers: {},
                response_body: '',
                body: null
            };
        }
    }

    private resolveAddress(address: string, state?: State): any {
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

        const cleanTag = tag ? tag.replace(/^@/, '') : '';

        // 1. Check State if available
        if (state) {
            const resources = state.getResources();
            const matched = resources.filter(r => {
                // Exact match on identity or type.identity
                if (addressesMatch(r.identity, address) ||
                    addressesMatch(`${r.type}.${r.identity}`, address) ||
                    addressesMatch(r.identity, address.replace(/^(github_|local_)?(testcase|testrun|testplan)\./, ''))) {
                    return true;
                }

                // Tag or label match
                if (cleanTag) {
                    const rLabels = (r.attributes && r.attributes.labels) || [];
                    const hasLabel = rLabels.includes(cleanTag) || rLabels.includes(`@${cleanTag}`);
                    const hasTagInIdentity = r.identity.endsWith(`.@${cleanTag}`) || r.identity.includes(`.@${cleanTag}.`) || r.identity.includes(`@${cleanTag}`);
                    if (hasLabel || hasTagInIdentity) {
                        if (uri && uri !== norm && !r.identity.includes(uri)) {
                            return false;
                        }
                        return true;
                    }
                }

                // URI match without tag
                if (!cleanTag && uri && r.identity.includes(uri)) {
                    return true;
                }

                return false;
            });

            if (matched.length > 1) {
                return matched.map(r => this.formatResourceAttrs(r));
            } else if (matched.length === 1) {
                return this.formatResourceAttrs(matched[0]);
            }
        }

        // 2. Static parsing from local .feature file
        const localFilePath = resolve(this.workDir, uri);
        if (existsSync(localFilePath)) {
            try {
                const content = readFileSync(localFilePath, 'utf-8');
                const scenarios = this.extractScenariosFromFile(content, uri);

                let matching = scenarios;
                if (cleanTag) {
                    const featureHeader = content.split(/Scenario:|Scenario Outline:/i)[0];
                    const featureHasTag = featureHeader.includes(`@${cleanTag}`);
                    if (!featureHasTag) {
                        matching = scenarios.filter(s =>
                            s.labels.includes(cleanTag) ||
                            s.labels.includes(`@${cleanTag}`) ||
                            s.tag === `@${cleanTag}`
                        );
                    }
                }

                if (matching.length > 1) {
                    return matching;
                } else if (matching.length === 1) {
                    return matching[0];
                }
            } catch {
                // fallback
            }
        }

        // 3. Fallback: single placeholder resource
        return {
            id: '',
            remoteId: '',
            issueNumber: 0,
            number: 0,
            identity: norm,
            address: norm,
            tag,
            uri,
            title: '',
            labels: tag ? [cleanTag] : [],
            status: '',
            custom_fields: {}
        };
    }

    private extractScenariosFromFile(content: string, uri: string): any[] {
        const lines = content.split('\n');
        const scenarios: any[] = [];
        let currentTags: string[] = [];
        let featureTags: string[] = [];
        let inFeatureHeader = true;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('#')) continue;

            if (line.startsWith('@')) {
                const lineTags = line.split(/\s+/).filter(t => t.startsWith('@'));
                if (inFeatureHeader) {
                    featureTags.push(...lineTags);
                } else {
                    currentTags.push(...lineTags);
                }
                continue;
            }

            if (line.startsWith('Feature:')) {
                inFeatureHeader = false;
                continue;
            }

            const isScenario = line.startsWith('Scenario:') || line.startsWith('Scenario Outline:');
            if (isScenario) {
                const title = line.replace(/^(Scenario:|Scenario Outline:)/i, '').trim();
                const allTags = [...new Set([...featureTags, ...currentTags])];
                const idTag = allTags.find(t => t.match(/^@(tc|tr|tp)-/i)) || allTags[0] || '';
                const cleanLabels = allTags.map(t => t.replace(/^@/, ''));
                const scenIdentity = `${uri}.${idTag || `@scenario-${scenarios.length + 1}`}`;

                scenarios.push({
                    id: '',
                    remoteId: '',
                    issueNumber: 0,
                    number: 0,
                    identity: scenIdentity,
                    address: scenIdentity,
                    tag: idTag,
                    uri,
                    title,
                    labels: cleanLabels,
                    status: '',
                    custom_fields: {}
                });

                currentTags = [];
            }
        }

        return scenarios;
    }

    private formatResourceAttrs(r: any): any {
        const attrs = r.attributes || ({} as any);
        const featureIdx = r.identity.indexOf('.feature');
        let tag = '';
        let uri = r.identity;

        if (featureIdx !== -1) {
            uri = r.identity.substring(0, featureIdx + 8);
            const remaining = r.identity.substring(featureIdx + 8);
            const tagMatch = remaining.match(/@([a-zA-Z0-9_-]+)/);
            tag = tagMatch ? `@${tagMatch[1]}` : (remaining ? `@${remaining.replace(/^\./, '')}` : '');
        } else {
            const tagMatch = r.identity.match(/@([a-zA-Z0-9_-]+)$/);
            tag = tagMatch ? `@${tagMatch[1]}` : '';
            uri = r.identity.replace(/\.@[a-zA-Z0-9_-]+$/, '');
        }

        return {
            ...attrs,
            id: attrs.remoteId || attrs.id || '',
            remoteId: attrs.remoteId || attrs.id || '',
            issueNumber: attrs.issueNumber !== undefined ? attrs.issueNumber : 0,
            number: attrs.issueNumber !== undefined ? attrs.issueNumber : 0,
            identity: r.identity,
            address: r.identity,
            tag,
            uri,
            title: attrs.title || '',
            labels: attrs.labels || [],
            status: attrs.status || '',
            custom_fields: attrs.custom_fields || {}
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
     * Resolves a dotted or bracketed path like "usuarios_saucedemo.standard_user.username",
     * "smoke_suite[0].title", "smoke_suite.0.title", or Terraform Splat expressions
     * "smoke_suite[*].title" / "smoke_suite.*.title".
     */
    public resolvePath(pathStr: string, state?: State): any {
        const normalized = pathStr
            .replace(/\[\*\]/g, '.*')
            .replace(/\[(\d+)\]/g, '.$1')
            .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');
        const parts = normalized.split('.');

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
                for (let j = 0; j < subPath.length; j++) {
                    const p = subPath[j];
                    if (current === undefined || current === null) break;

                    if (p === '*' && Array.isArray(current)) {
                        const remaining = subPath.slice(j + 1);
                        if (remaining.length === 0) {
                            return current;
                        }
                        return current.map(item => {
                            let val = item;
                            for (const prop of remaining) {
                                if (val === undefined || val === null) break;
                                val = val[prop];
                            }
                            return val;
                        });
                    }

                    current = current[p];
                }
                return current;
            }
        }

        return undefined;
    }
}
