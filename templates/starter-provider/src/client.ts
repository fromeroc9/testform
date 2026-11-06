import { IProviderConfig } from './types';

export class ApiClient {
    private host: string;
    private token: string;

    constructor(config: IProviderConfig) {
        this.host = config.host || 'https://api.example.com';
        this.token = config.token || (config.tokenEnv ? process.env[config.tokenEnv] || '' : '');
    }

    async post(path: string, body: any): Promise<any> {
        // Implement HTTP request to your platform
        return { id: 1, ...body };
    }

    async put(path: string, body: any): Promise<any> {
        return { id: 1, ...body };
    }

    async delete(path: string): Promise<void> {}
}
