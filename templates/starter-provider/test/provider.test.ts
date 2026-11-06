import { describe, it, expect } from 'vitest';
import StarterProvider from '../src/index';

describe('StarterProvider', () => {
    it('initializes and formats remote id', () => {
        const provider = new StarterProvider();
        expect(provider.name).toBe('starter-provider');
        expect(provider.formatRemoteId(101)).toBe('#101');
    });

    it('creates issue through apis', async () => {
        const provider = new StarterProvider();
        const res = await provider.apis.issue.create?.({
            title: 'Test Issue',
            body: 'Body content',
            labels: ['test']
        });
        expect(res).toBeDefined();
        expect(res?.title).toBe('Test Issue');
    });
});
