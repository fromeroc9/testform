import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { IBackend } from './backend';
import { IState } from '../core/types';

export interface CustomBackendConfig {
    source: string;
    [key: string]: any;
}

export class CustomBackend implements IBackend {
    private delegate: IBackend;

    constructor(
        config: CustomBackendConfig,
        workspace: string = 'default',
        projectDir: string = process.cwd()
    ) {
        const { source, ...backendProps } = config;

        if (!source) {
            throw new Error('Custom backend configuration must specify a "source" path or package name.');
        }

        let loadedModule: any;
        const candidatePaths = [
            resolve(projectDir, source),
            resolve(projectDir, '.testform', 'backends', source),
            resolve(projectDir, '.testform', 'modules', source),
        ];

        let foundPath: string | null = null;
        for (const p of candidatePaths) {
            if (existsSync(p)) {
                foundPath = p;
                break;
            }
            if (existsSync(`${p}.js`)) {
                foundPath = `${p}.js`;
                break;
            }
            if (existsSync(`${p}.ts`)) {
                foundPath = `${p}.ts`;
                break;
            }
        }

        if (foundPath) {
            try {
                loadedModule = require(foundPath);
            } catch {
                try {
                    // ESM dynamic fallback
                    loadedModule = require(foundPath);
                } catch (err: any) {
                    throw new Error(`Failed to load custom backend from "${foundPath}": ${err.message || err}`);
                }
            }
        } else {
            // Attempt loading as installed npm package
            try {
                loadedModule = require(source);
            } catch (err: any) {
                throw new Error(
                    `Could not resolve custom backend from local path "${source}" or package "${source}".`
                );
            }
        }

        const BackendClass = loadedModule.default || loadedModule.Backend || loadedModule.CustomBackend || loadedModule;

        if (typeof BackendClass !== 'function') {
            throw new Error(`The custom backend module at "${source}" does not export a valid backend class or constructor.`);
        }

        this.delegate = new BackendClass(backendProps, workspace, projectDir);
    }

    async read(): Promise<IState> {
        return this.delegate.read();
    }

    async exists(): Promise<boolean> {
        return this.delegate.exists();
    }

    async write(state: IState): Promise<void> {
        return this.delegate.write(state);
    }

    async lock(timeout: string): Promise<boolean> {
        return this.delegate.lock(timeout);
    }

    async unlock(): Promise<boolean> {
        return this.delegate.unlock();
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        return this.delegate.forceUnlock(lockId);
    }

    async isLocked(): Promise<boolean> {
        return this.delegate.isLocked();
    }

    async listWorkspaces(): Promise<string[]> {
        return this.delegate.listWorkspaces();
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        return this.delegate.deleteWorkspace(name);
    }
}

