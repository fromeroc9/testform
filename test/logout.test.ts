import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { logoutCmd } from '../src/commands/logout';
import { Credentials } from '../src/core/credentials';

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

jest.mock('../src/core/credentials');

describe('Command logoutCmd', () => {
    beforeEach(() => {
        mockLog.mockClear();
        (Credentials as jest.Mock).mockClear();
    });

    afterAll(() => {
        mockLog.mockRestore();
        jest.restoreAllMocks();
    });

    it('should successfully remove credentials if they exist', async () => {
        const mockRemoveToken = jest.fn().mockReturnValue(true);
        (Credentials as jest.Mock).mockImplementation(() => ({
            removeToken: mockRemoveToken
        }));

        await logoutCmd({ hostname: 'github.com' });

        expect(mockRemoveToken).toHaveBeenCalledWith('github.com');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Removed credentials for github.com');
    });

    it('should warn if no credentials found', async () => {
        const mockRemoveToken = jest.fn().mockReturnValue(false);
        (Credentials as jest.Mock).mockImplementation(() => ({
            removeToken: mockRemoveToken
        }));

        await logoutCmd({ hostname: 'gitlab.com' });

        expect(mockRemoveToken).toHaveBeenCalledWith('gitlab.com');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('No credentials found for gitlab.com');
    });

    it('should default to github.com if hostname is app.terraform.io', async () => {
        const mockRemoveToken = jest.fn().mockReturnValue(true);
        (Credentials as jest.Mock).mockImplementation(() => ({
            removeToken: mockRemoveToken
        }));

        await logoutCmd(); // default args

        expect(mockRemoveToken).toHaveBeenCalledWith('github.com');
    });
});
