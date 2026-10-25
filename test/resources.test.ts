import { describe, it, expect } from 'vitest';
import { resource, registerResource } from '../src/core/resources';
import { ParserScenario } from '../src/core/types';

describe('Resource Registry and User Overrides', () => {
    it('should allow user to override fields of already declared builtin resources', () => {
        const mockScenario: ParserScenario = {
            uri: 'features/login.case.feature',
            feature: {
                name: 'Authentication Feature',
                description: '',
                keyword: 'Feature',
                tags: ['@auth'],
                location: 1
            },
            name: 'Successful User Login',
            description: '',
            keyword: 'Scenario',
            location: 5,
            steps: [
                { keyword: 'Given ', text: 'user is on login page' },
                { keyword: 'When ', text: 'user inputs valid credentials' },
                { keyword: 'Then ', text: 'user sees dashboard' }
            ],
            tags: ['@auth', '@critical'],
            custom: {
                identity: 'tc-01',
                fields: {
                    milestone: 'Sprint 10'
                }
            }
        };

        // Before override: evaluate github_testcase
        const defaultEvaluated = resource.evaluate('github_testcase', mockScenario);
        expect(defaultEvaluated.title).toBe('Successful User Login');
        expect(defaultEvaluated.milestone).toBe('Sprint 10');

        // User overrides the title field
        registerResource({
            type: 'github_testcase',
            fields: [
                { name: 'title', value: (s) => `[QA-CUSTOM] ${s.name}` }
            ]
        });

        // After override: title should be customized, while other fields (milestone, body) are preserved!
        const customEvaluated = resource.evaluate('github_testcase', mockScenario);
        expect(customEvaluated.title).toBe('[QA-CUSTOM] Successful User Login');
        expect(customEvaluated.milestone).toBe('Sprint 10');
        expect(customEvaluated.body).toContain('```gherkin');
    });

    it('should allow user to register completely new custom provider resources', () => {
        registerResource({
            type: 'jira_custom_test',
            fields: [
                { name: 'summary', value: (s) => `JIRA: ${s.name}` },
                { name: 'priority', value: () => 'High' }
            ]
        });

        const mockScenario: any = {
            name: 'Checkout payment flow'
        };

        const result = resource.evaluate('jira_custom_test', mockScenario);
        expect(result.summary).toBe('JIRA: Checkout payment flow');
        expect(result.priority).toBe('High');
    });
});
