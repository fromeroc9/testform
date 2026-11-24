import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, sanitizeTitle } from '../src/core/logger';
import { TestformError } from '../src/core/errors';

describe('Logger & sanitizeTitle', () => {
    describe('sanitizeTitle', () => {
        it('should strip redundant Error: prefixes', () => {
            expect(sanitizeTitle('Error: Something went wrong')).toBe('Something went wrong');
            expect(sanitizeTitle('error: something went wrong')).toBe('Something went wrong');
            expect(sanitizeTitle('Error: Error: nested error')).toBe('Nested error');
        });

        it('should handle standalone "error" or "Error"', () => {
            expect(sanitizeTitle('error')).toBe('An unexpected error occurred');
            expect(sanitizeTitle('Error')).toBe('An unexpected error occurred');
            expect(sanitizeTitle('ERROR')).toBe('An unexpected error occurred');
            expect(sanitizeTitle('error', 'Custom fallback')).toBe('Custom fallback');
        });

        it('should strip redundant "Error: error" or "Error: Error"', () => {
            expect(sanitizeTitle('Error: error')).toBe('An unexpected error occurred');
            expect(sanitizeTitle('Error: Error')).toBe('An unexpected error occurred');
            expect(sanitizeTitle('error: error')).toBe('An unexpected error occurred');
        });

        it('should handle "error asking for approval: interrupted"', () => {
            expect(sanitizeTitle('error asking for approval: interrupted')).toBe('Asking for approval: interrupted');
        });

        it('should strip redundant Warning: prefixes and standalone warning', () => {
            expect(sanitizeTitle('Warning: Value is deprecated')).toBe('Value is deprecated');
            expect(sanitizeTitle('warning: value is deprecated')).toBe('Value is deprecated');
            expect(sanitizeTitle('warning', 'Default warning')).toBe('Default warning');
        });

        it('should capitalize lowercase first character', () => {
            expect(sanitizeTitle('failed to load state')).toBe('Failed to load state');
        });

        it('should preserve already clean titles', () => {
            expect(sanitizeTitle('No resources found')).toBe('No resources found');
            expect(sanitizeTitle('GitLab API error [401]: Unauthorized')).toBe('GitLab API error [401]: Unauthorized');
        });
    });

    describe('Logger formatting', () => {
        let consoleSpy: any;
        let consoleErrorSpy: any;
        let logger: Logger;

        beforeEach(() => {
            logger = new Logger(false, false);
            consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('logger.push should never output "Error: Error" or "Error: error"', () => {
            expect(() => {
                logger.push({
                    type: 'error',
                    title: 'Error: Error',
                    detail: ['Something broke'],
                    close: true,
                });
            }).toThrow(TestformError);

            const calls = consoleSpy.mock.calls.flat().join('\n');
            expect(calls).not.toContain('Error: Error');
            expect(calls).not.toContain('Error: error');
            expect(calls).toContain('Error:');
            expect(calls).toContain('Something broke');
        });

        it('logger.push should clean "error asking for approval: interrupted"', () => {
            logger.push({
                type: 'error',
                title: 'error asking for approval: interrupted',
            });

            const calls = consoleSpy.mock.calls.flat().join('\n');
            expect(calls).not.toContain('Error: error');
            expect(calls).toContain('Asking for approval: interrupted');
        });

        it('logger.error should never output "Error: Error" or "Error: error"', () => {
            expect(() => {
                logger.error('Error: error');
            }).toThrow(TestformError);

            const calls = consoleErrorSpy.mock.calls.flat().join('\n');
            expect(calls).not.toContain('Error: Error');
            expect(calls).not.toContain('Error: error');
        });

        it('logger.error should not duplicate error.message when it matches the title', () => {
            expect(() => {
                logger.error('Connection refused', new Error('Connection refused'));
            }).toThrow(TestformError);

            const outputLines = consoleErrorSpy.mock.calls.flat().join('\n');
            // Count occurrences of Connection refused in output
            const matches = outputLines.match(/Connection refused/g);
            expect(matches?.length).toBe(1);
        });
    });
});
