import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { cloneGitSource, listGitRemoteTags, selectHighestMatchingVersion } from './git-source';
import { isGitSource, ModuleDeclaration, ModuleRegistry, parseGitSource } from './module';

export interface InstalledModuleRecord {
    Key: string;
    Source: string;
    Version?: string;
    Dir: string;
}

export interface ModuleInstallLogger {
    info: (msg: string | string[], options?: any) => void;
    warn?: (msg: string | string[]) => void;
}

/**
 * Installs declared local and remote Git modules (recursively resolving child modules)
 * into `.testform/modules/` and writes `.testform/modules/modules.json`.
 */
export class ModuleInstaller {
    private workDir: string;
    private modulesDir: string;
    private cacheDir: string;

    constructor(workDir: string = '.') {
        this.workDir = resolve(workDir);
        this.modulesDir = join(this.workDir, '.testform', 'modules');
        this.cacheDir = join(this.workDir, '.testform', 'cache');
    }

    public installAll(logger?: ModuleInstallLogger): InstalledModuleRecord[] {
        const rootRegistry = new ModuleRegistry(this.workDir);
        const declaredModules = rootRegistry.getDeclaredModules();

        if (declaredModules.size === 0) {
            return [];
        }

        logger?.info('Initializing modules...', { bold: true });
        if (!existsSync(this.modulesDir)) {
            mkdirSync(this.modulesDir, { recursive: true });
        }

        const records: InstalledModuleRecord[] = [];
        const visitedDirs = new Set<string>([this.workDir]);

        for (const [name, mod] of declaredModules.entries()) {
            this.installModuleRecursive(name, mod, this.workDir, visitedDirs, records, logger, 0);
        }

        this.writeModulesManifest(records);
        return records;
    }

    private installModuleRecursive(
        moduleKey: string,
        mod: ModuleDeclaration,
        parentDir: string,
        visitedAncestors: Set<string>,
        records: InstalledModuleRecord[],
        logger: ModuleInstallLogger | undefined,
        depth: number
    ): void {
        if (depth > 10 || !mod.source) return;

        if (isGitSource(mod.source)) {
            let sourceToClone = mod.source;
            const parsed = parseGitSource(mod.source);
            let resolvedVersion = parsed.ref || mod.version || undefined;

            if (!parsed.ref && mod.version) {
                const tags = listGitRemoteTags(parsed.repoUrl);
                const bestTag = selectHighestMatchingVersion(tags, mod.version);
                if (bestTag) {
                    const sep = mod.source.includes('?') ? '&' : '?';
                    sourceToClone = `${mod.source}${sep}ref=${bestTag}`;
                    resolvedVersion = bestTag.replace(/^v/i, '');
                }
            }

            logger?.info(`Downloading ${mod.source} for ${moduleKey}...`);
            const targetDir = join(this.modulesDir, moduleKey);
            cloneGitSource(sourceToClone, targetDir, this.cacheDir);

            const relDir = `.testform/modules/${moduleKey}`;
            logger?.info(`- ${moduleKey} in ${relDir}`);

            records.push({
                Key: moduleKey,
                Source: mod.source,
                ...(resolvedVersion ? { Version: resolvedVersion } : {}),
                Dir: relDir,
            });

            this.installChildren(moduleKey, targetDir, visitedAncestors, records, logger, depth);
            return;
        }

        const resolvedCandidate = resolve(parentDir, mod.source);
        const moduleRootDir =
            existsSync(resolvedCandidate) && statSync(resolvedCandidate).isFile()
                ? dirname(resolvedCandidate)
                : resolvedCandidate;

        const relDisplay = (relative(this.workDir, moduleRootDir) || '.').replace(/\\/g, '/');
        logger?.info(`- ${moduleKey} in ${relDisplay}`);

        records.push({
            Key: moduleKey,
            Source: mod.source,
            ...(mod.version ? { Version: mod.version } : {}),
            Dir: relDisplay,
        });

        this.installChildren(moduleKey, moduleRootDir, visitedAncestors, records, logger, depth);
    }

    private installChildren(
        parentKey: string,
        moduleDir: string,
        visitedAncestors: Set<string>,
        records: InstalledModuleRecord[],
        logger: ModuleInstallLogger | undefined,
        depth: number
    ): void {
        if (
            visitedAncestors.has(moduleDir) ||
            !existsSync(moduleDir) ||
            !statSync(moduleDir).isDirectory()
        ) {
            return;
        }

        const nextVisited = new Set(visitedAncestors);
        nextVisited.add(moduleDir);
        const childRegistry = new ModuleRegistry(moduleDir);
        for (const [childName, childMod] of childRegistry.getDeclaredModules().entries()) {
            this.installModuleRecursive(
                `${parentKey}.${childName}`,
                childMod,
                moduleDir,
                nextVisited,
                records,
                logger,
                depth + 1
            );
        }
    }

    private writeModulesManifest(records: InstalledModuleRecord[]): void {
        const manifestPath = join(this.modulesDir, 'modules.json');
        const payload = {
            Modules: [{ Key: '', Source: '', Dir: '.' }, ...records],
        };
        writeFileSync(manifestPath, JSON.stringify(payload, null, 2), 'utf-8');
    }
}
