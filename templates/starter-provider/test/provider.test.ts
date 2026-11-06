import { describe, it, expect } from 'vitest';
import { StarterProvider } from '../src/index';

describe('StarterProvider', () => {
    it('instantiates and formats remote id', () => {
        const provider = new StarterProvider({ baseUrl: 'https://api.test' });
        expect(provider.name).toBe('starter-provider');
        expect(provider.formatRemoteId(101)).toBe('REMOTE#101');
    });

    it('exposes CRUD handlers on resources.testcase', async () => {
        const provider = new StarterProvider();
        const handler = provider.resources.testcase;
        expect(handler).toBeDefined();

        const created = await handler.create!({ title: 'Sample Test Case' });
        expect(created).toBeDefined();
        expect(created.title).toBe('Sample Test Case');
        expect(created.id).toBeDefined();
    });
});
