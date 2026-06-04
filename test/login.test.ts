import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { loginCmd } from '../src/commands/login';
import { Credentials } from '../src/core/credentials';
import * as readline from 'readline';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

jest.mock('../src/core/credentials');
jest.mock('readline');

describe('Command loginCmd', () => {
    let mockQuestion: jest.Mock;
    let mockClose: jest.Mock;

    beforeEach(() => {
        mockExit.mockClear();
        mockLog.mockClear();
        (Credentials as jest.Mock).mockClear();

        mockQuestion = jest.fn();
        mockClose = jest.fn();

        (readline.createInterface as jest.Mock).mockReturnValue({
            question: mockQuestion,
            close: mockClose
        } as any);
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        jest.restoreAllMocks();
    });

    it('should successfully log in when a valid token is provided', async () => {
        const mockSetToken = jest.fn();
        (Credentials as jest.Mock).mockImplementation(() => ({
            setToken: mockSetToken
        }));

        // Simulate user typing a valid token
        mockQuestion.mockImplementation(((questionText: string, cb: any) => {
            cb('my-secret-token');
        }) as any);

        await loginCmd({ hostname: 'github.com' });

        expect(mockSetToken).toHaveBeenCalledWith('github.com', 'my-secret-token');
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs).toContain('Logged in to github.com');
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
        expect(logs).toContain('Token cannot be empty. Login aborted.');
        expect(mockClose).toHaveBeenCalled();
    });

    it('should default to github.com if hostname is app.terraform.io', async () => {
        const mockSetToken = jest.fn();
        (Credentials as jest.Mock).mockImplementation(() => ({
            setToken: mockSetToken
        }));

        mockQuestion.mockImplementation(((questionText: string, cb: any) => {
            cb('token123');
        }) as any);

        await loginCmd(); // Default options use app.terraform.io

        expect(mockSetToken).toHaveBeenCalledWith('github.com', 'token123');
    });
});
