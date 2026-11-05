import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resource } from '../src/core/resources';
import { PlanChange } from '../src/core/types';

describe('Resource -feature view', () => {
    let mockLog: any;

    beforeEach(() => {
        mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        mockLog.mockRestore();
    });

    it('formats a testcase in Gherkin scenario format when action is add (+)', () => {
        const change: PlanChange = {
            action: 'add',
            identity: 'transactions.case.feature.@tc-02',
            resourceType: 'github_testcase',
            localHash: 'hash-123',
            scenario: {
                uri: 'transactions.case.feature',
                location: 10,
                keyword: 'Scenario',
                name: 'Realizar un pago de servicios (Bill Pay)',
                description: '',
                tags: ['@testcase'],
                steps: [
                    { keyword: 'Given ', text: 'el usuario ha iniciado sesión en ParaBank' },
                    { keyword: 'And ', text: 'posee al menos dos cuentas con fondos disponibles' },
                    { keyword: 'When ', text: 'el usuario hace clic en el enlace "Bill Pay"' },
                    { keyword: 'Then ', text: 'el sistema muestra el mensaje "Bill Payment Complete"' }
                ],
                feature: {
                    keyword: 'Feature',
                    name: 'Transactions',
                    description: '',
                    tags: [],
                    location: 1
                },
                custom: {
                    identity: '@tc-02',
                    fields: {
                        Status: 'Done',
                        priority: '@medium'
                    },
                    rawTags: ['@tc-02', '@testcase', '@priority=@medium'],
                    rawSteps: [
                        { keyword: '* ', text: 'field Status = Done' },
                        { keyword: 'Given ', text: 'el usuario ha iniciado sesión en ParaBank' },
                        { keyword: 'And ', text: 'posee al menos dos cuentas con fondos disponibles' },
                        { keyword: 'When ', text: 'el usuario hace clic en el enlace "Bill Pay"' },
                        { keyword: 'Then ', text: 'el sistema muestra el mensaje "Bill Payment Complete"' }
                    ]
                }
            }
        };

        const output = resource.formatFeature(change);
        const lines = output.split('\n');

        // Verify every line contains the + action symbol
        for (const line of lines) {
            expect(line).toMatch(/\+/);
        }

        expect(output).toContain('@tc-02');
        expect(output).toContain('@testcase');
        expect(output).toContain('Scenario: Realizar un pago de servicios (Bill Pay)');
        expect(output).toContain('field Status = Done');
        expect(output).toContain('Given el usuario ha iniciado sesión en ParaBank');
        expect(output).toContain('Then el sistema muestra el mensaje "Bill Payment Complete"');
    });

    it('formats a testcase in Gherkin scenario format when action is change (~)', () => {
        const change: PlanChange = {
            action: 'change',
            identity: 'transactions.case.feature.@tc-02',
            resourceType: 'github_testcase',
            localHash: 'hash-456',
            oldAttributes: {
                localHash: 'hash-123',
                remoteId: '101',
                issueNumber: 101,
                title: 'Antiguo título de pago',
                body: '```gherkin\nGiven paso antiguo\n```',
                labels: ['testcase']
            },
            scenario: {
                uri: 'transactions.case.feature',
                location: 10,
                keyword: 'Scenario',
                name: 'Nuevo título de pago',
                description: '',
                tags: ['@testcase'],
                steps: [
                    { keyword: 'Given ', text: 'paso nuevo' }
                ],
                feature: {
                    keyword: 'Feature',
                    name: 'Transactions',
                    description: '',
                    tags: [],
                    location: 1
                },
                custom: {
                    identity: '@tc-02',
                    rawTags: ['@tc-02', '@testcase'],
                    rawSteps: [
                        { keyword: 'Given ', text: 'paso nuevo' }
                    ]
                }
            }
        };

        const output = resource.formatFeature(change);
        const lines = output.split('\n');

        for (const line of lines) {
            expect(line).toMatch(/~/);
        }

        expect(output).toContain('Scenario: Antiguo título de pago -> Nuevo título de pago');
        expect(output).toContain('Given paso nuevo');
    });

    it('formats a destroyed testcase reconstructing from state attributes (-)', () => {
        const change: PlanChange = {
            action: 'destroy',
            identity: 'transactions.case.feature.@tc-99',
            resourceType: 'github_testcase',
            localHash: 'hash-999',
            oldAttributes: {
                localHash: 'hash-999',
                remoteId: '99',
                issueNumber: 99,
                title: 'Escenario eliminado',
                body: '```gherkin\nGiven usuario deshabilitado\nWhen intenta ingresar\nThen acceso denegado\n```',
                labels: ['testcase', 'tc-99']
            },
            scenario: {
                uri: 'transactions.case.feature',
                location: 0,
                keyword: 'Scenario',
                name: '',
                description: '',
                steps: [],
                tags: [],
                feature: { keyword: '', name: '', description: '', tags: [], location: 0 }
            }
        };

        const output = resource.formatFeature(change);
        const lines = output.split('\n');

        for (const line of lines) {
            expect(line).toMatch(/-/);
        }

        expect(output).toContain('Scenario: Escenario eliminado');
        expect(output).toContain('Given usuario deshabilitado');
        expect(output).toContain('Then acceso denegado');
    });

    it('resource.summary uses formatFeature when context.feature is true', () => {
        const change: PlanChange = {
            action: 'add',
            identity: 'auth.case.feature.@tc-01',
            resourceType: 'github_testcase',
            localHash: 'hash-001',
            scenario: {
                uri: 'auth.case.feature',
                location: 5,
                keyword: 'Scenario',
                name: 'Login exitoso',
                description: '',
                tags: ['@tc-01'],
                steps: [
                    { keyword: 'Given ', text: 'usuario en home' }
                ],
                feature: { keyword: 'Feature', name: 'Auth', description: '', tags: [], location: 1 },
                custom: {
                    identity: '@tc-01',
                    rawTags: ['@tc-01'],
                    rawSteps: [{ keyword: 'Given ', text: 'usuario en home' }]
                }
            }
        };

        resource.summary([change], true, { feature: true });

        expect(mockLog).toHaveBeenCalled();
        const loggedText = mockLog.mock.calls.map((c: any) => c[0]).join('\n');

        // Should NOT contain HCL resource syntax
        expect(loggedText).not.toContain('resource "github_testcase"');
        // Should contain Gherkin Scenario
        expect(loggedText).toContain('Scenario: Login exitoso');
        expect(loggedText).toContain('Given usuario en home');
        // Should contain header and plan summary
        expect(loggedText).toContain('will be created');
        expect(loggedText).toContain('1 to add');
    });
});
