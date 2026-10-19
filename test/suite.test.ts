jest.mock('../src/core/gherkin-editor', () => ({ GherkinEditor: { expandScenarios: jest.fn(), updateScenarioStatus: jest.fn() } }));
﻿import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { suiteCmd, toolCmd } from '../src/commands/suite';
import { generateCmd } from '../src/commands/generate';
import { logger as notify } from '../src/core/logger';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/commands/generate');
jest.mock('../src/core/logger');

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
        jest.restoreAllMocks();
    });

    it('should export toolCmd as an alias for backwards compatibility', () => {
        expect(toolCmd).toBe(suiteCmd);
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
    });

    describe('suite mark', () => {
        it('should fail if target is not provided', async () => {
            await expect(suiteCmd({
                dir: '.',
                subCommand: 'mark',
                subArgs: ['login@tc-1=passed']
            })).rejects.toThrow();

            expect(notify.push).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining('suite mark "featureFile@tc-N=status" -target=<path|relative|@tr-N>')
            }));
        });
    });
});
