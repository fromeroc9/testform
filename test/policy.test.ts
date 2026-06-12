import { describe, it, expect } from '@jest/globals';
import { policy } from '../src/core/policy';
import { ParserScenario, PolicyRule } from '../src/core/types';

describe('Policy duplicate-testruns-in-testplan', () => {
    it('should detect duplicate testruns in the same file', () => {
        const scenario: ParserScenario = {
            uri: 'testplans/Magento-tp1.plan.feature',
            feature: { tags: [], keyword: 'Feature', name: 'Plan de Pruebas Magento', description: '', location: 1 },
            location: 2,
            keyword: 'Feature',
            name: 'Plan de Pruebas Magento',
            description: '',
            steps: [],
            tags: [],
            custom: {
                testruns: [
                    'testruns/Magento-1.run.feature',
                    'testruns/Magento-1.run.feature',
                    'testruns/Magento-2.run.feature'
                ]
            }
        };

        const rules: PolicyRule[] = [];
        const policyDef = (policy as any).builtinPolicies['duplicate-testruns-in-testplan'];
        expect(policyDef).toBeDefined();

        policyDef.action([scenario], rules, 'testplan');

        expect(rules.length).toBe(1);
        expect(rules[0].id).toBe('duplicate-testruns-in-testplan');
        expect(rules[0].title).toContain('Duplicate testruns defined in the same testplan: testruns/Magento-1.run.feature');
    });

    it('should detect duplicate testruns across multiple testplan files', () => {
        const scenario1: ParserScenario = {
            uri: 'testplans/Magento-tp1.plan.feature',
            feature: { tags: [], keyword: 'Feature', name: 'Plan de Pruebas Magento', description: '', location: 1 },
            location: 2,
            keyword: 'Feature',
            name: 'Plan de Pruebas Magento',
            description: '',
            steps: [],
            tags: [],
            custom: {
                testruns: [
                    'testruns/Magento-1.run.feature'
                ]
            }
        };

        const scenario2: ParserScenario = {
            uri: 'testplans/Magento-tp2.plan.feature',
            feature: { tags: [], keyword: 'Feature', name: 'Plan de Pruebas Magento 2', description: '', location: 1 },
            location: 2,
            keyword: 'Feature',
            name: 'Plan de Pruebas Magento 2',
            description: '',
            steps: [],
            tags: [],
            custom: {
                testruns: [
                    'testruns/Magento-1.run.feature'
                ]
            }
        };

        const rules: PolicyRule[] = [];
        const policyDef = (policy as any).builtinPolicies['duplicate-testruns-in-testplan'];

        policyDef.action([scenario1, scenario2], rules, 'testplan');

        // It should push 2 rules, one for each file since the testrun is duplicated between them
        expect(rules.length).toBe(2);
        expect(rules[0].id).toBe('duplicate-testruns-across-testplans');
        expect(rules[1].id).toBe('duplicate-testruns-across-testplans');
        expect(rules[0].title).toBe('Testrun "testruns/Magento-1.run.feature" is declared in multiple testplans');
    });
});
