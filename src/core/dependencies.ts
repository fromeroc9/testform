import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { normalizeAddress, addressesMatch, findDomainConfigFiles, reassembleSplitTags } from './utils';
import { CONFIG_FILE_NAMES } from './const';

export interface DependencyDeclaration {
    depends_on?: string[];
}

export class DependencyResolver {
    private declaredDependencies: Map<string, string[]> = new Map();
    private workDir: string;

    constructor(workDir: string = '.') {
        this.workDir = workDir;
        this.loadDeclarations();
    }

    /**
     * Loads dependency declarations from main.yml and domain files.
     */
    public loadDeclarations(): void {
        const rootFiles = CONFIG_FILE_NAMES;
        for (const name of rootFiles) {
            const p = resolve(this.workDir, name);
            if (existsSync(p)) {
                try {
                    const parsed = YAML.parse(readFileSync(p, 'utf-8'));
                    if (parsed) {
                        this.registerConfigBlock(parsed);
                    }
                } catch {
                    // ignore
                }
            }
        }

        const domainFiles = findDomainConfigFiles(this.workDir);
        for (const f of domainFiles) {
            try {
                const parsed = YAML.parse(readFileSync(f, 'utf-8'));
                if (parsed) {
                    this.registerConfigBlock(parsed);
                }
            } catch {
                // ignore
            }
        }
    }

    private registerConfigBlock(parsed: any): void {
        if (!parsed || typeof parsed !== 'object') return;

        // 1. dependencies: { "target": ["dep1", "dep2"] } or { "target": { depends_on: [...] } }
        const depsBlock = parsed.dependencies || parsed.depends_on;
        if (depsBlock && typeof depsBlock === 'object') {
            for (const [addr, decl] of Object.entries(depsBlock)) {
                const norm = normalizeAddress(addr);
                let list: string[] = [];
                if (Array.isArray(decl)) {
                    list = decl.map(s => normalizeAddress(String(s)));
                } else if (decl && typeof decl === 'object' && Array.isArray((decl as any).depends_on)) {
                    list = (decl as any).depends_on.map((s: any) => normalizeAddress(String(s)));
                }
                if (list.length > 0) {
                    const existing = this.declaredDependencies.get(norm) || [];
                    this.declaredDependencies.set(norm, Array.from(new Set([...existing, ...list])));
                }
            }
        }

        // 2. resources: { "target": { depends_on: [...] } }
        if (parsed.resources && typeof parsed.resources === 'object') {
            for (const [addr, decl] of Object.entries(parsed.resources)) {
                if (decl && typeof decl === 'object' && Array.isArray((decl as any).depends_on)) {
                    const norm = normalizeAddress(addr);
                    const list = (decl as any).depends_on.map((s: any) => normalizeAddress(String(s)));
                    const existing = this.declaredDependencies.get(norm) || [];
                    this.declaredDependencies.set(norm, Array.from(new Set([...existing, ...list])));
                }
            }
        }
    }

    /**
     * Extracts depends_on targets for a resource given its identity and Gherkin tags.
     */
    public getDependencies(identity: string, tags: string[] = []): string[] {
        const norm = normalizeAddress(identity);
        const deps: string[] = [];

        // Check declared dependencies
        for (const [addr, list] of this.declaredDependencies.entries()) {
            if (addressesMatch(norm, addr)) {
                deps.push(...list);
            }
        }

        // In Gherkin, an inner '@' in @depends_on("path.@tag") gets split by Cucumber into separate tags
        const reassembledTags = reassembleSplitTags(tags, '@depends_on(');

        // Parse Gherkin tags: @depends_on("target1", "target2") or @depends_on(target1, target2)
        for (const tag of reassembledTags) {
            const clean = tag.startsWith('@') ? tag.substring(1) : tag;
            const match = clean.match(/^depends_on\((.*)\)$/);
            if (match) {
                const targets = match[1]
                    .split(',')
                    .map(t => normalizeAddress(t.trim().replace(/^['"]|['"]$/g, '')))
                    .filter(Boolean);
                deps.push(...targets);
            }
        }

        return Array.from(new Set(deps));
    }

    /**
     * Topologically sorts an array of items based on their dependencies.
     * Throws an error if a circular dependency cycle is detected.
     */
    public sortTopologically<T>(
        items: T[],
        getIdentity: (item: T) => string,
        getTags?: (item: T) => string[]
    ): T[] {
        const itemMap = new Map<string, T>();
        const adj = new Map<string, string[]>();
        const inDegree = new Map<string, number>();

        // Initialize maps
        for (const item of items) {
            const rawId = getIdentity(item);
            const id = normalizeAddress(rawId);
            itemMap.set(id, item);
            adj.set(id, []);
            inDegree.set(id, 0);
        }

        // Build graph edges: if B depends on A (A must run before B), edge is A -> B
        for (const item of items) {
            const rawId = getIdentity(item);
            const id = normalizeAddress(rawId);
            const tags = getTags ? getTags(item) : [];
            const dependencies = this.getDependencies(id, tags);

            for (const dep of dependencies) {
                // Find matching dependency in items
                let matchedDepId: string | null = null;
                for (const existingId of itemMap.keys()) {
                    if (
                        addressesMatch(existingId, dep) ||
                        existingId.endsWith(`.${dep}`) ||
                        existingId.endsWith(`/${dep}`) ||
                        dep.endsWith(`.${existingId}`) ||
                        dep.endsWith(`/${existingId}`)
                    ) {
                        matchedDepId = existingId;
                        break;
                    }
                }

                if (matchedDepId) {
                    // matchedDepId must be executed before id
                    adj.get(matchedDepId)!.push(id);
                    inDegree.set(id, (inDegree.get(id) || 0) + 1);
                }
            }
        }

        // Enforce hierarchical lifecycle dependencies: testcase -> testrun -> testplan
        for (const item of items) {
            const rawId = getIdentity(item);
            const id = normalizeAddress(rawId);
            const isRun = id.includes('testrun') || id.includes('.run.');
            const isPlan = id.includes('testplan') || id.includes('.plan.');

            if (isRun) {
                for (const other of items) {
                    const otherId = normalizeAddress(getIdentity(other));
                    const otherIsCase = !otherId.includes('testrun') && !otherId.includes('.run.') && !otherId.includes('testplan') && !otherId.includes('.plan.');
                    if (otherIsCase) {
                        adj.get(otherId)!.push(id);
                        inDegree.set(id, (inDegree.get(id) || 0) + 1);
                    }
                }
            } else if (isPlan) {
                for (const other of items) {
                    const otherId = normalizeAddress(getIdentity(other));
                    const otherIsRun = otherId.includes('testrun') || otherId.includes('.run.');
                    if (otherIsRun) {
                        adj.get(otherId)!.push(id);
                        inDegree.set(id, (inDegree.get(id) || 0) + 1);
                    }
                }
            }
        }

        // Kahn's algorithm for Topological Sort
        const queue: string[] = [];
        for (const [id, deg] of inDegree.entries()) {
            if (deg === 0) {
                queue.push(id);
            }
        }

        const sorted: T[] = [];
        while (queue.length > 0) {
            const u = queue.shift()!;
            sorted.push(itemMap.get(u)!);

            for (const v of adj.get(u) || []) {
                const newDeg = inDegree.get(v)! - 1;
                inDegree.set(v, newDeg);
                if (newDeg === 0) {
                    queue.push(v);
                }
            }
        }

        // If cycle exists, sorted.length will be less than items.length
        if (sorted.length < items.length) {
            const cycleNodes = Array.from(inDegree.entries())
                .filter(([_, deg]) => deg > 0)
                .map(([id]) => id);
            throw new Error(`Cycle: ${cycleNodes.join(', ')}`);
        }

        return sorted;
    }
}
