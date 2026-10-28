import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { CONFIG_FILE_NAMES } from './const';
import { normalizeAddress, addressesMatch, findDomainConfigFiles } from './utils';

export interface LifecycleDeclaration {
    prevent_destroy?: boolean;
    ignore_changes?: string[];
}

export class LifecycleResolver {
    private globalDefaults: LifecycleDeclaration = {};
    private scopeDefaults: Map<string, LifecycleDeclaration> = new Map();
    private workDir: string;

    constructor(workDir: string = '.') {
        this.workDir = workDir;
        this.loadDeclarations();
    }

    /**
     * Loads lifecycle configurations from resource declarations in main.yml, resource.yml, and domain files.
     * In strict Terraform parity, lifecycle is a meta-argument block inside resource.
     */
    public loadDeclarations(): void {
        const rootFiles = CONFIG_FILE_NAMES;
        for (const name of rootFiles) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    this.processParsedYaml(parsed);
                } catch {
                    // ignore
                }
            }
        }

        const domainFiles = findDomainConfigFiles(this.workDir);
        for (const f of domainFiles) {
            try {
                const parsed = YAML.parse(readFileSync(f, 'utf-8'));
                this.processParsedYaml(parsed);
            } catch {
                // ignore
            }
        }
    }

    private processParsedYaml(parsed: any): void {
        if (!parsed || typeof parsed !== 'object') return;

        // Terraform Parity: resource.<type>.lifecycle: { ... }
        const resBlock = parsed.resource;
        if (resBlock && typeof resBlock === 'object') {
            for (const [scope, decl] of Object.entries(resBlock)) {
                if (decl && typeof decl === 'object' && (decl as any).lifecycle) {
                    this.registerScopeLifecycle(scope, (decl as any).lifecycle);
                }
            }
        }

        // Standalone resource.yml without resource wrapper: testcase: { lifecycle: { ... } }
        for (const scope of ['testcase', 'testrun', 'testplan', 'global']) {
            if (parsed[scope] && typeof parsed[scope] === 'object' && parsed[scope].lifecycle) {
                this.registerScopeLifecycle(scope, parsed[scope].lifecycle);
            }
        }
    }

    private registerScopeLifecycle(scope: string, lc: any): void {
        if (!lc || typeof lc !== 'object') return;

        if (scope === 'global') {
            this.globalDefaults = {
                prevent_destroy: lc.prevent_destroy !== undefined ? Boolean(lc.prevent_destroy) : this.globalDefaults.prevent_destroy,
                ignore_changes: Array.isArray(lc.ignore_changes)
                    ? Array.from(new Set([...(this.globalDefaults.ignore_changes || []), ...lc.ignore_changes]))
                    : this.globalDefaults.ignore_changes || []
            };
            return;
        }

        const existing = this.scopeDefaults.get(scope) || {};
        this.scopeDefaults.set(scope, {
            prevent_destroy: lc.prevent_destroy !== undefined ? Boolean(lc.prevent_destroy) : existing.prevent_destroy,
            ignore_changes: Array.isArray(lc.ignore_changes)
                ? Array.from(new Set([...(existing.ignore_changes || []), ...lc.ignore_changes]))
                : existing.ignore_changes || []
        });
    }

    /**
     * Resolves the effective lifecycle configuration for a resource given its identity and tags.
     */
    public getLifecycle(identity: string, tags: string[] = []): LifecycleDeclaration {
        const norm = normalizeAddress(identity);
        let preventDestroy = this.globalDefaults.prevent_destroy || false;
        let ignoreChanges = [...(this.globalDefaults.ignore_changes || [])];

        // Infer scope from identity (e.g. testcase / .case., testrun / .run., testplan / .plan.)
        for (const [scope, def] of this.scopeDefaults.entries()) {
            const matchesScope =
                (scope === 'testcase' && (norm.includes('.case.') || norm.includes('testcase'))) ||
                (scope === 'testrun' && (norm.includes('.run.') || norm.includes('testrun'))) ||
                (scope === 'testplan' && (norm.includes('.plan.') || norm.includes('testplan'))) ||
                norm.includes(`.${scope}.`) || norm.startsWith(`${scope}.`);

            if (matchesScope) {
                if (def.prevent_destroy !== undefined) preventDestroy = def.prevent_destroy;
                if (def.ignore_changes) ignoreChanges.push(...def.ignore_changes);
            }
        }

        // Parse Gherkin tags (highest precedence for scenario instance)
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
