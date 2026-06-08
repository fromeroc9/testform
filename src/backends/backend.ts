import { IState } from '../core/types';

export interface IBackend {
    /**
     * Read the state from the backend.
     * Should return null or throw an error (or return an empty state) if it doesn't exist.
     */
    read(): Promise<IState>;

    /**
     * Check if the state file exists in the backend.
     */
    exists(): Promise<boolean>;

    /**
     * Write the state to the backend.
     */
    write(state: IState): Promise<void>;

    /**
     * Acquire a state lock.
     * @param timeout The timeout format (e.g., "0s", "10s").
     */
    lock(timeout: string): Promise<boolean>;

    /**
     * Release the state lock.
     */
    unlock(): Promise<boolean>;

    /**
     * Force unlock using a lock ID.
     */
    forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }>;

    /**
     * Check if the state is currently locked.
     */
    isLocked(): Promise<boolean>;

    /**
     * List all available workspaces.
     */
    listWorkspaces(): Promise<string[]>;

    /**
     * Delete a workspace state.
     */
    deleteWorkspace(name: string): Promise<boolean>;
}
