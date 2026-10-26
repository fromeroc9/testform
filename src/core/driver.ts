import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Strict whitelist of allowed cloud driver packages.
 * Prevents arbitrary package lookups and secures resolution.
 */
export const ALLOWED_DRIVERS: Record<string, string> = {
    '@aws-sdk/client-s3': 'Amazon S3 / OCI Storage Driver',
    '@aws-sdk/client-dynamodb': 'DynamoDB Distributed Lock Driver',
    '@azure/storage-blob': 'Azure Blob Storage Driver',
    '@google-cloud/storage': 'Google Cloud Storage Driver',
    'docx': 'Word Document Report Generator',
    'exceljs': 'Excel Spreadsheet Report Generator'
};

// In-memory cache for already loaded modules (0ms response time on subsequent calls)
const driverCache = new Map<string, any>();

// Cached global npm root directory (only computed once if needed)
let cachedGlobalNpmRoot: string | null = null;

function resolveGlobalNpmRoot(): string | null {
    if (cachedGlobalNpmRoot !== null) {
        return cachedGlobalNpmRoot;
    }

    try {
        const root = execSync('npm root -g', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 2000
        }).trim();
        cachedGlobalNpmRoot = root || null;
    } catch {
        cachedGlobalNpmRoot = null;
    }
    return cachedGlobalNpmRoot;
}

/**
 * Dynamically resolves and loads a cloud driver package from the whitelist.
 * Checks in order:
 * 1. In-memory cache
 * 2. Local node_modules
 * 3. Static platform-specific global paths (fast check without spawning processes)
 * 4. Global npm root (cached)
 */
export function loadDriver<T = any>(packageName: string): T {
    // 1. Whitelist validation
    if (!ALLOWED_DRIVERS[packageName]) {
        throw new Error(
            `[Testform Driver Error] "${packageName}" is not a recognized cloud driver.\n` +
            `Allowed drivers are: ${Object.keys(ALLOWED_DRIVERS).join(', ')}`
        );
    }

    // 2. In-memory cache lookup
    if (driverCache.has(packageName)) {
        return driverCache.get(packageName) as T;
    }

    // 3. Try standard local require
    try {
        const mod = require(packageName);
        driverCache.set(packageName, mod);
        return mod as T;
    } catch (err: any) {
        if (err.code !== 'MODULE_NOT_FOUND') {
            throw err;
        }
    }

    // 4. Fast check static global candidate directories (no child processes spawned)
    const candidates: string[] = [];

    if (process.platform === 'win32') {
        if (process.env.APPDATA) {
            candidates.push(join(process.env.APPDATA, 'npm', 'node_modules'));
        }
        if (process.env.LOCALAPPDATA) {
            candidates.push(join(process.env.LOCALAPPDATA, 'npm', 'node_modules'));
        }
    } else {
        // Linux / macOS standard paths
        candidates.push('/usr/local/lib/node_modules');
        candidates.push('/usr/lib/node_modules');
    }

    // Relative to current Node binary
    candidates.push(join(process.execPath, '..', 'node_modules'));
    candidates.push(join(process.execPath, '..', '..', 'lib', 'node_modules'));

    for (const dir of candidates) {
        const candidatePath = join(dir, packageName);
        if (existsSync(candidatePath)) {
            try {
                const mod = require(candidatePath);
                driverCache.set(packageName, mod);
                return mod as T;
            } catch { }
        }
    }

    // 5. Fallback: single cached npm root -g lookup
    const globalRoot = resolveGlobalNpmRoot();
    if (globalRoot) {
        const candidatePath = join(globalRoot, packageName);
        if (existsSync(candidatePath)) {
            try {
                const mod = require(candidatePath);
                driverCache.set(packageName, mod);
                return mod as T;
            } catch { }
        }
    }

    // 6. User-friendly error with exact command
    throw new Error(
        `[Testform Driver Error] The package "${packageName}" is required for this backend.\n` +
        `Please install it globally:\n\n` +
        `  npm install -g ${packageName}\n\n` +
        `or add it to your local project:\n\n` +
        `  npm install --save-dev ${packageName}\n`
    );
}

/**
 * Checks if a driver is available without throwing.
 */
export function isDriverAvailable(packageName: string): boolean {
    try {
        loadDriver(packageName);
        return true;
    } catch {
        return false;
    }
}

/**
 * Clears driver cache and cached npm root.
 */
export function clearDriverCache(): void {
    driverCache.clear();
    cachedGlobalNpmRoot = null;
}

/**
 * Ensures the required driver is installed.
 * If not installed, automatically installs it via npm (resembling terraform init plugin download).
 */
export function ensureDriverInstalled(
    packageName: string,
    logger?: { info: (msg: string | string[]) => void; success: (msg: string | string[]) => void; warn: (msg: string | string[]) => void }
): boolean {
    if (isDriverAvailable(packageName)) {
        return true;
    }

    if (!ALLOWED_DRIVERS[packageName]) {
        throw new Error(`[Testform Driver Error] "${packageName}" is not a recognized cloud driver.`);
    }

    try {
        logger?.info(`- Installing driver ${packageName}...`);
        execSync(`npm install -g ${packageName}`, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120000
        });
        clearDriverCache();
        if (isDriverAvailable(packageName)) {
            logger?.success(`- Installed driver ${packageName}`);
            return true;
        }
    } catch (err: any) {
        // Fallback to local project install if npm -g fails
        try {
            execSync(`npm install --save-dev ${packageName}`, {
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 120000
            });
            clearDriverCache();
            if (isDriverAvailable(packageName)) {
                logger?.success(`- Installed driver ${packageName}`);
                return true;
            }
        } catch { }
        logger?.warn(`Could not automatically install ${packageName}: ${err.message}`);
    }
    return false;
}
