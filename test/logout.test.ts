import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { logoutCmd } from '../src/commands/logout';
import { Credentials } from '../src/core/credentials';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('../src/core/credentials');

describe('Command logoutCmd', () => {
    beforeEach(() => {
        mockLog.mockClear();
        (Credentials as any).mockClear();
    });

    afterAll(() => {
        mockLog.mockRestore();
        vi.restoreAllMocks();
    });

    it('should successfully remove credentials if they exist', async () => {
        const mockRemoveToken = vi.fn().mockReturnValue(true);
        (Credentials as any).mockImplementation(function() {
            return {
                removeToken: mockRemoveToken
            };
        });

        await logoutCmd({ hostname: 'github.com' });

        expect(mockRemoveToken).toHaveBeenCalledWith('github.com');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Removed credentials for github.com');
    });

    it('should warn if no credentials found', async () => {
        const mockRemoveToken = vi.fn().mockReturnValue(false);
        (Credentials as any).mockImplementation(function() {
            return {
                removeToken: mockRemoveToken
            };
        });

        await logoutCmd({ hostname: 'gitlab.com' });

        expect(mockRemoveToken).toHaveBeenCalledWith('gitlab.com');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No credentials found for gitlab.com');
    });

    it('should default to github.com if hostname is app.terraform.io', async () => {
        const mockRemoveToken = vi.fn().mockReturnValue(true);
        (Credentials as any).mockImplementation(function() {
            return {
                removeToken: mockRemoveToken
            };
        });

        await logoutCmd(); // default args

        expect(mockRemoveToken).toHaveBeenCalledWith('github.com');
    });
});
