import { describe, it, expect, vi } from 'vitest';
import { functionsCmd, FUNCTIONS_CATALOG } from '../src/commands/functions';

describe('functions command', () => {
    it('has all documented standard functions in FUNCTIONS_CATALOG', () => {
        expect(FUNCTIONS_CATALOG.lower).toBeDefined();
        expect(FUNCTIONS_CATALOG.upper).toBeDefined();
        expect(FUNCTIONS_CATALOG.format).toBeDefined();
        expect(FUNCTIONS_CATALOG.contains).toBeDefined();
        expect(FUNCTIONS_CATALOG.env).toBeDefined();
        expect(FUNCTIONS_CATALOG.jsonencode).toBeDefined();
    });

    it('prints functions catalog without throwing', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await functionsCmd({});
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('prints specific function detail for lower', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await functionsCmd({ name: 'lower' });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('evaluates expression with --eval', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await functionsCmd({ evalExpr: 'format("%s-app", lower("TEST"))' });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});
