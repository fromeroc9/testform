/**
 * HTTP Client Wrapper with Error Handling and Authentication
 */

import { IProviderConfig } from './types';

export class ApiClient {
    private baseUrl: string;
    private token: string;

    constructor(private config: IProviderConfig) {
        this.baseUrl = (config.host || 'https://api.example.com').replace(/\/+$/, '');
        this.token = config.token || (config.token_env ? process.env[config.token_env] || '' : '');
    }

    private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(this.token ? { 'Authorization': `Bearer ${this.token}`, 'PRIVATE-TOKEN': this.token } : {}),
            ...(options.headers as Record<string, string> || {})
        };

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`[API Error ${response.status}] ${response.statusText} at ${url}: ${errorText}`);
        }

        if (response.status === 204) {
            return null as unknown as T;
        }

        return await response.json() as T;
    }

    public async get<T = any>(endpoint: string): Promise<T> {
        return this.request<T>(endpoint, { method: 'GET' });
    }

    public async post<T = any>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    public async patch<T = any>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
    }

    public async put<T = any>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
    }

    public async delete(endpoint: string): Promise<void> {
        await this.request(endpoint, { method: 'DELETE' });
    }
}
