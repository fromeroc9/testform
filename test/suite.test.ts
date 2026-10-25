import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { suiteCmd, toolCmd, parseTagAddress } from '../src/commands/suite';
import { generateCmd } from '../src/commands/generate';
import { logger as notify } from '../src/core/logger';

vi.mock('../src/core/editor', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/editor')>();
    return {
        ...actual,
        GherkinEditor: {
            ...actual.GherkinEditor,
            expandScenarios: vi.fn(),
            updateScenarioStatus: vi.fn(),
            linkRuleOrScenario: vi.fn().mockReturnValue({ addedRule: true, addedScenario: true, updatedScenario: false }),
        },
        findNextIdentity: vi.fn().mockReturnValue('@tr-1'),
    };
});
vi.mock('../src/commands/generate');
vi.mock('../src/core/logger');

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Command suiteCmd', () => {
    beforeEach(() => {
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (generateCmd as any).mockClear?.();
        (notify.push as any).mockClear?.();
        (generateCmd as any).mockResolvedValue?.(undefined);
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        mockError.mockRestore();
        vi.restoreAllMocks();
    });

    it('should export toolCmd as an alias for backwards compatibility', () => {
        expect(toolCmd).toBe(suiteCmd);
    });

    it('should fail if no subcommand is passed in non-interactive mode', async () => {
        await expect(suiteCmd({
            dir: '.',
            subCommand: '',
            subArgs: []
        })).rejects.toThrow();

        expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            title: expect.stringContaining('suite <init|fill|link|mark')
        }));
    });

    it('should fail if unknown subcommand is passed', async () => {
        await expect(suiteCmd({
            dir: '.',
            subCommand: 'unknown',
            subArgs: []
        })).rejects.toThrow();

        expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            title: expect.stringContaining("Unknown suite subcommand: 'unknown'")
        }));
    });

    describe('suite init', () => {
        it('should fail if scope is not provided', async () => {
            await expect(suiteCmd({
                dir: '.',
                subCommand: 'init',
                subArgs: []
            })).rejects.toThrow();

            expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining('suite init -scope=<testrun|testplan>')
            }));
        });

        it('should invoke generateCmd when scope is provided', async () => {
            await suiteCmd({
                dir: '.',
                subCommand: 'init',
                subArgs: [],
                scope: 'testrun',
                title: 'Sprint 14 Regression',
                rules: ['login.feature']
            });

            expect(generateCmd).toHaveBeenCalledWith({
                dir: '.',
                scope: 'testrun',
                title: 'Sprint 14 Regression',
                rules: ['login.feature']
            });
        });
    });

    describe('suite fill', () => {
        it('should fail if target is not provided', async () => {
            await expect(suiteCmd({
                dir: '.',
                subCommand: 'fill',
                subArgs: []
            })).rejects.toThrow();

            expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining('suite fill -target=<target>')
            }));
        });

        it('should fail if target is not provided for suite expand (alias for fill)', async () => {
            await expect(suiteCmd({
                dir: '.',
                subCommand: 'expand',
                subArgs: []
            })).rejects.toThrow();

            expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining('suite fill -target=<target>')
            }));
        });
    });

    describe('suite link / mark', () => {
        it('should fail if target is not provided for suite link', async () => {
            await expect(suiteCmd({
                dir: '.',
                subCommand: 'link',
                subArgs: ['@tc-1=passed']
            })).rejects.toThrow();

            expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining('suite link "<identifier>=<status>" -target=<target>')
            }));
        });

        it('should fail if target is not provided for suite mark', async () => {
            await expect(suiteCmd({
                dir: '.',
                subCommand: 'mark',
                subArgs: ['login@tc-1=passed']
            })).rejects.toThrow();

            expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining('suite mark "<identifier>=<status>" -target=<target>')
            }));
        });
    });

    describe('parseTagAddress', () => {
        it('should parse workspace-wide single bracket tag "[@smoke]"', () => {
            const parsed = parseTagAddress('[@smoke]');
            expect(parsed.filePattern).toBeUndefined();
            expect(parsed.tags).toEqual(['@smoke']);
        });

        it('should parse file-specific tag address "checkout.case.feature.[@smoke]"', () => {
            const parsed = parseTagAddress('checkout.case.feature.[@smoke]');
            expect(parsed.filePattern).toBe('checkout.case.feature');
            expect(parsed.tags).toEqual(['@smoke']);
        });

        it('should parse multiple tags within brackets "[@smoke,@critical]"', () => {
            const parsed = parseTagAddress('[@smoke,@critical]');
            expect(parsed.filePattern).toBeUndefined();
            expect(parsed.tags).toEqual(['@smoke', '@critical']);
        });

        it('should parse file with multiple tags "auth.case.feature.[@smoke,@p1]"', () => {
            const parsed = parseTagAddress('auth.case.feature.[@smoke,@p1]');
            expect(parsed.filePattern).toBe('auth.case.feature');
            expect(parsed.tags).toEqual(['@smoke', '@p1']);
        });

        it('should automatically prepend @ if tag was provided without it', () => {
            const parsed = parseTagAddress('[smoke,critical]');
            expect(parsed.tags).toEqual(['@smoke', '@critical']);
        });

        it('should throw error on invalid non-bracket format', () => {
            expect(() => parseTagAddress('invalid-tag')).toThrow();
        });
    });

    describe('suite tags', () => {
        it('should fail if no tag expression is provided', async () => {
            await expect(suiteCmd({
                dir: '.',
                subCommand: 'tags',
                subArgs: []
            })).rejects.toThrow();

            expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining('suite tags "<address>"')
            }));
        });

        it('should generate a .run.feature file matching scenarios with the specified bracket tag', async () => {
            const fs = await import('fs');
            const os = await import('os');
            const path = await import('path');

            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testform-suite-tags-'));

            // Create config main.yml
            fs.writeFileSync(path.join(tmpDir, 'main.yml'), `
testform:
  required_version: ">= 1.0.0"
  backend: local
provider: local
scopes:
  testcase:
    directory: "tests"
  testrun:
    directory: "runs"
`, 'utf-8');

            const testsDir = path.join(tmpDir, 'tests');
            fs.mkdirSync(testsDir, { recursive: true });

            // Create a feature with @smoke
            fs.writeFileSync(path.join(testsDir, 'checkout.case.feature'), `
@testcase
Feature: Checkout Process

  @smoke @tc-01
  Scenario: Pago con tarjeta
    Given el usuario esta en el checkout
    When ingresa tarjeta valida
    Then la orden se procesa con exito

  @tc-02
  Scenario: Pago con transferencia
    Given el usuario esta en el checkout
    When selecciona transferencia
    Then se muestran las instrucciones
`, 'utf-8');

            // Run suite tags with file-specific tag address
            await suiteCmd({
                dir: tmpDir,
                subCommand: 'tags',
                subArgs: ['checkout.case.feature.[@smoke]'],
                title: 'Checkout Smoke Testrun'
            });

            const runsDir = path.join(tmpDir, 'runs');
            expect(fs.existsSync(runsDir)).toBe(true);
            const runFiles = fs.readdirSync(runsDir);
            expect(runFiles.length).toBe(1);
            expect(runFiles[0]).toContain('.run.feature');

            const runContent = fs.readFileSync(path.join(runsDir, runFiles[0]), 'utf-8');
            expect(runContent).toContain('@testrun');
            expect(runContent).toContain('Feature: Checkout Smoke Testrun');
            expect(runContent).toContain('Rule: checkout.case.feature');
            expect(runContent).toContain('Scenario: Pago con tarjeta');
            expect(runContent).toContain('* mark status = pending');
            // Does not contain tc-02 because it didn't have @smoke
            expect(runContent).not.toContain('Scenario: Pago con transferencia');

            // Clean up
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should generate a .run.feature file matching all testcases with tag [@smoke] across workspace', async () => {
            const fs = await import('fs');
            const os = await import('os');
            const path = await import('path');

            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testform-suite-all-tags-'));

            // Create config main.yml
            fs.writeFileSync(path.join(tmpDir, 'main.yml'), `
testform:
  required_version: ">= 1.0.0"
  backend: local
provider: local
scopes:
  testcase:
    directory: "tests"
  testrun:
    directory: "runs"
`, 'utf-8');

            const testsDir = path.join(tmpDir, 'tests');
            fs.mkdirSync(testsDir, { recursive: true });

            // File 1: auth
            fs.writeFileSync(path.join(testsDir, 'auth.case.feature'), `
@testcase
Feature: Auth Process

  @smoke @tc-01
  Scenario: Login exitoso
    Given usuario registrado
    When ingresa credenciales
    Then accede al panel
`, 'utf-8');

            // File 2: checkout
            fs.writeFileSync(path.join(testsDir, 'checkout.case.feature'), `
@testcase
Feature: Checkout Process

  @smoke @tc-01
  Scenario: Pago con tarjeta
    Given orden lista
    When paga
    Then aprobada

  @tc-02
  Scenario: Cancelar orden
    Given orden
    When cancela
    Then cancelada
`, 'utf-8');

            // Run suite with -tags="[@smoke]"
            await suiteCmd({
                dir: tmpDir,
                subCommand: 'tags',
                subArgs: ['[@smoke]'],
                title: 'Global Smoke Suite'
            });

            const runsDir = path.join(tmpDir, 'runs');
            expect(fs.existsSync(runsDir)).toBe(true);
            const runFiles = fs.readdirSync(runsDir);
            expect(runFiles.length).toBe(1);

            const runContent = fs.readFileSync(path.join(runsDir, runFiles[0]), 'utf-8');
            expect(runContent).toContain('@testrun');
            expect(runContent).toContain('Feature: Global Smoke Suite');
            expect(runContent).toContain('Rule: auth.case.feature');
            expect(runContent).toContain('Scenario: Login exitoso');
            expect(runContent).toContain('Rule: checkout.case.feature');
            expect(runContent).toContain('Scenario: Pago con tarjeta');
            expect(runContent).not.toContain('Scenario: Cancelar orden');

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });
});
