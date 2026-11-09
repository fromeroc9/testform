/**
 * @fileoverview High-performance incremental file cache for parsed AST and scenarios.
 * Uses file mtime and size to skip parsing untouched .feature files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { DIR_CACHE } from './const';
import { ParserScenario } from './types';

interface CachedFileEntry {
    mtimeMs: number;
    size: number;
    scenarios: ParserScenario[];
}

export class AstCache {
    private cacheDir: string;
    private cacheFilePath: string;
    private memoryCache = new Map<string, CachedFileEntry>();
    private isDirty = false;

    constructor(projectRoot: string) {
        this.cacheDir = join(projectRoot, DIR_CACHE);
        this.cacheFilePath = join(this.cacheDir, 'parser-ast.json');
        this.load();
    }

    private load(): void {
        try {
            if (existsSync(this.cacheFilePath)) {
                const data = JSON.parse(readFileSync(this.cacheFilePath, 'utf8'));
                if (data && typeof data === 'object') {
                    for (const [file, entry] of Object.entries(data)) {
                        this.memoryCache.set(file, entry as CachedFileEntry);
                    }
                }
            }
        } catch {
            // Ignore cache corruptions, will regenerate gracefully
        }
    }

    public get(filePath: string): ParserScenario[] | undefined {
        try {
            const stat = statSync(filePath);
            const cached = this.memoryCache.get(filePath);
            if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
                return cached.scenarios;
            }
        } catch {}
        return undefined;
    }

    public set(filePath: string, scenarios: ParserScenario[]): void {
        try {
            const stat = statSync(filePath);
            this.memoryCache.set(filePath, {
                mtimeMs: stat.mtimeMs,
                size: stat.size,
                scenarios,
            });
            this.isDirty = true;
        } catch {}
    }

    public save(): void {
        if (!this.isDirty) return;
        try {
            if (!existsSync(this.cacheDir)) {
                mkdirSync(this.cacheDir, { recursive: true });
            }
            const serialized: Record<string, CachedFileEntry> = {};
            for (const [file, entry] of this.memoryCache.entries()) {
                serialized[file] = entry;
            }
            writeFileSync(this.cacheFilePath, JSON.stringify(serialized), 'utf8');
            this.isDirty = false;
        } catch {}
    }
}
