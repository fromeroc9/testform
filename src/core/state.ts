import { randomUUID } from 'crypto';
import { FILE_STATE, VERSION_STATE } from '../core/const';
import { logger as notify } from '../core/logger';
import { IState, StateResource } from '../core/types';
import { IBackend } from '../backends/backend';
import { LocalBackend } from '../backends/local';
import { S3Backend, S3BackendConfig } from '../backends/s3';
import { AzureRMBackend, AzureRMBackendConfig } from '../backends/azurerm';
import { GCSBackend, GCSBackendConfig } from '../backends/gcs';
import { GitHubBackend, GitHubBackendConfig } from '../backends/github';
import { Config } from '../core/config';
import { WorkspaceManager } from '../core/workspace';
import { StateLockError } from '../core/errors';

export class State {
    private state!: IState;
    private backend: IBackend;
    private workspaceManager: WorkspaceManager;
    private lockAcquired: boolean = false;
    private dir: string;

    constructor(
        dir: string,
        customStatePath?: string,
        customBackupPath?: string,
        disableBackend: boolean = false,
        backendConfigRaw?: string | string[],
        explicitBackendConfig?: any
    ) {
        this.dir = dir;
        const config = new Config(dir, false);
        let backendConfig = explicitBackendConfig || config.getBackend();

        this.workspaceManager = new WorkspaceManager(dir);
        const currentWorkspace = this.workspaceManager.getCurrentWorkspace();

        // If backend is explicitly disabled via CLI or a custom state file path is provided, force local
        if (disableBackend || customStatePath) {
            backendConfig = { type: 'local', config: {} };
        } else if (backendConfig && backendConfig.type !== 'local' && backendConfigRaw) {
            // Apply CLI overrides to the backend config
            const overrides = this.parseBackendOverrides(backendConfigRaw);
            backendConfig.config = { ...backendConfig.config, ...overrides };
        }

        if (backendConfig?.type === 's3' || backendConfig?.type === 'oci') {
            this.backend = new S3Backend(backendConfig.config as unknown as S3BackendConfig, currentWorkspace);
        } else if (backendConfig?.type === 'azurerm') {
            this.backend = new AzureRMBackend(backendConfig.config as unknown as AzureRMBackendConfig, currentWorkspace);
        } else if (backendConfig?.type === 'gcs') {
            this.backend = new GCSBackend(backendConfig.config as unknown as GCSBackendConfig, currentWorkspace);
        } else if (backendConfig?.type === 'github') {
            const gh = config.getGitHub();
            this.backend = new GitHubBackend(
                backendConfig.config as unknown as GitHubBackendConfig,
                currentWorkspace,
                gh?.owner,
                gh?.repository,
                gh?.tokenEnv
            );
        } else {
            this.backend = new LocalBackend(dir, customStatePath, customBackupPath, currentWorkspace);
        }
    }

    private parseBackendOverrides(raw: string | string[]): Record<string, string> {
        const overrides: Record<string, string> = {};
        const items = Array.isArray(raw) ? raw : [raw];
        for (const item of items) {
            const index = item.indexOf('=');
            if (index > 0) {
                const key = item.substring(0, index).trim();
                const val = item.substring(index + 1).trim();
                overrides[key] = val;
            }
        }
        return overrides;
    }

    async hasState(): Promise<boolean> {
        return await this.backend.exists();
    }

    async init(): Promise<void> {
        const parsed = await this.backend.read();

        // Validate version
        if (!parsed.version) {
            notify.push({
                type: 'error',
                title: `${FILE_STATE} is missing the "version" field`,
                detail: [`Add a "version" field to your ${FILE_STATE} file and rerun init.`],
                close: true
            });
        } else if (parsed.version !== VERSION_STATE) {
            notify.push({
                type: 'error',
                title: `state version mismatch`,
                detail: [
                    `Found version "${parsed.version}", but expected "${VERSION_STATE}".`,
                    `Update ${FILE_STATE} to version ${VERSION_STATE} and rerun init.`,
                ],
                close: true
            });
        }

        const config = new Config(this.dir, false);

        this.state = {
            version: parsed.version || VERSION_STATE,
            serial: parsed.serial ?? 0,
            lineage: parsed.lineage ?? randomUUID(),
            lastSync: parsed.lastSync ?? '',
            provider: parsed.provider ?? config.getAdapterType(),
            resources: parsed.resources ?? [],
        };
    }

    async acquireLock(enabled: boolean, timeoutRaw: string): Promise<void> {
        if (!enabled) return;

        const success = await this.backend.lock(timeoutRaw);
        if (!success) {
            throw new StateLockError(`Error acquiring the state lock.\n\nTestform acquires a state lock to protect the state from being written\nby multiple users at the same time. Please resolve the issue above and try\nagain. For most commands, you can disable locking with the "-lock=false"\nflag, but this is not recommended.`);
        }

        this.lockAcquired = true;
    }

    async releaseLock(): Promise<void> {
        if (this.lockAcquired) {
            await this.backend.unlock();
            this.lockAcquired = false;
        }
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        return this.backend.forceUnlock(lockId);
    }

    /**
     * Clean and optimize state payload by removing redundant 'body' and empty fields.
     */
    clean(): { beforeBytes: number; afterBytes: number; resourcesCleaned: number } {
        const beforeJson = JSON.stringify(this.state);
        const beforeBytes = Buffer.byteLength(beforeJson, 'utf8');

        let resourcesCleaned = 0;
        if (this.state && Array.isArray(this.state.resources)) {
            for (const res of this.state.resources) {
                if (res.attributes) {
                    const beforeRes = JSON.stringify(res.attributes);
                    res.attributes = cleanAttributes(res.attributes) as any;
                    const afterRes = JSON.stringify(res.attributes);
                    if (beforeRes !== afterRes) {
                        resourcesCleaned++;
                    }
                }
            }
        }

        const afterJson = JSON.stringify(this.state);
        const afterBytes = Buffer.byteLength(afterJson, 'utf8');

        return {
            beforeBytes,
            afterBytes,
            resourcesCleaned
        };
    }

    /**
     * Save state to disk or backend. Cleans redundant fields, increments serial and updates lastSync.
     */
    async save(): Promise<void> {
        this.clean();
        this.state.serial += 1;
        this.state.lastSync = new Date().toISOString();
        await this.backend.write(this.state);
    }

    /**
     * Get current state (read-only snapshot).
     */
    getState(): Readonly<IState> {
        return this.state;
    }

    /**
     * Replace the entire internal state with a new snapshot (useful for migration).
     * Note: This does not automatically save to backend. Call .save() afterwards.
     */
    replaceState(newState: IState): void {
        this.state = JSON.parse(JSON.stringify(newState)); // Deep copy to avoid reference issues
    }

    /**
     * Get all resources of a given type (supports exact or canonical scope match).
     */
    getResources(type?: string): StateResource[] {
        if (!this.state.resources) return [];
        if (!type) return this.state.resources;
        return this.state.resources.filter(r => {
            if (r.type === type) return true;
            const canonicalR = r.type.includes('_') ? r.type.split('_').slice(1).join('_') : r.type;
            const canonicalT = type.includes('_') ? type.split('_').slice(1).join('_') : type;
            return canonicalR === canonicalT;
        });
    }

    // Workspace Delegation
    getCurrentWorkspace(): string {
        return this.workspaceManager.getCurrentWorkspace();
    }

    setCurrentWorkspace(name: string): void {
        this.workspaceManager.setCurrentWorkspace(name);
    }

    async listWorkspaces(): Promise<string[]> {
        return this.backend.listWorkspaces();
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        return this.backend.deleteWorkspace(name);
    }

    /**
     * Find a resource by identity.
     */
    findResource(identity: string): StateResource | undefined {
        return this.state.resources.find(r => r.identity === identity);
    }

    /**
     * Add or update a resource after a successful apply operation.
     */
    upsertResource(resource: StateResource): void {
        const cleanedResource: StateResource = {
            ...resource,
            attributes: cleanAttributes(resource.attributes) as any
        };
        const idx = this.state.resources.findIndex(r => r.identity === cleanedResource.identity);
        if (idx >= 0) {
            this.state.resources[idx] = cleanedResource;
        } else {
            this.state.resources.push(cleanedResource);
        }
    }

    /**
     * Remove a resource after a successful destroy operation.
     */
    removeResource(identity: string): void {
        this.state.resources = this.state.resources.filter(r => r.identity !== identity);
    }

    /**
     * Clear all resources (used by full destroy).
     */
    clearResources(): void {
        this.state.resources = [];
    }
}

/**
 * Recursively cleans a state resource attribute dictionary:
 * - Omits 'body' (raw scenario markdown is never needed in state; change detection uses localHash)
 * - Omits null and undefined values
 * - Omits empty strings ("")
 * - Omits empty arrays ([])
 * - Omits empty objects ({}) recursively
 */
export function cleanAttributes(attrs: Record<string, any>): Record<string, any> {
    if (!attrs || typeof attrs !== 'object') return attrs;
    const cleaned: Record<string, any> = {};

    for (const [key, val] of Object.entries(attrs)) {
        // 1. Omit null and undefined
        if (val === null || val === undefined) continue;

        // 3. Omit empty string
        if (typeof val === 'string') {
            if (val.trim() === '') continue;
            cleaned[key] = val;
            continue;
        }

        // 4. Omit or clean array
        if (Array.isArray(val)) {
            const filtered = val
                .filter(item => item !== null && item !== undefined && (typeof item !== 'string' || item.trim() !== ''))
                .map(item => (typeof item === 'object' && item !== null && !Array.isArray(item) ? cleanAttributes(item) : item))
                .filter(item => typeof item !== 'object' || item === null || Object.keys(item).length > 0);

            if (filtered.length > 0) {
                cleaned[key] = filtered;
            }
            continue;
        }

        // 5. Omit or clean nested object
        if (typeof val === 'object') {
            const nested = cleanAttributes(val as Record<string, any>);
            if (Object.keys(nested).length > 0) {
                cleaned[key] = nested;
            }
            continue;
        }

        // 6. Primitive types (numbers, booleans, etc.)
        cleaned[key] = val;
    }

    return cleaned;
}
