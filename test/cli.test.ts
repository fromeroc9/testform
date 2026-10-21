import { describe, it, expect, vi } from 'vitest';
import {
    resolveScopes,
    normalizeScope,
    assertApprovalAllowed,
    resolveWorkDir,
    resolveVariableParser,
    normalizeCliArgs,
    compareCliVersions,
    withStateLock,
    ALL_SCOPES,
} from '../src/core/cli';
import { State } from '../src/core/state';
import { resolve } from 'path';

vi.mock('../src/core/state');

describe('cli module', () => {
    describe('resolveScopes', () => {
        it('should return all scopes for undefined or "all"', () => {
            expect(resolveScopes()).toEqual(ALL_SCOPES);
            expect(resolveScopes('all')).toEqual(ALL_SCOPES);
        });

        it('should return single scope array for specific scope', () => {
            expect(resolveScopes('testcase')).toEqual(['testcase']);
            expect(resolveScopes('testrun')).toEqual(['testrun']);
            expect(resolveScopes('testplan')).toEqual(['testplan']);
        });
    });

    describe('normalizeScope', () => {
        it('should return all and testcase fallback for empty scope', () => {
            expect(normalizeScope()).toEqual({ scope: 'all', singleScope: 'testcase' });
            expect(normalizeScope('all')).toEqual({ scope: 'all', singleScope: 'testcase' });
        });

        it('should preserve specific scope as singleScope', () => {
            expect(normalizeScope('testrun')).toEqual({ scope: 'testrun', singleScope: 'testrun' });
        });
    });

    describe('assertApprovalAllowed', () => {
        it('should not throw if autoApprove is true', () => {
            expect(() => assertApprovalAllowed(true, false)).not.toThrow();
            expect(() => assertApprovalAllowed(true, true)).not.toThrow();
        });

        it('should not throw if input is true even when autoApprove is false', () => {
            expect(() => assertApprovalAllowed(false, true)).not.toThrow();
        });

        it('should throw "No input allowed" error when both autoApprove and input are false', () => {
            const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                expect(() => assertApprovalAllowed(false, false)).toThrow(/No input allowed|This command requires manual approval/);
                expect(mockConsoleError).toHaveBeenCalled();
            } finally {
                mockConsoleError.mockRestore();
            }
        });
    });

    describe('resolveWorkDir', () => {
        it('should resolve current working directory by default', () => {
            const cwd = process.cwd();
            expect(resolveWorkDir({})).toBe(cwd);
        });

        it('should resolve specified chdir relative to cwd', () => {
            const resolved = resolveWorkDir({ chdir: 'subfolder' });
            expect(resolved).toBe(resolve(process.cwd(), 'subfolder'));
        });
    });

    describe('resolveVariableParser', () => {
        it('should create VariableParser with parsed key=value variables', () => {
            const vp = resolveVariableParser({ var: 'env=staging' }, process.cwd());
            expect(vp).toBeDefined();
            expect(vp.getVars()['env']).toBe('staging');
        });

        it('should accept array inputs for var', () => {
            const vp = resolveVariableParser({ var: ['a=1', 'b=2'] }, process.cwd());
            expect(vp).toBeDefined();
            expect(vp.getVars()['a']).toBe('1');
            expect(vp.getVars()['b']).toBe('2');
        });
    });

    describe('normalizeCliArgs', () => {
        it('should convert single dash long flags to double dash', () => {
            const raw = ['-auto-approve', '-target=my_target', '-chdir=foo'];
            const normalized = normalizeCliArgs(raw);
            expect(normalized).toEqual(['--auto-approve', '--target=my_target', '--chdir=foo']);
        });

        it('should preserve short single-dash flags (-v, -s, -h, -C, -a, -o)', () => {
            const raw = ['-v', '-s', 'testcase', '-C', 'dir', '-h'];
            const normalized = normalizeCliArgs(raw);
            expect(normalized).toEqual(['-v', '-s', 'testcase', '-C', 'dir', '-h']);
        });

        it('should preserve positional arguments and double dash flags', () => {
            const raw = ['apply', '--auto-approve', 'my_plan.tfplan'];
            const normalized = normalizeCliArgs(raw);
            expect(normalized).toEqual(['apply', '--auto-approve', 'my_plan.tfplan']);
        });
    });

    describe('compareCliVersions', () => {
        it('should return -1 when a < b', () => {
            expect(compareCliVersions('1.0.0', '1.0.1')).toBe(-1);
            expect(compareCliVersions('1.1.0', '1.2.0')).toBe(-1);
            expect(compareCliVersions('0.9.0', '1.0.0')).toBe(-1);
        });

        it('should return 1 when a > b', () => {
            expect(compareCliVersions('1.0.2', '1.0.1')).toBe(1);
            expect(compareCliVersions('2.0.0', '1.9.9')).toBe(1);
        });

        it('should return 0 when a === b', () => {
            expect(compareCliVersions('1.0.0', '1.0.0')).toBe(0);
        });
    });

    describe('withStateLock', () => {
        it('should initialize state, acquire lock, execute function, and release lock', async () => {
            const mockInit = vi.fn().mockResolvedValue(undefined);
            const mockAcquireLock = vi.fn().mockResolvedValue(undefined);
            const mockReleaseLock = vi.fn().mockResolvedValue(undefined);

            (State as any).mockImplementation(function() {
                return {
                    init: mockInit,
                    acquireLock: mockAcquireLock,
                    releaseLock: mockReleaseLock,
                };
            });

            const result = await withStateLock({ dir: '.', lock: true, lockTimeout: '10s' }, async (st) => {
                expect(st).toBeDefined();
                return 'executed';
            });

            expect(result).toBe('executed');
            expect(mockInit).toHaveBeenCalled();
            expect(mockAcquireLock).toHaveBeenCalledWith(true, '10s');
            expect(mockReleaseLock).toHaveBeenCalled();
        });

        it('should release lock even when inner function throws an error', async () => {
            const mockInit = vi.fn().mockResolvedValue(undefined);
            const mockAcquireLock = vi.fn().mockResolvedValue(undefined);
            const mockReleaseLock = vi.fn().mockResolvedValue(undefined);

            (State as any).mockImplementation(function() {
                return {
                    init: mockInit,
                    acquireLock: mockAcquireLock,
                    releaseLock: mockReleaseLock,
                };
            });

            await expect(withStateLock({}, async () => {
                throw new Error('inner failure');
            })).rejects.toThrow('inner failure');

            expect(mockReleaseLock).toHaveBeenCalled();
        });
    });
});
