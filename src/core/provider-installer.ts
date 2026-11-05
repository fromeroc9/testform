import { join, resolve, basename, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { isGitSource, parseGitSource } from './module';
import { FILE_LOCK } from './const';

export interface ProviderInstallSpec {
    source: string;
    version?: string;
    constraints?: string;
}

export interface InstalledProviderResult {
    name: string;
    source: string;
    version: string;
    entrypoint: string;
    hash: string;
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
     * Installs or updates a provider according to its specification.
     */
    public async install(
        name: string,
        spec: ProviderInstallSpec,
        logger?: { info: (msg: string | string[]) => void; warn: (msg: string | string[]) => void }
    ): Promise<InstalledProviderResult> {
        const providerName = name.toLowerCase().trim();
        const targetDir = join(this.providersDir, providerName);

        if (!existsSync(this.providersDir)) {
            mkdirSync(this.providersDir, { recursive: true });
        }

        const source = spec.source.trim();
        let installedVersion = spec.version || '1.0.0';
        let calculatedHash = '';
        let entrypoint = '';

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
                entrypoint,
                hash: calculatedHash
            };
        }

        // ── Case 2: Remote Git repository or Git subpath (e.g. git::https://...git//gitlab.ts?ref=v1.2.0) ──
        if (isGitSource(source)) {
            const parsed = parseGitSource(source);
            const ref = parsed.ref || spec.version;
            if (ref) installedVersion = ref.replace(/^v/, '');

            logger?.info(`- Finding ${providerName} in ${parsed.repoUrl}${ref ? ` (ref: ${ref})` : ''}...`);

            // Clean previous installation if needed
            if (existsSync(targetDir)) {
                try {
                    rmSync(targetDir, { recursive: true, force: true });
                } catch {}
            }
            mkdirSync(targetDir, { recursive: true });

            if (parsed.subPath) {
                // User specified a single file or sub-folder inside the repo (e.g. //gitlab.ts or //providers/gitlab)
                const tempCloneDir = join(this.workDir, '.testform', 'cache', `git-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
                mkdirSync(tempCloneDir, { recursive: true });

                try {
                    const branchArg = ref ? `--branch "${ref}"` : '';
                    execSync(`git clone --depth 1 ${branchArg} "${parsed.repoUrl}" "${tempCloneDir}"`, {
                        stdio: ['ignore', 'pipe', 'pipe'],
                        timeout: 120000
                    });

                    const sourceSubPath = join(tempCloneDir, parsed.subPath);
                    if (!existsSync(sourceSubPath)) {
                        throw new Error(`Subpath "${parsed.subPath}" does not exist in repository "${parsed.repoUrl}".`);
                    }

                    const subStat = statSync(sourceSubPath);
                    if (subStat.isFile()) {
                        const targetFile = join(targetDir, basename(sourceSubPath));
                        copyFileSync(sourceSubPath, targetFile);
                        entrypoint = targetFile;
                        calculatedHash = computeFileHash(targetFile);
                    } else {
                        execSync(`node -e "const fs = require('fs'); fs.cpSync(process.argv[1], process.argv[2], { recursive: true });" "${sourceSubPath}" "${targetDir}"`, { stdio: 'pipe' });
                        entrypoint = findProviderEntrypoint(targetDir, providerName) || targetDir;
                        calculatedHash = computeDirectoryHash(targetDir);
                    }
                } finally {
                    try {
                        rmSync(tempCloneDir, { recursive: true, force: true });
                    } catch {}
                }
            } else {
                // Clone entire repository directly into provider directory
                const branchArg = ref ? `--branch "${ref}"` : '';
                execSync(`git clone --depth 1 ${branchArg} "${parsed.repoUrl}" "${targetDir}"`, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 120000
                });

                entrypoint = findProviderEntrypoint(targetDir, providerName) || targetDir;
                calculatedHash = computeDirectoryHash(targetDir);
            }

            return {
                name: providerName,
                source,
                version: installedVersion,
                entrypoint,
                hash: calculatedHash
            };
        }

        // ── Case 3: NPM Package or Registry (e.g. "@org/testform-provider-gitlab" or "npm::...") ──
        const npmPackage = source.replace(/^npm::/, '');
        logger?.info(`- Installing ${providerName} package "${npmPackage}"...`);

        if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
        }

        try {
            execSync(`npm install --prefix "${targetDir}" "${npmPackage}" --no-save`, {
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 120000
            });
            entrypoint = findProviderEntrypoint(targetDir, providerName) || targetDir;
            calculatedHash = computeDirectoryHash(targetDir);

            return {
                name: providerName,
                source,
                version: installedVersion,
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
                constraints: `>= ${p.version}`,
                hashes: [p.hash]
            };
        }
        writeFileSync(lockJsonPath, JSON.stringify(lockJsonData, null, 2), 'utf-8');

        // 2. HCL Standard Lockfile (.testform.lock.hcl in workspace root - canonical Terraform parity)
        const lockHclPath = resolve(this.workDir, '.testform.lock.hcl');
        let hclContent = `# This file is maintained automatically by "testform init".\n# Manual edits may be lost in future updates.\n\n`;

        for (const p of providers) {
            hclContent += `provider "${p.name}" {\n`;
            hclContent += `  version     = "${p.version}"\n`;
            hclContent += `  constraints = ">= ${p.version}"\n`;
            hclContent += `  hashes = [\n`;
            hclContent += `    "${p.hash}",\n`;
            hclContent += `  ]\n`;
            hclContent += `}\n\n`;
        }
        writeFileSync(lockHclPath, hclContent, 'utf-8');
    }
}
