import { randomUUID } from 'crypto';
import { FILE_STATE, VERSION_STATE } from '../const';
import { notify } from '../notify';
import { IState, StateResource } from '../types';
import { IBackend } from './backends/backend';
import { LocalBackend } from './backends/local';
import { S3Backend, S3BackendConfig } from './backends/s3';
import { AzureRMBackend, AzureRMBackendConfig } from './backends/azurerm';
import { GCSBackend, GCSBackendConfig } from './backends/gcs';
import { Config } from './config';
import { WorkspaceManager } from './workspace';

export class State {
    private state!: IState;
    private backend: IBackend;
    private workspaceManager: WorkspaceManager;

    constructor(
        dir: string,
        customStatePath?: string,
        customBackupPath?: string,
        disableBackend: boolean = false,
        backendConfigRaw?: string | string[],
        explicitBackendConfig?: any
    ) {
        const config = new Config(dir);
        let backendConfig = explicitBackendConfig || config.getBackend();

        this.workspaceManager = new WorkspaceManager(dir);
        const currentWorkspace = this.workspaceManager.getCurrentWorkspace();

        // If backend is explicitly disabled via CLI, force local
        if (disableBackend) {
            backendConfig = { type: 'local', config: {} };
        } else if (backendConfig && backendConfig.type !== 'local' && backendConfigRaw) {
            // Apply CLI overrides to the backend config
            const overrides = this.parseBackendOverrides(backendConfigRaw);
            backendConfig.config = { ...backendConfig.config, ...overrides };
        }

        if (backendConfig?.type === 's3') {
            this.backend = new S3Backend(backendConfig.config as unknown as S3BackendConfig, currentWorkspace);
        } else if (backendConfig?.type === 'azurerm') {
            this.backend = new AzureRMBackend(backendConfig.config as unknown as AzureRMBackendConfig, currentWorkspace);
        } else if (backendConfig?.type === 'gcs') {
            this.backend = new GCSBackend(backendConfig.config as unknown as GCSBackendConfig, currentWorkspace);
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

        this.state = {
            version: parsed.version || VERSION_STATE,
            serial: parsed.serial ?? 0,
            lineage: parsed.lineage ?? randomUUID(),
            lastSync: parsed.lastSync ?? '',
            resources: parsed.resources ?? [],
        };
    }

    async acquireLock(enabled: boolean, timeoutRaw: string): Promise<void> {
        if (!enabled) return;

        const success = await this.backend.lock(timeoutRaw);
        if (!success) {
            console.error(`\nError: Acquiring the state lock.\n\nTestform acquires a state lock to protect the state from being written\nby multiple users at the same time. Please resolve the issue above and try\nagain. For most commands, you can disable locking with the "-lock=false"\nflag, but this is not recommended.\n`);
            process.exit(1);
        }

        const cleanup = async () => { await this.releaseLock(); process.exit(1); };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        // Using 'exit' with async is problematic, but we try to clean up synchronously if we can.
        // Actually, we'll just handle clean exits gracefully via releaseLock().
    }

    async releaseLock(): Promise<void> {
        await this.backend.unlock();
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        return this.backend.forceUnlock(lockId);
    }

    /**
     * Save state to disk or backend. Increments serial and updates lastSync.
     */
    async save(): Promise<void> {
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
     * Get all resources of a given type.
     */
    getResources(type?: string): StateResource[] {
        if (!this.state.resources) return [];
        if (!type) return this.state.resources;
        return this.state.resources.filter(r => r.type === type);
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
        const idx = this.state.resources.findIndex(r => r.identity === resource.identity);
        if (idx >= 0) {
            this.state.resources[idx] = resource;
        } else {
            this.state.resources.push(resource);
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
