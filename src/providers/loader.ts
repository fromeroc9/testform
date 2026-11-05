import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { IProvider } from './interface';
import { GitHubProvider } from './github';
import { LocalProvider } from './local';
import { GitLabProvider } from './gitlab';
import { loadCustomProvider } from './custom';
import { Config } from '../core/config';
import { findProviderEntrypoint } from '../core/provider-installer';
import { isGitSource } from '../core/module';

/**
 * Creates and initializes the active provider instance based on the resolved configuration.
 */
export async function createProvider(
    config: Config,
    dir: string = process.cwd()
): Promise<IProvider> {
    const providerType = config.getProviderType();
    const providerProps = config.getProviderConfig(providerType);
    const required = config.getRequiredProviders();
    const reqKeys = Object.keys(required);

    // 1. Strict validation: If required_providers is declared, only declared providers are allowed (Terraform parity)
    if (reqKeys.length > 0 && !required[providerType] && providerType !== 'local') {
        throw new Error(
            `[Testform Provider Error] Undeclared provider "${providerType}".\n` +
            `The provider "${providerType}" is configured in your provider block, but it was not declared in testform.required_providers.\n` +
            `Declared providers in this configuration: ${reqKeys.join(', ')}.\n\n` +
            `To use "${providerType}", add it under testform.required_providers in main.yml and run "testform init".`
        );
    }

    // 2. Installation validation: If provider requires download and is not installed, fail and instruct to run "testform init"
    if (required[providerType]) {
        const spec = required[providerType];
        const installedDir = resolve(dir, '.testform', 'providers', providerType);
        if (!existsSync(installedDir) && (isGitSource(spec.source) || spec.source.startsWith('@') || spec.source.startsWith('npm::'))) {
            throw new Error(
                `[Testform Provider Error] Provider "${providerType}" is not installed.\n` +
                `This configuration requires provider "${providerType}" (${spec.source}), but it is not installed in .testform/providers/${providerType}.\n\n` +
                `Please run "testform init" to install required providers.`
            );
        }
    }

    // 3. Dynamic check: Look for downloaded/installed provider in .testform/providers/<providerType>
    const installedProviderDir = resolve(dir, '.testform', 'providers', providerType);
    if (existsSync(installedProviderDir)) {
        const entrypoint = findProviderEntrypoint(installedProviderDir, providerType);
        if (entrypoint) {
            return await loadCustomProvider({ ...providerProps, source: entrypoint }, dir);
        }
    }

    // 4. Explicit custom source in configuration (e.g. source: "./custom-providers/local.ts" or "@org/pkg")
    if (providerProps.source || providerType === 'custom') {
        return await loadCustomProvider(providerProps as any, dir);
    }

    // 5. Fallback to built-in providers
    if (providerType === 'local') {
        return new LocalProvider(dir);
    }

    if (providerType === 'github') {
        const ghConfig = config.getGitHub();
        if (!ghConfig) {
            throw new Error('GitHub provider configuration is missing required fields (owner, repository).');
        }
        return new GitHubProvider(ghConfig);
    }

    if (providerType === 'gitlab') {
        return new GitLabProvider(providerProps as any);
    }

    // Default fallback to local provider if unknown
    return new LocalProvider(dir);
}
