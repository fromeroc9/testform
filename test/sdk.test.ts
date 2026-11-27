import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    Config,
    Parser,
    calculatePlan,
    hashScenario,
    LocalBackend,
    builtinReports,
    detectAttributeDrift,
    registerResource,
    registerPolicy,
    evaluateExpression,
    interpolateExpressions,
    FILE_STATE,
    CONFIG_FILE_NAMES,
    VERSION_CLI,
} from '../src/sdk';

describe('Testform SDK surface', () => {
    it('exports core primitives, parsers, plan calculation, backend, sync, and reports', () => {
        const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
        expect(VERSION_CLI).toBe(rootPkg.version);
        expect(typeof Config).toBe('function');
        expect(typeof Parser).toBe('function');
        expect(typeof calculatePlan).toBe('function');
        expect(typeof hashScenario).toBe('function');
        expect(typeof LocalBackend).toBe('function');
        expect(typeof detectAttributeDrift).toBe('function');
        expect(typeof registerResource).toBe('function');
        expect(typeof registerPolicy).toBe('function');
        expect(typeof evaluateExpression).toBe('function');
        expect(typeof interpolateExpressions).toBe('function');
        expect(builtinReports).toHaveProperty('testcase-summary');
        expect(builtinReports).toHaveProperty('bidimensional');
        expect(FILE_STATE).toBe('testform.state');
        expect(CONFIG_FILE_NAMES).toContain('main.yml');
    });
});
