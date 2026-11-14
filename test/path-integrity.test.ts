import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { policy } from '../src/core/policy';
import { ParserScenario, PolicyRule } from '../src/core/types';

describe('Policy Path Integrity', () => {
    const tempDir = join(process.cwd(), 'test', 'temp_path_integrity');

    beforeEach(() => {
        mkdirSync(tempDir, { recursive: true });
        mkdirSync(join(tempDir, 'testcase', 'auth'), { recursive: true });
        mkdirSync(join(tempDir, 'testruns'), { recursive: true });
        mkdirSync(join(tempDir, 'testplans'), { recursive: true });
        mkdirSync(join(tempDir, 'bugs'), { recursive: true });
        mkdirSync(join(tempDir, 'attachments'), { recursive: true });

        // Create main.yml
        writeFileSync(join(tempDir, 'main.yml'), 'testform:\n  backend: local\n', 'utf-8');

        // Create a real testcase file
        writeFileSync(
            join(tempDir, 'testcase', 'auth', 'login.case.feature'),
            `@testcase\nFeature: Login\n\n  @tc-01\n  Scenario: Login con credenciales validas\n    Given el usuario esta en login\n\n  @tc-02\n  Scenario: Login fallido\n    Given el usuario ingresa datos invalidos\n`,
            'utf-8'
        );

        // Create a real testrun file
        writeFileSync(
            join(tempDir, 'testruns', 'Sprint1.run.feature'),
            `@testrun @tr-01\nFeature: Sprint 1 Run\n\n  Rule: auth/login.case.feature\n    Scenario: @tc-01\n      * set status = passed\n`,
            'utf-8'
        );

        // Create a sample attachment
        writeFileSync(join(tempDir, 'attachments', 'screenshot.png'), 'fake-image-bytes', 'utf-8');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    describe('testplan-path-integrity', () => {
        const policyDef = (policy as any).builtinPolicies['testplan-path-integrity'];

        it('should pass when referenced testrun file exists', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'testplans', 'Release.plan.feature'),
                feature: { tags: ['@testplan'], keyword: 'Feature', name: 'Release Plan', description: '', location: 1 },
                location: 1,
                keyword: 'Feature',
                name: 'Release Plan',
                description: '',
                steps: [],
                tags: [],
                custom: {
                    testruns: ['Sprint1.run.feature']
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'testplan');
            expect(rules.length).toBe(0);
        });

        it('should detect when referenced testrun file does not exist', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'testplans', 'Release.plan.feature'),
                feature: { tags: ['@testplan'], keyword: 'Feature', name: 'Release Plan', description: '', location: 1 },
                location: 10,
                keyword: 'Feature',
                name: 'Release Plan',
                description: '',
                steps: [],
                tags: [],
                custom: {
                    testruns: ['does_not_exist.run.feature']
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'testplan');
            expect(rules.length).toBe(1);
            expect(rules[0].id).toBe('testplan-path-integrity');
            expect(rules[0].type).toBe('error');
            expect(rules[0].title).toContain('Referenced testrun not found: "does_not_exist.run.feature"');
        });
    });

    describe('testrun-path-integrity', () => {
        const policyDef = (policy as any).builtinPolicies['testrun-path-integrity'];

        it('should pass when testcase file and scenario exist', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'testruns', 'Sprint1.run.feature'),
                feature: { tags: ['@testrun'], keyword: 'Feature', name: 'Sprint 1', description: '', location: 1 },
                location: 1,
                keyword: 'Feature',
                name: 'Sprint 1',
                description: '',
                steps: [],
                tags: [],
                custom: {
                    groupScenarios: [
                        {
                            name: '@tc-01',
                            rule: { name: 'auth/login.case.feature', keyword: 'Rule', description: '' },
                            location: 10
                        }
                    ] as any
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'testrun');
            expect(rules.length).toBe(0);
        });

        it('should detect when referenced testcase file does not exist', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'testruns', 'Sprint1.run.feature'),
                feature: { tags: ['@testrun'], keyword: 'Feature', name: 'Sprint 1', description: '', location: 1 },
                location: 1,
                keyword: 'Feature',
                name: 'Sprint 1',
                description: '',
                steps: [],
                tags: [],
                custom: {
                    groupScenarios: [
                        {
                            name: '@tc-01',
                            rule: { name: 'non_existent/missing.case.feature', keyword: 'Rule', description: '' },
                            location: 12
                        }
                    ] as any
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'testrun');
            expect(rules.length).toBe(1);
            expect(rules[0].id).toBe('testrun-path-integrity');
            expect(rules[0].type).toBe('error');
            expect(rules[0].title).toContain('Referenced testcase file not found: "non_existent/missing.case.feature"');
        });

        it('should detect when scenario does not exist in an existing testcase file', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'testruns', 'Sprint1.run.feature'),
                feature: { tags: ['@testrun'], keyword: 'Feature', name: 'Sprint 1', description: '', location: 1 },
                location: 1,
                keyword: 'Feature',
                name: 'Sprint 1',
                description: '',
                steps: [],
                tags: [],
                custom: {
                    groupScenarios: [
                        {
                            name: '@tc-999',
                            rule: { name: 'auth/login.case.feature', keyword: 'Rule', description: '' },
                            location: 15
                        }
                    ] as any
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'testrun');
            expect(rules.length).toBe(1);
            expect(rules[0].id).toBe('testrun-path-integrity');
            expect(rules[0].type).toBe('error');
            expect(rules[0].title).toContain('Scenario "@tc-999" not found in "auth/login.case.feature"');
        });
    });

    describe('bug-path-integrity', () => {
        const policyDef = (policy as any).builtinPolicies['bug-path-integrity'];

        it('should pass when target, testrun, and attachment all exist', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'bugs', 'auth.bug.feature'),
                feature: { tags: ['@bug'], keyword: 'Feature', name: 'Bugs Suite', description: '', location: 1 },
                location: 10,
                keyword: 'Scenario',
                name: 'Error de sesion',
                description: '',
                steps: [],
                tags: ['@bg-01'],
                custom: {
                    fields: {
                        target: 'testcase/auth/login.case.feature.@tc-01',
                        run: 'Sprint1.run.feature',
                        attach: 'attachments/screenshot.png'
                    }
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'bug');
            expect(rules.length).toBe(0);
        });

        it('should detect non-existent target testcase file in bug', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'bugs', 'auth.bug.feature'),
                feature: { tags: ['@bug'], keyword: 'Feature', name: 'Bugs Suite', description: '', location: 1 },
                location: 10,
                keyword: 'Scenario',
                name: 'Bug ficticio',
                description: '',
                steps: [],
                tags: ['@bg-01'],
                custom: {
                    fields: {
                        target: 'testcase/auth/fake.case.feature.@tc-01'
                    }
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'bug');
            expect(rules.length).toBe(1);
            expect(rules[0].id).toBe('bug-path-integrity');
            expect(rules[0].type).toBe('error');
            expect(rules[0].title).toContain('Referenced target testcase file not found');
        });

        it('should detect non-existent scenario tag inside target testcase file', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'bugs', 'auth.bug.feature'),
                feature: { tags: ['@bug'], keyword: 'Feature', name: 'Bugs Suite', description: '', location: 1 },
                location: 10,
                keyword: 'Scenario',
                name: 'Bug ficticio',
                description: '',
                steps: [],
                tags: ['@bg-01'],
                custom: {
                    fields: {
                        target: 'testcase/auth/login.case.feature.@tc-99'
                    }
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'bug');
            expect(rules.length).toBe(1);
            expect(rules[0].id).toBe('bug-path-integrity');
            expect(rules[0].type).toBe('error');
            expect(rules[0].title).toContain('Target identity "@tc-99" not found in "testcase/auth/login.case.feature"');
        });

        it('should detect non-existent run reference in bug', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'bugs', 'auth.bug.feature'),
                feature: { tags: ['@bug'], keyword: 'Feature', name: 'Bugs Suite', description: '', location: 1 },
                location: 10,
                keyword: 'Scenario',
                name: 'Bug con run roto',
                description: '',
                steps: [],
                tags: ['@bg-01'],
                custom: {
                    fields: {
                        target: '@tc-01',
                        run: 'non_existent_cycle.run.feature'
                    }
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'bug');
            expect(rules.length).toBe(1);
            expect(rules[0].id).toBe('bug-path-integrity');
            expect(rules[0].type).toBe('error');
            expect(rules[0].title).toContain('Referenced testrun not found for bug: "non_existent_cycle.run.feature"');
        });

        it('should warn when attachment file is missing on disk', () => {
            const scenario: ParserScenario = {
                uri: join(tempDir, 'bugs', 'auth.bug.feature'),
                feature: { tags: ['@bug'], keyword: 'Feature', name: 'Bugs Suite', description: '', location: 1 },
                location: 10,
                keyword: 'Scenario',
                name: 'Bug con evidencia perdida',
                description: '',
                steps: [],
                tags: ['@bg-01'],
                custom: {
                    fields: {
                        target: '@tc-01',
                        attach: 'missing_screenshot.png'
                    }
                }
            };

            const rules: PolicyRule[] = [];
            policyDef.action([scenario], rules, 'bug');
            expect(rules.length).toBe(1);
            expect(rules[0].id).toBe('bug-path-integrity');
            expect(rules[0].type).toBe('warning');
            expect(rules[0].title).toContain('Attachment file not found: "missing_screenshot.png"');
        });
    });
});
