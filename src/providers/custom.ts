import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { IProvider } from './interface';
import { logger } from '../core/logger';

export interface ICustomProviderConfig {
    source: string;
    [key: string]: any;
}

/**
 * Loads and instantiates a user-defined custom provider.
 * The source can be:
 * 1. A local file path relative to the project directory (e.g., "./providers/jira.ts" or "./jira.js")
 * 2. An installed npm package name (e.g., "@org/testform-provider-jira")
 */
export async function loadCustomProvider(
    config: ICustomProviderConfig,
    projectDir: string = process.cwd()
): Promise<IProvider> {
    const { source, ...providerProps } = config;

    if (!source) {
        throw new Error('Custom provider configuration must specify a "source" path or package name.');
    }

    let loadedModule: any;
    const localPath = resolve(projectDir, source);

    if (existsSync(localPath)) {
        try {
            // Dynamic import via file:// URL to support both ESM and CommonJS
            loadedModule = await import(pathToFileURL(localPath).href);
        } catch (err: any) {
            // Fallback to require for CommonJS/TypeScript registered loaders
            try {
                loadedModule = require(localPath);
            } catch (innerErr: any) {
                throw new Error(`Failed to load custom provider from "${localPath}": ${err.message || err}`);
            }
        }
    } else {
        // Attempt loading as an installed package
        try {
            loadedModule = await import(source);
        } catch (err: any) {
            try {
                loadedModule = require(source);
            } catch (innerErr: any) {
                throw new Error(
                    `Could not resolve custom provider from local path "${localPath}" or package "${source}".`
                );
            }
        }
    }

    const ProviderClass = loadedModule.default || loadedModule.Provider || loadedModule;

    if (typeof ProviderClass !== 'function') {
        throw new Error(
            `Custom provider module from "${source}" does not export a valid constructor class (export default or export class Provider).`
        );
    }

    return new ProviderClass(providerProps);
}
