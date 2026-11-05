import { describe, it, expect } from 'vitest';
import { parsePatternFilter, matchesScenarioFilter } from '../src/commands/spec-builder';

describe('Spec Builder Pattern Filters', () => {
    it('should parse tag filters', () => {
        const filters = parsePatternFilter('smoke');
        expect(filters).toEqual([{ filePattern: undefined, tags: ['@smoke'] }]);
    });

    it('should parse compound tag filters', () => {
        const filters = parsePatternFilter('smoke, critical');
        expect(filters).toHaveLength(2);
        expect(filters[0].tags).toEqual(['@smoke']);
        expect(filters[1].tags).toEqual(['@critical']);
    });

    it('should parse file pattern with colon tag', () => {
        const filters = parsePatternFilter('checkout.case.feature:smoke');
        expect(filters).toEqual([{ filePattern: 'checkout.case.feature', tags: ['@smoke'] }]);
    });

    it('should parse file pattern without tags', () => {
        const filters = parsePatternFilter('checkout.case.feature');
        expect(filters).toEqual([{ filePattern: 'checkout.case.feature', tags: [] }]);
    });

    it('should match scenario against filter', () => {
        const scenario = {
            uri: 'tests/features/checkout.case.feature',
            tags: ['@smoke', '@critical']
        };
        expect(matchesScenarioFilter(scenario, { filePattern: 'checkout.case.feature', tags: ['@smoke'] })).toBe(true);
        expect(matchesScenarioFilter(scenario, { filePattern: 'login.case.feature', tags: ['@smoke'] })).toBe(false);
        expect(matchesScenarioFilter(scenario, { filePattern: undefined, tags: ['@wip'] })).toBe(false);
    });
});
