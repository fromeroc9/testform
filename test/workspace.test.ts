import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { workspaceCmd } from '../src/commands/workspace';
import { State } from '../src/core/state';

const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../src/core/state');

describe('Command workspaceCmd', () => {
    beforeEach(() => {
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
        (State as any).mockClear();
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        mockError.mockRestore();
        vi.restoreAllMocks();
    });

    it('should exit if no subcommand is provided', async () => {
        await expect(workspaceCmd({ dir: '.', verbose: false, args: [] })).rejects.toThrow();
    });

    it('should exit with error for unknown subcommand', async () => {
        (State as any).mockImplementation(function() {
            return {
                getCurrentWorkspace: vi.fn().mockReturnValue('default')
            };
        });
        await expect(workspaceCmd({ dir: '.', verbose: false, args: ['unknown'] })).rejects.toThrow();
    });

    describe('show', () => {
        it('should show the current workspace', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('dev')
                };
            });

            await workspaceCmd({ dir: '.', verbose: false, args: ['show'] });

            expect(mockLog).toHaveBeenCalledWith('dev');
        });
    });

    describe('list', () => {
        it('should list all workspaces and mark the current one', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('dev'),
                    listWorkspaces: vi.fn<any>().mockResolvedValue(['default', 'dev', 'prod'])
                };
            });

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
            const mockSetCurrentWorkspace = vi.fn();
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default'),
                    listWorkspaces: vi.fn<any>().mockResolvedValue(['default']),
                    setCurrentWorkspace: mockSetCurrentWorkspace
                };
            });

            await workspaceCmd({ dir: '.', verbose: false, args: ['new', 'dev'] });

            expect(mockSetCurrentWorkspace).toHaveBeenCalledWith('dev');
            expect(mockLog).toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Created and switched to workspace "dev"!');
        });

        it('should exit if workspace name is not provided', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default')
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['new'] })).rejects.toThrow();
        });

        it('should exit if workspace already exists', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default'),
                    listWorkspaces: vi.fn<any>().mockResolvedValue(['default', 'dev'])
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['new', 'dev'] })).rejects.toThrow();
        });
    });

    describe('select', () => {
        it('should switch to an existing workspace', async () => {
            const mockSetCurrentWorkspace = vi.fn();
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default'),
                    listWorkspaces: vi.fn<any>().mockResolvedValue(['default', 'dev']),
                    setCurrentWorkspace: mockSetCurrentWorkspace
                };
            });

            await workspaceCmd({ dir: '.', verbose: false, args: ['select', 'dev'] });

            expect(mockSetCurrentWorkspace).toHaveBeenCalledWith('dev');
            expect(mockLog).toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Switched to workspace "dev".');
        });

        it('should exit if workspace name is not provided', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default')
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['select'] })).rejects.toThrow();
        });

        it('should exit if workspace does not exist', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default'),
                    listWorkspaces: vi.fn<any>().mockResolvedValue(['default'])
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['select', 'missing'] })).rejects.toThrow();
        });
    });

    describe('delete', () => {
        it('should delete an existing workspace', async () => {
            const mockDeleteWorkspace = vi.fn<any>().mockResolvedValue(true);
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default'),
                    listWorkspaces: vi.fn<any>().mockResolvedValue(['default', 'dev']),
                    deleteWorkspace: mockDeleteWorkspace
                };
            });

            await workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'dev'] });

            expect(mockDeleteWorkspace).toHaveBeenCalledWith('dev');
            expect(mockLog).toHaveBeenCalled();
            const logs = mockLog.mock.calls.join(' ');
            expect(logs).toContain('Deleted workspace "dev"!');
        });

        it('should exit if workspace name is not provided', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default')
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete'] })).rejects.toThrow();
        });

        it('should exit if trying to delete default workspace', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default')
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'default'] })).rejects.toThrow();
        });

        it('should exit if trying to delete active workspace', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('dev')
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'dev'] })).rejects.toThrow();
        });

        it('should exit if workspace does not exist', async () => {
            (State as any).mockImplementation(function() {
                return {
                    getCurrentWorkspace: vi.fn().mockReturnValue('default'),
                    listWorkspaces: vi.fn<any>().mockResolvedValue(['default'])
                };
            });

            await expect(workspaceCmd({ dir: '.', verbose: false, args: ['delete', 'missing'] })).rejects.toThrow();
        });
    });
});
