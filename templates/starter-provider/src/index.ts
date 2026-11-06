import { IProvider, IProviderResourceHandler } from '@fromeroc9/testform';
import { StarterApiClient } from './client';
import { IStarterProviderConfig } from './types';

export class StarterProvider implements IProvider {
    public name = 'starter-provider';
    private client: StarterApiClient;

    constructor(public config: IStarterProviderConfig = {}) {
        this.client = new StarterApiClient(config);
    }

    /**
     * Formats the remote identifier shown in CLI output and state file.
     * Examples: 'REMOTE#105', '#105', 'QA-402'
     */
    formatRemoteId(id: number | string): string {
        return `REMOTE#${id}`;
    }

    /**
     * Multi-resource CRUD handler bus.
     */
    public resources: Record<string, IProviderResourceHandler> = {
        testcase: {
            create: async (attrs, context) => this.client.createResource(attrs),
            read: async (id, context) => this.client.getResource(id),
            update: async (id, attrs, context) => this.client.updateResource(id, attrs),
            delete: async (id, context) => this.client.deleteResource(id),
            // REST aliases
            post: async (attrs, context) => this.client.createResource(attrs),
            get: async (id, context) => this.client.getResource(id),
            patch: async (id, attrs, context) => this.client.updateResource(id, attrs),
            put: async (id, attrs, context) => this.client.updateResource(id, attrs)
        }
    };

    /**
     * Backward compatibility alias for resources.
     */
    public get apis(): Record<string, IProviderResourceHandler> {
        return this.resources;
    }
}

export default StarterProvider;
