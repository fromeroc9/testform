import { IStarterProviderConfig, IRemoteResourceAttributes, IRemoteResourceResult } from './types';

export class StarterApiClient {
    private baseUrl: string;
    private token?: string;

    constructor(config: IStarterProviderConfig) {
        this.baseUrl = config.baseUrl || 'https://api.example.com';
        this.token = config.token || (config.tokenEnv ? process.env[config.tokenEnv] : undefined);
    }

    async createResource(attrs: IRemoteResourceAttributes): Promise<IRemoteResourceResult> {
        // Replace with real HTTP API call (e.g. fetch or axios)
        return {
            id: Date.now(),
            number: Math.floor(Math.random() * 1000),
            ...attrs
        };
    }

    async getResource(id: string | number): Promise<IRemoteResourceResult | null> {
        // Replace with real HTTP GET lookup
        return null;
    }

    async updateResource(id: string | number, attrs: Partial<IRemoteResourceAttributes>): Promise<IRemoteResourceResult> {
        // Replace with real HTTP PUT/PATCH call
        return {
            id,
            ...attrs
        };
    }

    async deleteResource(id: string | number): Promise<void> {
        // Replace with real HTTP DELETE call
    }
}
