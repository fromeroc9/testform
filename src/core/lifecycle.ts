import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { normalizeAddress, addressesMatch } from './utils';

export interface LifecycleDeclaration {
    prevent_destroy?: boolean;
    ignore_changes?: string[];
}

export class LifecycleResolver {
    private globalDefaults: LifecycleDeclaration = {};
    private resourceRules: Map<string, LifecycleDeclaration> = new Map();
    private scopeDefaults: Map<string, LifecycleDeclaration> = new Map();
    private workDir: string;

    constructor(workDir: string = '.') {
        this.workDir = workDir;
        this.loadDeclarations();
    }

    /**
     * Loads lifecycle configurations from testform.yml and domain files.
     */
    public loadDeclarations(): void {
        const rootFiles = ['testform.yml', 'testform.yaml'];
        for (const name of rootFiles) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    if (parsed && typeof parsed.lifecycle === 'object') {
                        this.registerLifecycleBlock(parsed.lifecycle);
                    }
                } catch {
                    // ignore
                }
            }
        }

        const domainFiles = this.findDomainConfigFiles(this.workDir);
        for (const f of domainFiles) {
            try {
                const parsed = YAML.parse(readFileSync(f, 'utf-8'));
                if (parsed && typeof parsed.lifecycle === 'object') {
                    this.registerLifecycleBlock(parsed.lifecycle);
                }
            } catch {
                // ignore
            }
        }
    }

    private registerLifecycleBlock(block: any): void {
        if (!block || typeof block !== 'object') return;

        // 1. Direct top-level fields
        if (block.prevent_destroy !== undefined || block.ignore_changes !== undefined) {
            this.globalDefaults = {
                prevent_destroy: Boolean(block.prevent_destroy),
                ignore_changes: Array.isArray(block.ignore_changes) ? block.ignore_changes : []
            };
        }

        // 2. Scoped defaults (testcase, testrun, testplan)
        for (const scope of ['testcase', 'testrun', 'testplan']) {
            if (block[scope] && typeof block[scope] === 'object') {
                this.scopeDefaults.set(scope, {
                    prevent_destroy: Boolean(block[scope].prevent_destroy),
                    ignore_changes: Array.isArray(block[scope].ignore_changes) ? block[scope].ignore_changes : []
                });
            }
        }

        // 3. Resource specific rules
        if (block.resources && typeof block.resources === 'object') {
            for (const [addr, decl] of Object.entries(block.resources)) {
                if (decl && typeof decl === 'object') {
                    const norm = normalizeAddress(addr);
                    this.resourceRules.set(norm, {
                        prevent_destroy: Boolean((decl as any).prevent_destroy),
                        ignore_changes: Array.isArray((decl as any).ignore_changes) ? (decl as any).ignore_changes : []
                    });
                }
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

    /**
     * Resolves the effective lifecycle configuration for a resource given its identity and tags.
     */
    public getLifecycle(identity: string, tags: string[] = []): LifecycleDeclaration {
        const norm = normalizeAddress(identity);
        let preventDestroy = this.globalDefaults.prevent_destroy || false;
        let ignoreChanges = [...(this.globalDefaults.ignore_changes || [])];

        // Infer scope from identity
        for (const [scope, def] of this.scopeDefaults.entries()) {
            if (norm.includes(`.${scope}.`) || norm.startsWith(`${scope}.`)) {
                if (def.prevent_destroy !== undefined) preventDestroy = def.prevent_destroy;
                if (def.ignore_changes) ignoreChanges.push(...def.ignore_changes);
            }
        }

        // Check resource-specific rules
        for (const [addr, decl] of this.resourceRules.entries()) {
            if (addressesMatch(norm, addr)) {
                if (decl.prevent_destroy !== undefined) preventDestroy = decl.prevent_destroy;
                if (decl.ignore_changes) ignoreChanges.push(...decl.ignore_changes);
            }
        }

        // Parse Gherkin tags (highest precedence)
        for (const tag of tags) {
            const clean = tag.startsWith('@') ? tag.substring(1) : tag;

            // @prevent_destroy / @prevent-destroy
            if (clean === 'prevent_destroy' || clean === 'prevent-destroy') {
                preventDestroy = true;
            }

            // @ignore_changes("field1", "field2") or @ignore_changes(field1,field2)
            const match = clean.match(/^ignore_changes\((.*)\)$/);
            if (match) {
                const fields = match[1]
                    .split(',')
                    .map(f => f.trim().replace(/^['"]|['"]$/g, ''))
                    .filter(Boolean);
                ignoreChanges.push(...fields);
            }
        }

        return {
            prevent_destroy: preventDestroy,
            ignore_changes: Array.from(new Set(ignoreChanges))
        };
    }
}
