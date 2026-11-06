import { describe, it, expect } from 'vitest';
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

describe('Policy identity-required', () => {
    const policyDef = (policy as any).builtinPolicies['identity-required'];

    it('should be registered as an active system policy', () => {
        expect(policyDef).toBeDefined();
        expect(policyDef.scope).toEqual(['testcase', 'testrun', 'testplan', 'bug']);
    });

    it('should detect missing identity in testcase scope', () => {
        const scenarioWithoutId: ParserScenario = {
            uri: 'testcases/auth.case.feature',
            feature: { tags: ['@testcase'], keyword: 'Feature', name: 'Auth', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Login exitoso',
            description: '',
            steps: [],
            tags: ['@smoke'],
            custom: {} // missing identity
        };

        const rules: PolicyRule[] = [];
        policyDef.action([scenarioWithoutId], rules, 'testcase');

        expect(rules.length).toBe(1);
        expect(rules[0].id).toBe('identity-required');
        expect(rules[0].title).toBe('Every scenario must have an identity tag matching the configured identity pattern.');
    });

    it('should pass testcase scenario when valid identity is provided', () => {
        const scenarioWithId: ParserScenario = {
            uri: 'testcases/auth.case.feature',
            feature: { tags: ['@testcase'], keyword: 'Feature', name: 'Auth', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Login exitoso',
            description: '',
            steps: [],
            tags: ['@smoke', '@tc-1'],
            custom: { identity: '@tc-1' }
        };

        const rules: PolicyRule[] = [];
        policyDef.action([scenarioWithId], rules, 'testcase');

        expect(rules.length).toBe(0);
    });

    it('should detect missing feature-level identity in testrun scope', () => {
        const runWithoutId: ParserScenario = {
            uri: 'testruns/sprint1.run.feature',
            feature: { tags: ['@testrun'], keyword: 'Feature', name: 'Sprint 1 Run', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Ejecucion',
            description: '',
            steps: [],
            tags: [],
            custom: {} // no identity
        };

        const rules: PolicyRule[] = [];
        policyDef.action([runWithoutId], rules, 'testrun');

        expect(rules.length).toBe(1);
        expect(rules[0].id).toBe('identity-required');
        expect(rules[0].title).toBe('Every feature must have an identity tag matching the configured identity pattern.');
    });

    it('should detect if testrun identity is not placed at Feature level', () => {
        const runWithMisplacedId: ParserScenario = {
            uri: 'testruns/sprint1.run.feature',
            feature: { tags: ['@testrun'], keyword: 'Feature', name: 'Sprint 1 Run', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Ejecucion',
            description: '',
            steps: [],
            tags: ['@tr-1'], // placed at scenario level instead of feature
            custom: { identity: '@tr-1' }
        };

        const rules: PolicyRule[] = [];
        policyDef.action([runWithMisplacedId], rules, 'testrun');

        expect(rules.length).toBe(1);
        expect(rules[0].id).toBe('identity-feature-level-required');
        expect(rules[0].title).toContain('must be declared at the Feature level');
    });

    it('should pass testrun when identity is correctly declared at Feature level', () => {
        const runValid: ParserScenario = {
            uri: 'testruns/sprint1.run.feature',
            feature: { tags: ['@testrun', '@tr-1'], keyword: 'Feature', name: 'Sprint 1 Run', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Ejecucion',
            description: '',
            steps: [],
            tags: [],
            custom: { identity: '@tr-1' }
        };

        const rules: PolicyRule[] = [];
        policyDef.action([runValid], rules, 'testrun');

        expect(rules.length).toBe(0);
    });

    it('should detect missing identity in bug scope', () => {
        const bugWithoutId: ParserScenario = {
            uri: 'tests/bugs/checkout.bug.feature',
            feature: { tags: ['@bug'], keyword: 'Feature', name: 'Checkout Defect', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Bug in Cart',
            description: '',
            steps: [],
            tags: [],
            custom: {}
        };

        const rules: PolicyRule[] = [];
        policyDef.action([bugWithoutId], rules, 'bug');

        expect(rules.length).toBe(1);
        expect(rules[0].id).toBe('identity-required');
        expect(rules[0].detail).toContain('@bg-1');
    });
});

describe('Policy bug-target-integrity', () => {
    const policyDef = (policy as any).builtinPolicies['bug-target-integrity'];

    it('should be registered as an active system policy for bug scope', () => {
        expect(policyDef).toBeDefined();
        expect(policyDef.scope).toContain('bug');
        expect(policyDef.severity).toBe('warning');
    });

    it('should warn when bug scenario has no target, trace, or target tag', () => {
        const untargetedBug: ParserScenario = {
            uri: 'tests/bugs/login.bug.feature',
            feature: { tags: ['@bug'], keyword: 'Feature', name: 'Login Bugs', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Crash on submit',
            description: '',
            steps: [
                { keyword: 'Given', text: 'app crashed' }
            ],
            tags: [],
            custom: { identity: '@bg-1' }
        };

        const rules: PolicyRule[] = [];
        policyDef.action([untargetedBug], rules, 'bug');

        expect(rules.length).toBe(1);
        expect(rules[0].id).toBe('bug-target-missing');
        expect(rules[0].type).toBe('warning');
    });

    it('should pass when bug scenario specifies target in steps', () => {
        const targetedBug: ParserScenario = {
            uri: 'tests/bugs/login.bug.feature',
            feature: { tags: ['@bug'], keyword: 'Feature', name: 'Login Bugs', description: '', location: 1 },
            location: 5,
            keyword: 'Scenario',
            name: 'Crash on submit',
            description: '',
            steps: [
                { keyword: '*', text: 'mark target = auth.case.feature.@tc-1' }
            ],
            tags: [],
            custom: { identity: '@bg-1' }
        };

        const rules: PolicyRule[] = [];
        policyDef.action([targetedBug], rules, 'bug');

        expect(rules.length).toBe(0);
    });
});

describe('PolicyEngine - CLI filtering by severity, include, and exclude', () => {
    it('should filter candidate scenarios using glob include and exclude patterns', () => {
        const scenarios: ParserScenario[] = [
            {
                uri: 'tests/features/cart.case.feature',
                feature: { tags: ['@testcase'], keyword: 'Feature', name: 'Cart', description: '', location: 1 },
                location: 3,
                keyword: 'Scenario',
                name: 'Add item',
                description: '',
                steps: [
                    { keyword: 'Given', text: 'empty cart' },
                    { keyword: 'When', text: 'add item' },
                    { keyword: 'Then', text: 'cart has 1 item' }
                ],
                tags: ['@smoke'],
                custom: { identity: '@tc-1' }
            },
            {
                uri: 'tests/legacy/old.case.feature',
                feature: { tags: ['@testcase'], keyword: 'Feature', name: 'Legacy', description: '', location: 1 },
                location: 3,
                keyword: 'Scenario',
                name: 'Old step',
                description: '',
                steps: [],
                tags: [],
                custom: {}
            }
        ];

        // Without exclude, old.case.feature fails identity-required
        const resUnfiltered = policy.scan(scenarios, 'testcase');
        expect(resUnfiltered.hasErrors).toBe(true);
        expect(resUnfiltered.errorCount).toBeGreaterThan(0);

        // With exclude='tests/legacy/**', legacy files are skipped
        const resFiltered = policy.scan(scenarios, 'testcase', {
            exclude: 'tests/legacy/**'
        });
        expect(resFiltered.hasErrors).toBe(false);
        expect(resFiltered.errorCount).toBe(0);
    });

    it('should allow non-blocking warnings when severity is set to error', () => {
        const scenarios: ParserScenario[] = [
            {
                uri: 'tests/features/cart.case.feature',
                feature: { tags: ['@testcase'], keyword: 'Feature', name: 'Cart', description: '', location: 1 },
                location: 3,
                keyword: 'Scenario',
                name: 'Add item',
                description: '',
                steps: [
                    { keyword: 'Given', text: 'empty cart' },
                    { keyword: 'When', text: 'add item' },
                    { keyword: 'Then', text: 'cart has 1 item' }
                ],
                tags: [],
                custom: {
                    identity: '@tc-1',
                    policy: [
                        { type: 'undeclared-field', field: 'extra_tag' }
                    ]
                }
            }
        ];

        // Normal scan collects warning for undeclared-field, but hasErrors is false!
        const res = policy.scan(scenarios, 'testcase');
        expect(res.hasWarnings).toBe(true);
        expect(res.hasErrors).toBe(false);

        // scanner() returns false (does not block plan)
        const isBlocking = policy.scanner(scenarios, 'testcase');
        expect(isBlocking).toBe(false);
    });

    it('should treat warnings as blocking only when strict=true', () => {
        const scenarios: ParserScenario[] = [
            {
                uri: 'tests/features/cart.case.feature',
                feature: { tags: ['@testcase'], keyword: 'Feature', name: 'Cart', description: '', location: 1 },
                location: 3,
                keyword: 'Scenario',
                name: 'Add item',
                description: '',
                steps: [
                    { keyword: 'Given', text: 'empty cart' },
                    { keyword: 'When', text: 'add item' },
                    { keyword: 'Then', text: 'cart has 1 item' }
                ],
                tags: [],
                custom: {
                    identity: '@tc-1',
                    policy: [
                        { type: 'undeclared-field', field: 'extra_tag' }
                    ]
                }
            }
        ];

        // In strict mode, warnings become blocking errors
        const isBlockingStrict = policy.scanner(scenarios, 'testcase', false, false, { strict: true });
        expect(isBlockingStrict).toBe(true);
    });
});

