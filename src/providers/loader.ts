import { IProvider } from './interface';
import { GitHubProvider } from './github';
import { LocalProvider } from './local';
import { GitLabProvider } from './gitlab';
import { loadCustomProvider } from './custom';
import { Config } from '../core/config';

/**
 * Creates and initializes the active provider instance based on the resolved configuration.
 */
export async function createProvider(
    config: Config,
    dir: string = process.cwd()
): Promise<IProvider> {
    const providerType = config.getProviderType();
    const providerProps = config.getProviderConfig(providerType);

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

    if (providerType === 'custom' || providerProps.source) {
        return await loadCustomProvider(providerProps as any, dir);
    }

    // Default fallback to local provider if unknown
    return new LocalProvider(dir);
}
