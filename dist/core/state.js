"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.State = void 0;
const crypto_1 = require("crypto");
const const_1 = require("../const");
const notify_1 = require("../notify");
const local_1 = require("./backends/local");
const s3_1 = require("./backends/s3");
const azurerm_1 = require("./backends/azurerm");
const gcs_1 = require("./backends/gcs");
const config_1 = require("./config");
const workspace_1 = require("./workspace");
class State {
    state;
    backend;
    workspaceManager;
    constructor(dir, customStatePath, customBackupPath, disableBackend = false, backendConfigRaw, explicitBackendConfig) {
        const config = new config_1.Config(dir);
        let backendConfig = explicitBackendConfig || config.getBackend();
        this.workspaceManager = new workspace_1.WorkspaceManager(dir);
        const currentWorkspace = this.workspaceManager.getCurrentWorkspace();
        // If backend is explicitly disabled via CLI, force local
        if (disableBackend) {
            backendConfig = { type: 'local', config: {} };
        }
        else if (backendConfig && backendConfig.type !== 'local' && backendConfigRaw) {
            // Apply CLI overrides to the backend config
            const overrides = this.parseBackendOverrides(backendConfigRaw);
            backendConfig.config = { ...backendConfig.config, ...overrides };
        }
        if (backendConfig?.type === 's3') {
            this.backend = new s3_1.S3Backend(backendConfig.config, currentWorkspace);
        }
        else if (backendConfig?.type === 'azurerm') {
            this.backend = new azurerm_1.AzureRMBackend(backendConfig.config, currentWorkspace);
        }
        else if (backendConfig?.type === 'gcs') {
            this.backend = new gcs_1.GCSBackend(backendConfig.config, currentWorkspace);
        }
        else {
            this.backend = new local_1.LocalBackend(dir, customStatePath, customBackupPath, currentWorkspace);
        }
    }
    parseBackendOverrides(raw) {
        const overrides = {};
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
    async hasState() {
        return await this.backend.exists();
    }
    async init() {
        const parsed = await this.backend.read();
        // Validate version
        if (!parsed.version) {
            notify_1.notify.push({
                type: 'error',
                title: `${const_1.FILE_STATE} is missing the "version" field`,
                detail: [`Add a "version" field to your ${const_1.FILE_STATE} file and rerun init.`],
                close: true
            });
        }
        else if (parsed.version !== const_1.VERSION_STATE) {
            notify_1.notify.push({
                type: 'error',
                title: `state version mismatch`,
                detail: [
                    `Found version "${parsed.version}", but expected "${const_1.VERSION_STATE}".`,
                    `Update ${const_1.FILE_STATE} to version ${const_1.VERSION_STATE} and rerun init.`,
                ],
                close: true
            });
        }
        this.state = {
            version: parsed.version || const_1.VERSION_STATE,
            serial: parsed.serial ?? 0,
            lineage: parsed.lineage ?? (0, crypto_1.randomUUID)(),
            lastSync: parsed.lastSync ?? '',
            resources: parsed.resources ?? [],
        };
    }
    async acquireLock(enabled, timeoutRaw) {
        if (!enabled)
            return;
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
    async releaseLock() {
        await this.backend.unlock();
    }
    async forceUnlock(lockId) {
        return this.backend.forceUnlock(lockId);
    }
    /**
     * Save state to disk or backend. Increments serial and updates lastSync.
     */
    async save() {
        this.state.serial += 1;
        this.state.lastSync = new Date().toISOString();
        await this.backend.write(this.state);
    }
    /**
     * Get current state (read-only snapshot).
     */
    getState() {
        return this.state;
    }
    /**
     * Replace the entire internal state with a new snapshot (useful for migration).
     * Note: This does not automatically save to backend. Call .save() afterwards.
     */
    replaceState(newState) {
        this.state = JSON.parse(JSON.stringify(newState)); // Deep copy to avoid reference issues
    }
    /**
     * Get all resources of a given type.
     */
    getResources(type) {
        if (!this.state.resources)
            return [];
        if (!type)
            return this.state.resources;
        return this.state.resources.filter(r => r.type === type);
    }
    // Workspace Delegation
    getCurrentWorkspace() {
        return this.workspaceManager.getCurrentWorkspace();
    }
    setCurrentWorkspace(name) {
        this.workspaceManager.setCurrentWorkspace(name);
    }
    async listWorkspaces() {
        return this.backend.listWorkspaces();
    }
    async deleteWorkspace(name) {
        return this.backend.deleteWorkspace(name);
    }
    /**
     * Find a resource by identity.
     */
    findResource(identity) {
        return this.state.resources.find(r => r.identity === identity);
    }
    /**
     * Add or update a resource after a successful apply operation.
     */
    upsertResource(resource) {
        const idx = this.state.resources.findIndex(r => r.identity === resource.identity);
        if (idx >= 0) {
            this.state.resources[idx] = resource;
        }
        else {
            this.state.resources.push(resource);
        }
    }
    /**
     * Remove a resource after a successful destroy operation.
     */
    removeResource(identity) {
        this.state.resources = this.state.resources.filter(r => r.identity !== identity);
    }
    /**
     * Clear all resources (used by full destroy).
     */
    clearResources() {
        this.state.resources = [];
    }
}
exports.State = State;
