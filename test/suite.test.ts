import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { suiteCmd, toolCmd } from '../src/commands/suite';
import { generateCmd } from '../src/commands/generate';
import { logger as notify } from '../src/core/logger';

vi.mock('../src/core/gherkin-editor', () => ({
    GherkinEditor: {
        expandScenarios: vi.fn(),
        updateScenarioStatus: vi.fn(),
        linkRuleOrScenario: vi.fn().mockReturnValue({ addedRule: true, addedScenario: true, updatedScenario: false }),
    }
}));
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
            title: expect.stringContaining('suite <init|fill|link|mark>')
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
                title: expect.stringContaining('suite fill -target=<path|relative|@tr-N>')
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
                title: expect.stringContaining('suite fill -target=<path|relative|@tr-N>')
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
                title: expect.stringContaining('suite link "<identifier>=<status>" -target=<path|relative|@tr-N>')
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
                title: expect.stringContaining('suite mark "<identifier>=<status>" -target=<path|relative|@tr-N>')
            }));
        });
    });
});
