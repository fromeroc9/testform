import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { workspaceCmd } from '../src/commands/workspace';
import { State } from '../src/core/state';

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../src/core/state');

describe('Command workspaceCmd', () => {
    beforeEach(() => {
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (State as jest.Mock).mockClear();
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        mockError.mockRestore();
        jest.restoreAllMocks();
    });

    it('should exit if no subcommand is provided', async () => {
        await expect(workspaceCmd({ dir: '.', verbose: false, args: [] })).rejects.toThrow('Process exited with code 1');
    });

    it('should exit with error for unknown subcommand', async () => {
        (State as jest.Mock).mockImplementation(() => ({
            getCurrentWorkspace: jest.fn().mockReturnValue('default')
        }));
        await expect(workspaceCmd({ dir: '.', verbose: false, args: ['unknown'] })).rejects.toThrow('Process exited with code 1');
    });

    describe('show', () => {
        it('should show the current workspace', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('dev')
            }));

            await workspaceCmd({ dir: '.', verbose: false, args: ['show'] });

            expect(mockLog).toHaveBeenCalledWith('dev');
        });
    });

    describe('list', () => {
        it('should list all workspaces and mark the current one', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('dev'),
                listWorkspaces: jest.fn<any>().mockResolvedValue(['default', 'dev', 'prod'])
            }));

            await workspaceCmd({ dir: '.', verbose: false, args: ['list'] });

            expect(mockLog).toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('* dev');
            expect(logs).toContain('  default');
            expect(logs).toContain('  prod');
        });
    });

    describe('new', () => {
        it('should create and switch to a new workspace', async () => {
            const mockSetCurrentWorkspace = jest.fn();
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default'),
                listWorkspaces: jest.fn<any>().mockResolvedValue(['default']),
                setCurrentWorkspace: mockSetCurrentWorkspace
            }));

            await workspaceCmd({ dir: '.', verbose: false, args: ['new', 'dev'] });

            expect(mockSetCurrentWorkspace).toHaveBeenCalledWith('dev');
            expect(mockLog).toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Created and switched to workspace "dev"!');
        });

        it('should exit if workspace name is not provided', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default')
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['new'] })).rejects.toThrow('Process exited with code 1');
        });

        it('should exit if workspace already exists', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default'),
                listWorkspaces: jest.fn<any>().mockResolvedValue(['default', 'dev'])
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['new', 'dev'] })).rejects.toThrow('Process exited with code 1');
        });
    });

    describe('select', () => {
        it('should switch to an existing workspace', async () => {
            const mockSetCurrentWorkspace = jest.fn();
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default'),
                listWorkspaces: jest.fn<any>().mockResolvedValue(['default', 'dev']),
                setCurrentWorkspace: mockSetCurrentWorkspace
            }));

            await workspaceCmd({ dir: '.', verbose: false, args: ['select', 'dev'] });

            expect(mockSetCurrentWorkspace).toHaveBeenCalledWith('dev');
            expect(mockLog).toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Switched to workspace "dev".');
        });

        it('should exit if workspace name is not provided', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default')
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['select'] })).rejects.toThrow('Process exited with code 1');
        });

        it('should exit if workspace does not exist', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default'),
                listWorkspaces: jest.fn<any>().mockResolvedValue(['default'])
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['select', 'missing'] })).rejects.toThrow('Process exited with code 1');
        });
    });

    describe('delete', () => {
        it('should delete an existing workspace', async () => {
            const mockDeleteWorkspace = jest.fn<any>().mockResolvedValue(true);
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default'),
                listWorkspaces: jest.fn<any>().mockResolvedValue(['default', 'dev']),
                deleteWorkspace: mockDeleteWorkspace
            }));

            await workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'dev'] });

            expect(mockDeleteWorkspace).toHaveBeenCalledWith('dev');
            expect(mockLog).toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Deleted workspace "dev"!');
        });

        it('should exit if workspace name is not provided', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default')
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete'] })).rejects.toThrow('Process exited with code 1');
        });

        it('should exit if trying to delete default workspace', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default')
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'default'] })).rejects.toThrow('Process exited with code 1');
        });

        it('should exit if trying to delete active workspace', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('dev')
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'dev'] })).rejects.toThrow('Process exited with code 1');
        });

        it('should exit if workspace does not exist', async () => {
            (State as jest.Mock).mockImplementation(() => ({
                getCurrentWorkspace: jest.fn().mockReturnValue('default'),
                listWorkspaces: jest.fn<any>().mockResolvedValue(['default'])
            }));

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'missing'] })).rejects.toThrow('Process exited with code 1');
        });
    });
});
