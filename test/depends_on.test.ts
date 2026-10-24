import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { DependencyResolver } from '../src/core/dependencies';
import { validateCmd } from '../src/commands/validate';
import { addressesMatch } from '../src/core/utils';

describe('Meta-Argument depends_on (Phase 4)', () => {
    const testDir = resolve(__dirname, 'tmp-dependson-test');

    beforeEach(() => {
        rmSync(testDir, { recursive: true, force: true });
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should parse dependencies from testform.yml and Gherkin @depends_on tags', () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

dependencies:
  "checkout/checkout.case.feature.@tc-6":
    - "auth/login.case.feature.@tc-1"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const resolver = new DependencyResolver(testDir);

        // Check YAML dependency
        const yamlDeps = resolver.getDependencies('checkout/checkout.case.feature.@tc-6', []);
        expect(yamlDeps.some(d => addressesMatch(d, 'auth/login.case.feature.@tc-1'))).toBe(true);

        // Check Gherkin tag dependency
        const tagDeps = resolver.getDependencies('inventory/catalog.case.feature.@tc-4', [
            '@smoke',
            '@depends_on("auth/login.case.feature.@tc-1", "config/init.case.feature.@tc-0")'
        ]);
        expect(tagDeps.some(d => addressesMatch(d, 'auth/login.case.feature.@tc-1'))).toBe(true);
        expect(tagDeps.some(d => addressesMatch(d, 'config/init.case.feature.@tc-0'))).toBe(true);
    });

    it('should sort resources topologically so prerequisites run first', () => {
        const resolver = new DependencyResolver(testDir);

        const items = [
            { id: 'checkout/pay.case.feature.@tc-3', tags: ['@depends_on("checkout/cart.case.feature.@tc-2")'] },
            { id: 'auth/login.case.feature.@tc-1', tags: [] },
            { id: 'checkout/cart.case.feature.@tc-2', tags: ['@depends_on("auth/login.case.feature.@tc-1")'] }
        ];

        const sorted = resolver.sortTopologically(
            items,
            item => item.id,
            item => item.tags
        );

        expect(sorted.map(s => s.id)).toEqual([
            'auth/login.case.feature.@tc-1',
            'checkout/cart.case.feature.@tc-2',
            'checkout/pay.case.feature.@tc-3'
        ]);
    });

    it('should detect circular dependency cycles and throw a clear Cycle error', () => {
        const resolver = new DependencyResolver(testDir);

        const circularItems = [
            { id: 'auth/stepA.case.feature.@tc-1', tags: ['@depends_on("auth/stepB.case.feature.@tc-2")'] },
            { id: 'auth/stepB.case.feature.@tc-2', tags: ['@depends_on("auth/stepA.case.feature.@tc-1")'] }
        ];

        expect(() => {
            resolver.sortTopologically(
                circularItems,
                item => item.id,
                item => item.tags
            );
        }).toThrow(/Cycle:/);
    });

    it('should fail validateCmd when a circular dependency is detected', async () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        mkdirSync(resolve(testDir, 'auth'), { recursive: true });
        const featureA = `
@testcase
Feature: Step A
  @tc-1 @depends_on("auth/b.case.feature.@tc-2")
  Scenario: Step A scenario
    Given step A
    When execute step A
    Then verify step A
`;
        writeFileSync(resolve(testDir, 'auth/a.case.feature'), featureA);

        const featureB = `
@testcase
Feature: Step B
  @tc-2 @depends_on("auth/a.case.feature.@tc-1")
  Scenario: Step B scenario
    Given step B
    When execute step B
    Then verify step B
`;
        writeFileSync(resolve(testDir, 'auth/b.case.feature'), featureB);

        // Validation with JSON should return valid: false and Circular dependency detected
        let jsonOutput = '';
        const originalLog = console.log;
        console.log = (msg: string) => { jsonOutput += msg; };

        try {
            await validateCmd({
                targetPath: testDir,
                scope: 'testcase',
                isJson: true,
                noTests: true
            });
        } finally {
            console.log = originalLog;
        }

        const parsed = JSON.parse(jsonOutput);
        expect(parsed.valid).toBe(false);
        expect(parsed.diagnostics[0].summary).toBe('Circular dependency detected');
    });
});
