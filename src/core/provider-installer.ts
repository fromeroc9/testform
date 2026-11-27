import { join, resolve, basename, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { isGitSource, parseGitSource } from './module';
import { FILE_LOCK, FILE_ROOT_LOCK, VERSION_CLI } from './const';
import { isVersionCompatible } from './config';
import { cloneGitSource, listGitRemoteTags, selectHighestMatchingVersion } from './git-source';

export interface ProviderInstallSpec {
    source: string;
    version?: string;
    constraints?: string;
}

export interface InstalledProviderResult {
    name: string;
    source: string;
    version: string;
    constraints?: string;
    entrypoint: string;
    hash: string;
}

export interface LockedProviderEntry {
    version: string;
    constraints?: string;
    hashes?: string[];
}

export interface ProviderInstallOptions {
    resolveBuiltInSemver?: boolean;
}

/**
 * Calculates a SHA-256 hash formatted as Terraform lockfile hash (h1:<base64>).
 */
export function computeFileHash(filePath: string): string {
    const content = readFileSync(filePath);
    const hash = createHash('sha256').update(content).digest('base64');
    return `h1:${hash}`;
}

/**
 * Calculates a combined SHA-256 hash of a directory.
 */
export function computeDirectoryHash(dirPath: string): string {
    const hash = createHash('sha256');
    const scan = (current: string) => {
        const entries = readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                scan(full);
            } else if (entry.isFile()) {
                try {
                    hash.update(readFileSync(full));
                } catch {}
            }
        }
    };
    scan(dirPath);
    return `h1:${hash.digest('base64')}`;
}

/**
 * Resolves the executable entrypoint (.ts or .js) inside a provider directory.
 */
export function findProviderEntrypoint(providerDir: string, providerName?: string): string | null {
    if (!existsSync(providerDir)) return null;

    const stat = statSync(providerDir);
    if (stat.isFile()) return providerDir;

    // 1. Check package.json "main"
    const pkgPath = join(providerDir, 'package.json');
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            if (pkg.main) {
                const resolvedMain = join(providerDir, pkg.main);
                if (existsSync(resolvedMain)) return resolvedMain;
            }
        } catch {}
    }

    // 2. Standard candidate filenames
    const candidates = [
        'index.ts',
        'index.js',
        providerName ? `${providerName}.ts` : '',
        providerName ? `${providerName}.js` : '',
        'provider.ts',
        'provider.js',
        join('dist', 'index.js'),
        join('dist', 'index.mjs')
    ].filter(Boolean);

    for (const c of candidates) {
        const p = join(providerDir, c);
        if (existsSync(p)) return p;
    }

    // 3. Fallback: first .ts or .js file found in the directory
    try {
        const files = readdirSync(providerDir);
        const script = files.find(f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'));
        if (script) return join(providerDir, script);
    } catch {}

    return null;
}

export class ProviderInstaller {
    private workDir: string;
    private providersDir: string;

    constructor(workDir: string = '.') {
        this.workDir = workDir;
        this.providersDir = join(workDir, '.testform', 'providers');
    }

    /**
     * Reads previously recorded provider selections from `.testform/cache/lock.json`.
     */
    public readLockfile(): Record<string, LockedProviderEntry> {
        const lockJsonPath = resolve(this.workDir, FILE_LOCK);
        if (!existsSync(lockJsonPath)) return {};
        try {
            const parsed = JSON.parse(readFileSync(lockJsonPath, 'utf-8'));
            return parsed?.provider && typeof parsed.provider === 'object' ? parsed.provider : {};
        } catch {
            return {};
        }
    }

    /**
     * Checks whether a provider directory (or built-in) is already present for a locked selection.
     */
    public isProviderInstalled(name: string): boolean {
        const providerName = name.toLowerCase().trim();
        if (['local', 'github', 'gitlab'].includes(providerName)) {
            return true;
        }
        return findProviderEntrypoint(join(this.providersDir, providerName), providerName) !== null;
    }

    /**
     * Installs or updates a provider according to its specification.
     */
    public async install(
        name: string,
        spec: ProviderInstallSpec,
        logger?: { info: (msg: string | string[]) => void; warn: (msg: string | string[]) => void },
        options: ProviderInstallOptions = {}
    ): Promise<InstalledProviderResult> {
        const providerName = name.toLowerCase().trim();
        const targetDir = join(this.providersDir, providerName);

        if (!existsSync(this.providersDir)) {
            mkdirSync(this.providersDir, { recursive: true });
        }

        const source = (spec.source || '').trim();
        const declaredConstraint = spec.constraints || spec.version;
        let installedVersion = spec.version || '1.0.0';
        let calculatedHash = '';
        let entrypoint = '';

        // ── Case 0: Built-in provider (e.g. "github", "gitlab", "local", or "builtin/...") ──
        const BUILTIN_PROVIDERS = ['local', 'github', 'gitlab'];
        const isBuiltin = BUILTIN_PROVIDERS.includes(providerName) &&
            (!source || source === providerName || source === 'builtin' || source.startsWith('builtin/'));

        if (isBuiltin) {
            let resolvedVersion = spec.version || '1.0.0';
            if (options.resolveBuiltInSemver) {
                if (spec.version && !isVersionCompatible(VERSION_CLI, spec.version)) {
                    throw new Error(
                        `Built-in provider "${providerName}" (v${VERSION_CLI}) does not satisfy constraint "${spec.version}".`
                    );
                }
                resolvedVersion = VERSION_CLI;
            }
            logger?.info(`- Selecting built-in ${providerName} provider${resolvedVersion ? ` (${resolvedVersion})` : ''}`);
            return {
                name: providerName,
                source: `builtin/${providerName}`,
                version: resolvedVersion,
                constraints: declaredConstraint,
                entrypoint: `builtin/${providerName}`,
                hash: 'h1:builtin-provider-verified'
            };
        }

        // ── Case 1: Local path (e.g. "./custom-providers/local.ts" or "../shared/gitlab.js") ──
        if (source.startsWith('.') || source.startsWith('/') || source.includes(':\\')) {
            const localResolved = resolve(this.workDir, source);
            if (!existsSync(localResolved)) {
                throw new Error(`[Testform Provider Error] Local provider source not found: "${localResolved}"`);
            }

            if (!existsSync(targetDir)) {
                mkdirSync(targetDir, { recursive: true });
            }

            const stat = statSync(localResolved);
            if (stat.isFile()) {
                const fileName = basename(localResolved);
                const destFile = join(targetDir, fileName);
                copyFileSync(localResolved, destFile);
                entrypoint = destFile;
                calculatedHash = computeFileHash(destFile);
            } else {
                // Copy directory content
                execSync(`node -e "const fs = require('fs'); fs.cpSync(process.argv[1], process.argv[2], { recursive: true });" "${localResolved}" "${targetDir}"`, { stdio: 'pipe' });
                entrypoint = findProviderEntrypoint(targetDir, providerName) || targetDir;
                calculatedHash = computeDirectoryHash(targetDir);
            }

            return {
                name: providerName,
                source,
                version: spec.version || 'local',
                constraints: declaredConstraint,
                entrypoint,
                hash: calculatedHash
            };
        }

        // ── Case 2: Remote Git repository or Git subpath (e.g. git::https://...git//gitlab.ts?ref=v1.2.0) ──
        if (isGitSource(source)) {
            const parsed = parseGitSource(source);
            let sourceToClone = source;
            let ref = parsed.ref;

            if (!ref && spec.version) {
                const tags = listGitRemoteTags(parsed.repoUrl);
                const bestTag = selectHighestMatchingVersion(tags, spec.version);
                if (bestTag) {
                    ref = bestTag;
                    const sep = source.includes('?') ? '&' : '?';
                    sourceToClone = `${source}${sep}ref=${bestTag}`;
                } else if (tags.length > 0) {
                    throw new Error(
                        `No versions of provider "${providerName}" in ${parsed.repoUrl} match constraint "${spec.version}".`
                    );
                }
            }

            if (ref) {
                installedVersion = ref.replace(/^v/i, '');
            } else if (!spec.version || /[><=~^]/.test(spec.version)) {
                installedVersion = '1.0.0';
            }

            logger?.info(`- Finding ${providerName} in ${parsed.repoUrl}${ref ? ` (ref: ${ref})` : ''}...`);
            const cloned = cloneGitSource(
                sourceToClone,
                targetDir,
                join(this.workDir, '.testform', 'cache')
            );

            if (cloned.isSingleFile) {
                entrypoint = cloned.entrypointOrDir;
                calculatedHash = computeFileHash(entrypoint);
            } else {
                entrypoint = findProviderEntrypoint(targetDir, providerName) || targetDir;
                calculatedHash = computeDirectoryHash(targetDir);
            }

            return {
                name: providerName,
                source,
                version: installedVersion,
                constraints: declaredConstraint,
                entrypoint,
                hash: calculatedHash
            };
        }

        // ── Case 3: NPM Package or Registry (e.g. "@org/testform-provider-gitlab" or "npm::...") ──
        const npmPackage = source.replace(/^npm::/, '');
        let installSpec = npmPackage;

        if (spec.version) {
            try {
                const rawVersions = execFileSync('npm', ['view', npmPackage, 'versions', '--json'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 20000,
                    encoding: 'utf-8',
                });
                const parsedVersions = JSON.parse(rawVersions);
                const list = Array.isArray(parsedVersions) ? parsedVersions : [parsedVersions];
                const bestVersion = selectHighestMatchingVersion(list, spec.version);
                if (bestVersion) {
                    installedVersion = bestVersion;
                    installSpec = `${npmPackage}@${bestVersion}`;
                }
            } catch {
                // Fallback to direct npm install when registry metadata query is unavailable
            }
        }

        logger?.info(`- Installing ${providerName} package "${installSpec}"...`);

        if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
        }

        try {
            execFileSync('npm', ['install', '--prefix', targetDir, installSpec, '--no-save'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 120000
            });
            const installedPkgJson = join(targetDir, 'node_modules', ...npmPackage.split('/'), 'package.json');
            if (existsSync(installedPkgJson)) {
                try {
                    const pkgMeta = JSON.parse(readFileSync(installedPkgJson, 'utf-8'));
                    if (pkgMeta?.version) {
                        installedVersion = String(pkgMeta.version);
                    }
                } catch {}
            }
            entrypoint = findProviderEntrypoint(targetDir, providerName) || targetDir;
            calculatedHash = computeDirectoryHash(targetDir);

            return {
                name: providerName,
                source,
                version: installedVersion,
                constraints: declaredConstraint,
                entrypoint,
                hash: calculatedHash
            };
        } catch (err: any) {
            throw new Error(`Failed to install provider package "${npmPackage}": ${err.message || err}`);
        }
    }

    /**
     * Updates or creates the dependency lockfile with the installed provider metadata.
     */
    public recordLockfile(providers: InstalledProviderResult[]): void {
        if (providers.length === 0) return;

        // 1. JSON Cache Lockfile (.testform/cache/lock.json)
        const lockJsonPath = resolve(this.workDir, FILE_LOCK);
        const lockDir = dirname(lockJsonPath);
        if (!existsSync(lockDir)) {
            mkdirSync(lockDir, { recursive: true });
        }

        let lockJsonData: any = { provider: {} };
        if (existsSync(lockJsonPath)) {
            try {
                lockJsonData = JSON.parse(readFileSync(lockJsonPath, 'utf-8'));
                lockJsonData.provider = lockJsonData.provider || {};
            } catch {}
        }

        for (const p of providers) {
            lockJsonData.provider[p.name] = {
                version: p.version,
                constraints: p.constraints || `>= ${p.version}`,
                hashes: [p.hash]
            };
        }
        writeFileSync(lockJsonPath, JSON.stringify(lockJsonData, null, 2), 'utf-8');

        // 2. Standard Lockfile (.testform.lock in workspace root)
        const lockHclPath = resolve(this.workDir, FILE_ROOT_LOCK);
        let hclContent = `# This file is maintained automatically by "testform init".\n# Manual edits may be lost in future updates.\n\n`;

        for (const p of providers) {
            const constraintsVal = p.constraints || `>= ${p.version}`;
            hclContent += `provider "${p.name}" {\n`;
            hclContent += `  version     = "${p.version}"\n`;
            hclContent += `  constraints = "${constraintsVal}"\n`;
            hclContent += `  hashes = [\n`;
            hclContent += `    "${p.hash}",\n`;
            hclContent += `  ]\n`;
            hclContent += `}\n\n`;
        }
        writeFileSync(lockHclPath, hclContent, 'utf-8');
    }
}
