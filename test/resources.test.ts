import { describe, it, expect, vi } from 'vitest';
import { resource, registerResource } from '../src/core/resources';
import { ParserScenario } from '../src/core/types';
import { calculateRollupVerdict } from '../src/core/utils';

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

    it('should compute rollup verdict and testcases map for testrun', () => {
        expect(calculateRollupVerdict(['passed', 'passed'])).toBe('passed');
        expect(calculateRollupVerdict(['passed', 'failed'])).toBe('failed');
        expect(calculateRollupVerdict(['passed', 'pending'])).toBe('pending');
        expect(calculateRollupVerdict([])).toBe('pending');

        const mockRunScenario: any = {
            feature: { name: 'Run 1' },
            custom: {
                groupScenarios: [
                    { rule: { name: 'cart.case.feature' }, name: '@tc-01', custom: { fields: { status: 'passed' } } },
                    { rule: { name: 'cart.case.feature' }, name: '@tc-02', custom: { fields: { status: 'failed' } } }
                ]
            }
        };

        const evaluated = resource.evaluate('github_testrun', mockRunScenario);
        expect(evaluated.status).toBe('failed');
        expect(evaluated.testcases).toEqual({
            'cart.case.feature.@tc-01': 'passed',
            'cart.case.feature.@tc-02': 'failed'
        });
        expect(evaluated.metadata).toEqual({});
    });

    it('should compute rollup verdict and testruns map for testplan', () => {
        const mockPlanScenario: any = {
            feature: { name: 'Plan 1' },
            custom: {
                testruns: ['testruns/run-1.run.feature', 'testruns/run-2.run.feature']
            }
        };

        const mockState = {
            getResources: (type: string) => {
                if (type === 'github_testrun' || type === 'testrun') {
                    return [
                        { identity: 'testruns/run-1.run.feature.@tr-1', attributes: { status: 'passed' } },
                        { identity: 'testruns/run-2.run.feature.@tr-2', attributes: { status: 'failed' } }
                    ];
                }
                return [];
            }
        };

        const evaluated = resource.evaluate('github_testplan', mockPlanScenario, { state: mockState });
        expect(evaluated.status).toBe('failed');
        expect(evaluated.testruns).toEqual({
            'testruns/run-1.run.feature': 'passed',
            'testruns/run-2.run.feature': 'failed'
        });
        expect(evaluated.metadata).toEqual({});
    });

    it('should support declarative { api, state } schema registration and evaluation', () => {
        registerResource({
            type: 'pokedex_creature',
            api: {
                pokemon: (s: any) => ({
                    name: s.name,
                    level: s.custom?.fields?.level || 1,
                    type: s.custom?.fields?.type || 'normal'
                }),
                trainer: (s: any) => ({
                    trainerId: s.custom?.fields?.trainer || 'red'
                })
            },
            state: {
                status: (s: any) => s.custom?.fields?.status || 'wild',
                caughtAt: () => '2026-10-30'
            }
        });

        const mockScenario: any = {
            name: 'Pikachu',
            custom: {
                fields: {
                    level: 25,
                    type: 'electric',
                    trainer: 'ash',
                    status: 'caught'
                }
            }
        };

        const apiPayload = resource.evaluateApi('pokedex_creature', mockScenario);
        expect(apiPayload.pokemon).toEqual({
            name: 'Pikachu',
            level: 25,
            type: 'electric'
        });
        expect(apiPayload.trainer).toEqual({
            trainerId: 'ash'
        });

        const statePayload = resource.evaluateState('pokedex_creature', mockScenario);
        expect(statePayload).toEqual({
            status: 'caught',
            caughtAt: '2026-10-30'
        });

        // Combined flat evaluation
        const flatEvaluated = resource.evaluate('pokedex_creature', mockScenario);
        expect(flatEvaluated.status).toBe('caught');
        expect(flatEvaluated.pokemon).toBeDefined();
    });

    it('should support attributes definition and lifecycle hooks for custom resources (pokedex & register-pokemon example)', async () => {
        const subirFotoMock = vi.fn();
        const fakePokedexProvider = {
            name: 'pokedex',
            resources: {
                'register-pokemon': {
                    create: vi.fn().mockResolvedValue({ id: 'pk-025', number: 25 })
                }
            },
            subirFotoPokemon: subirFotoMock
        };

        const beforeCreateMock = vi.fn();
        const afterCreateMock = vi.fn(async ({ id, attributes, provider }: any) => {
            if (provider?.subirFotoPokemon) {
                await provider.subirFotoPokemon(id, attributes.foto);
            }
        });

        registerResource({
            type: 'register-pokemon',
            attributes: (s: any) => ({
                nombre: s.name,
                tipo: s.custom?.fields?.tipo ?? 'Eléctrico',
                nivel: s.custom?.fields?.nivel ?? 25,
                foto: s.custom?.fields?.foto ?? 'https://img.pokemondb.net/sprites/home/normal/pikachu.png'
            }),
            lifecycle: {
                beforeCreate: beforeCreateMock,
                afterCreate: afterCreateMock
            },
            state: {
                region: () => 'Kanto'
            }
        });

        const mockScenario: any = {
            name: 'Pikachu',
            custom: {
                fields: {
                    tipo: 'Eléctrico',
                    nivel: 25,
                    foto: 'https://img.pokemondb.net/sprites/home/normal/pikachu.png'
                }
            }
        };

        // 1. Evaluate attributes
        const attrs = resource.evaluateAttributes('register-pokemon', mockScenario);
        expect(attrs).toEqual({
            nombre: 'Pikachu',
            tipo: 'Eléctrico',
            nivel: 25,
            foto: 'https://img.pokemondb.net/sprites/home/normal/pikachu.png'
        });

        // 2. Evaluate state
        const stateData = resource.evaluateState('register-pokemon', mockScenario);
        expect(stateData).toEqual({
            region: 'Kanto'
        });

        // 3. Lifecycle hook retrieval & invocation
        const lifecycle = resource.getLifecycle('register-pokemon');
        expect(lifecycle).toBeDefined();
        expect(lifecycle?.beforeCreate).toBe(beforeCreateMock);
        expect(lifecycle?.afterCreate).toBe(afterCreateMock);

        await lifecycle?.beforeCreate?.({ attributes: attrs, scenario: mockScenario, context: {} });
        expect(beforeCreateMock).toHaveBeenCalledWith(expect.objectContaining({ attributes: attrs }));

        // Provider CRUD simulation with primary standard method `create`
        const result = await fakePokedexProvider.resources['register-pokemon'].create(attrs);
        expect(result.id).toBe('pk-025');

        // Post-creation hook with custom function invocation for photo upload
        await lifecycle?.afterCreate?.({
            id: result.id,
            attributes: attrs,
            provider: fakePokedexProvider,
            scenario: mockScenario,
            context: {}
        });
        expect(subirFotoMock).toHaveBeenCalledWith('pk-025', 'https://img.pokemondb.net/sprites/home/normal/pikachu.png');
    });
});
