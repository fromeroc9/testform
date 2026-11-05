import { describe, it, expect } from 'vitest';
import StarterProvider from '../src/index';

describe('StarterProvider Unit Tests', () => {
    it('initializes with config and formats remote ID correctly', () => {
        const provider = new StarterProvider({
            host: 'https://gitlab.example.com',
            token: 'secret_token_123'
        });

        expect(provider.name).toBe('starter-provider');
        expect(provider.formatRemoteId(105)).toBe('#105');
    });

    it('creates an issue mock payload', async () => {
        const provider = new StarterProvider();
        const result = await provider.createIssue({
            title: 'Login with valid credentials',
            body: 'Given user is on login page\nWhen user enters credentials\nThen dashboard opens',
            labels: ['testcase', 'auth']
        });

        expect(result).toBeDefined();
        expect(result.title).toBe('Login with valid credentials');
        expect(result.state).toBe('open');
    });
});
