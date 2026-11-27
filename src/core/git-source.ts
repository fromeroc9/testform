import { basename, dirname, join } from 'path';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { parseGitSource } from './module';
import { compareSemver, isVersionCompatible, parseVersionNumbers } from './config';

export interface ClonedGitResult {
    repoUrl: string;
    subPath?: string;
    ref?: string;
    entrypointOrDir: string;
    isSingleFile: boolean;
}

/**
 * Fetches remote/local Git tags via `git ls-remote --tags --refs`.
 * Best-effort: returns an empty list if the remote is unreachable or has no tags.
 */
export function listGitRemoteTags(repoUrl: string): string[] {
    try {
        const out = execFileSync('git', ['ls-remote', '--tags', '--refs', repoUrl], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 20000,
            encoding: 'utf-8',
        });
        const tags: string[] = [];
        for (const line of out.split(/\r?\n/)) {
            const match = line.match(/refs\/tags\/(.+)$/);
            if (match && match[1]) {
                tags.push(match[1].trim());
            }
        }
        return tags;
    } catch {
        return [];
    }
}

/**
 * Selects the highest semver candidate (e.g. Git tag or package version)
 * matching a constraint string (e.g. ">= 7.0.0, < 9.0.0" or "~> 1.2").
 */
export function selectHighestMatchingVersion(
    candidates: string[],
    constraint?: string
): string | null {
    const semverCandidates = candidates
        .map((raw) => raw.trim())
        .filter((raw) => /^v?\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.test(raw));

    if (semverCandidates.length === 0) return null;

    const matching = constraint && constraint.trim()
        ? semverCandidates.filter((ver) => isVersionCompatible(ver, constraint))
        : semverCandidates;

    if (matching.length === 0) return null;

    matching.sort((a, b) => compareSemver(parseVersionNumbers(b), parseVersionNumbers(a)));
    return matching[0];
}

/**
 * Clones a Git source (supporting `git::`, `?ref=`, and `//subpath`) into `targetDir`.
 */
export function cloneGitSource(
    source: string,
    targetDir: string,
    tempRoot: string
): ClonedGitResult {
    const parsed = parseGitSource(source);
    const hasRemoteScheme = parsed.repoUrl.includes('://') || parsed.repoUrl.startsWith('git@');
    const baseCloneArgs = ['clone'];
    if (hasRemoteScheme) {
        baseCloneArgs.push('--depth', '1');
    }
    if (parsed.ref) {
        baseCloneArgs.push('--branch', parsed.ref);
    }

    if (existsSync(targetDir)) {
        try {
            rmSync(targetDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup errors
        }
    }

    if (parsed.subPath) {
        mkdirSync(targetDir, { recursive: true });
        const tempCloneDir = join(
            tempRoot,
            `git-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        );
        mkdirSync(tempCloneDir, { recursive: true });

        try {
            execFileSync('git', [...baseCloneArgs, parsed.repoUrl, tempCloneDir], {
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 120000,
            });

            const sourceSubPath = join(tempCloneDir, parsed.subPath);
            if (!existsSync(sourceSubPath)) {
                throw new Error(
                    `Subpath "${parsed.subPath}" does not exist in repository "${parsed.repoUrl}".`
                );
            }

            const subStat = statSync(sourceSubPath);
            if (subStat.isFile()) {
                const targetFile = join(targetDir, basename(sourceSubPath));
                copyFileSync(sourceSubPath, targetFile);
                return {
                    ...parsed,
                    entrypointOrDir: targetFile,
                    isSingleFile: true,
                };
            }

            cpSync(sourceSubPath, targetDir, { recursive: true });
            return {
                ...parsed,
                entrypointOrDir: targetDir,
                isSingleFile: false,
            };
        } finally {
            try {
                rmSync(tempCloneDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }
    }

    mkdirSync(dirname(targetDir), { recursive: true });
    execFileSync('git', [...baseCloneArgs, parsed.repoUrl, targetDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
    });

    return {
        ...parsed,
        entrypointOrDir: targetDir,
        isSingleFile: false,
    };
}
