import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { loginCmd } from '../src/commands/login';
import { Credentials } from '../src/core/credentials';
import * as readline from 'readline';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('../src/core/credentials');
vi.mock('readline');

describe('Command loginCmd', () => {
    let mockQuestion: any;
    let mockClose: any;

    beforeEach(() => {
        mockExit.mockClear();
        mockLog.mockClear();
        (Credentials as any).mockClear();

        mockQuestion = vi.fn();
        mockClose = vi.fn();

        (readline.createInterface as any).mockReturnValue({
            question: mockQuestion,
            close: mockClose
        });
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        vi.restoreAllMocks();
    });

    it('should successfully log in when a valid token is provided', async () => {
        const mockSetAuth = vi.fn();
        (Credentials as any).mockImplementation(function() {
            return {
                setAuth: mockSetAuth
            };
        });

        // Simulate user typing a valid token
        mockQuestion.mockImplementation(((questionText: string, cb: any) => {
            cb('my-secret-token');
        }) as any);

        await loginCmd({ hostname: 'github.com' });

        expect(mockSetAuth).toHaveBeenCalledWith('github.com', { token: 'my-secret-token' });
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Configuration saved for github.com');
        expect(mockClose).toHaveBeenCalled();
    });

    it('should abort if an empty token is provided', async () => {
        // Simulate user typing an empty token
        mockQuestion.mockImplementation(((questionText: string, cb: any) => {
            cb('   ');
        }) as any);

        await expect(loginCmd({ hostname: 'github.com' })).rejects.toThrow('Process exited with code 1');

        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Token cannot be empty');
        expect(mockClose).toHaveBeenCalled();
    });

    it('should default to github.com if hostname is app.terraform.io', async () => {
        const mockSetAuth = vi.fn();
        (Credentials as any).mockImplementation(function() {
            return {
                setAuth: mockSetAuth
            };
        });

        mockQuestion.mockImplementation(((questionText: string, cb: any) => {
            cb('token123');
        }) as any);

        await loginCmd({ hostname: 'app.terraform.io' });

        expect(mockSetAuth).toHaveBeenCalledWith('github.com', { token: 'token123' });
    });
});
