import { IProvider, IProviderResourceHandler } from '@fromeroc9/testform';

export interface ICustomProviderConfig {
    baseUrl?: string;
    token?: string;
    tokenEnv?: string;
    [key: string]: any;
}

export default class CustomProvider implements IProvider {
    public name = 'custom-provider';

    /**
     * Formats remote identifiers for terminal displays and state ledger.
     * Examples: '#101', 'QA-504', 'GL#203', 'REMOTE:42'
     */
    formatRemoteId(id: number | string): string {
        return `#${id}`;
    }

    /**
     * Agnostic resource bus exposing standard CRUD lifecycle methods and REST aliases.
     * Define any entity your provider manages (e.g. testcase, defect, testrun, badge).
     */
    public resources: Record<string, IProviderResourceHandler> = {
        testcase: {
            create: async (attributes: any, context?: any) => {
                // Perform remote API creation (e.g. POST /api/v1/testcases)
                return {
                    id: Date.now(),
                    number: Math.floor(Math.random() * 1000),
                    ...attributes
                };
            },
            read: async (id: number | string, context?: any) => {
                // Perform remote lookup (e.g. GET /api/v1/testcases/:id)
                return null;
            },
            update: async (id: number | string, attributes: any, context?: any) => {
                // Perform remote update (e.g. PUT/PATCH /api/v1/testcases/:id)
                return {
                    id,
                    ...attributes
                };
            },
            delete: async (id: number | string, context?: any) => {
                // Perform remote deletion (e.g. DELETE /api/v1/testcases/:id)
            }
        }
    };

    /**
     * Backward compatibility alias for resources.
     */
    public get apis(): Record<string, IProviderResourceHandler> {
        return this.resources;
    }

    constructor(public config: ICustomProviderConfig = {}) {}
}
