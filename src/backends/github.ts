import { randomUUID } from 'crypto';
import { IBackend } from './backend';
import { IState } from '../core/types';
import { VERSION_STATE, FILE_STATE } from '../core/const';
import { getSystemUser } from '../core/utils';
import { Credentials } from '../core/credentials';

export interface GitHubBackendConfig {
    owner?: string;
    repository?: string;
    repo?: string;
    branch?: string;
    path?: string;
    token_env?: string;
    tokenEnv?: string;
}

export class GitHubBackend implements IBackend {
    private owner: string;
    private repository: string;
    private branch: string;
    private tokenEnv: string;
    private token: string;
    private statePath: string;
    private lockPath: string;
    private currentSha?: string;
    private currentLockSha?: string;
    private currentLockId?: string;

    constructor(
        private config: GitHubBackendConfig = {},
        private workspace: string = 'default',
        defaultOwner?: string,
        defaultRepo?: string,
        defaultTokenEnv?: string
    ) {
        let owner = config.owner;
        let repository = config.repository || config.repo;

        if (repository && repository.includes('/')) {
            const parts = repository.split('/');
            if (!owner) {
                owner = parts[0];
            }
            repository = parts.slice(1).join('/');
        }

        this.owner = owner || defaultOwner || '';
        this.repository = repository || defaultRepo || '';
        this.branch = config.branch || 'testform-state';
        this.tokenEnv = config.token_env || config.tokenEnv || defaultTokenEnv || 'GITHUB_TOKEN';

        let token: string | undefined = undefined;
        try {
            const creds = new Credentials();
            token = creds.getToken('github.com') || creds.getToken('github');
        } catch {
            // best-effort
        }

        const envToken = Object.prototype.hasOwnProperty.call(process.env, this.tokenEnv) ? process.env[this.tokenEnv] : undefined;
        token = token || envToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

        // Allow user to provide token directly instead of env var name
        if (!token && (this.tokenEnv.startsWith('ghp_') || this.tokenEnv.startsWith('github_pat_') || this.tokenEnv.startsWith('ghs_'))) {
            token = this.tokenEnv;
        }

        this.token = token || '';

        const basePath = config.path || FILE_STATE;
        if (this.workspace !== 'default') {
            this.statePath = `env/${this.workspace}/${basePath}`;
        } else {
            this.statePath = basePath;
        }
        this.lockPath = `${this.statePath}.lock`;
    }

    private async apiRequest(apiPath: string, options: { method?: string; body?: any } = {}): Promise<Response> {
        if (!this.token) {
            throw new Error(`GitHub token not found\n\nEnvironment variable "${this.tokenEnv}" is not set.`);
        }
        if (!this.owner || !this.repository) {
            throw new Error(`Missing repository configuration\n\nThe GitHub backend requires 'owner' and 'repository' (or 'repo').`);
        }

        const cleanPath = apiPath.replace(/^\//, '');
        const url = cleanPath.length > 0 
            ? `https://api.github.com/repos/${this.owner}/${this.repository}/${cleanPath}`
            : `https://api.github.com/repos/${this.owner}/${this.repository}`;

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Testform-CLI'
        };

        if (options.body) {
            headers['Content-Type'] = 'application/json';
        }

        return await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
    }

    private async ensureBranchExists(): Promise<void> {
        const branchCheck = await this.apiRequest(`branches/${encodeURIComponent(this.branch)}`);
        if (branchCheck.ok) return;

        if (branchCheck.status === 404) {
            // Get repository default branch sha to branch off
            const repoRes = await this.apiRequest('');
            if (!repoRes.ok) {
                throw new Error(`GitHub Backend: Failed to inspect repository ${this.owner}/${this.repository}: HTTP ${repoRes.status}`);
            }
            const repoData: any = await repoRes.json();
            const defaultBranch = repoData.default_branch || 'main';

            let refRes = await this.apiRequest(`git/ref/heads/${encodeURIComponent(defaultBranch)}`);
            
            // If repository is completely empty (GitHub returns 409 "Git Repository is empty" or 404)
            if (refRes.status === 409 || refRes.status === 404) {
                const initRes = await this.apiRequest('contents/README.md', {
                    method: 'PUT',
                    body: {
                        message: 'Initialize Testform state repository',
                        content: Buffer.from('# Testform State Repository\n\nThis repository stores Testform remote state files.\n', 'utf-8').toString('base64'),
                    }
                });
                if (initRes.ok) {
                    refRes = await this.apiRequest(`git/ref/heads/${encodeURIComponent(defaultBranch)}`);
                }
            }

            if (!refRes.ok) {
                throw new Error(`GitHub Backend: Failed to get default branch ref "${defaultBranch}": HTTP ${refRes.status}. Make sure the repository exists and has at least an initial commit.`);
            }
            const refData: any = await refRes.json();
            const commitSha = refData.object?.sha;

            if (this.branch !== defaultBranch) {
                const createRefRes = await this.apiRequest('git/refs', {
                    method: 'POST',
                    body: {
                        ref: `refs/heads/${this.branch}`,
                        sha: commitSha
                    }
                });

                if (!createRefRes.ok && createRefRes.status !== 422) {
                    const errText = await createRefRes.text();
                    throw new Error(`GitHub Backend: Failed to create state branch "${this.branch}": HTTP ${createRefRes.status} - ${errText}`);
                }
            }
        }
    }

    async exists(): Promise<boolean> {
        try {
            const res = await this.apiRequest(`contents/${this.statePath}?ref=${encodeURIComponent(this.branch)}`);
            return res.ok;
        } catch {
            return false;
        }
    }

    async read(): Promise<IState> {
        const res = await this.apiRequest(`contents/${this.statePath}?ref=${encodeURIComponent(this.branch)}`);
        if (res.status === 404) {
            return {
                version: VERSION_STATE,
                serial: 0,
                lineage: randomUUID(),
                lastSync: '',
                resources: []
            };
        }

        if (!res.ok) {
            throw new Error(`GitHub Backend: Failed to read state: HTTP ${res.status} ${res.statusText}`);
        }

        const data: any = await res.json();
        this.currentSha = data.sha;
        const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
        return JSON.parse(decoded) as IState;
    }

    async write(state: IState): Promise<void> {
        await this.ensureBranchExists();

        if (!this.currentSha) {
            const check = await this.apiRequest(`contents/${this.statePath}?ref=${encodeURIComponent(this.branch)}`);
            if (check.ok) {
                const data: any = await check.json();
                this.currentSha = data.sha;
            }
        }

        const body: any = {
            message: `Update testform.state (serial: ${state.serial})`,
            content: Buffer.from(JSON.stringify(state, null, 2), 'utf-8').toString('base64'),
            branch: this.branch
        };
        if (this.currentSha) {
            body.sha = this.currentSha;
        }

        const res = await this.apiRequest(`contents/${this.statePath}`, {
            method: 'PUT',
            body
        });

        if (res.status === 409) {
            throw new Error(
                `GitHub Backend State Conflict: The state file in branch "${this.branch}" was modified concurrently. Re-run plan or refresh state.`
            );
        }

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`GitHub Backend: Failed to write state: HTTP ${res.status} - ${errText}`);
        }

        const result: any = await res.json();
        this.currentSha = result.content?.sha;
    }

    async lock(timeoutRaw: string, lockMeta?: { operation?: string; who?: string }): Promise<boolean> {
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const start = Date.now();
        const lockId = randomUUID();

        const defaultOp = process.argv[2] ? `OperationType${process.argv[2].charAt(0).toUpperCase() + process.argv[2].slice(1)}` : 'Operation';
        await this.ensureBranchExists();

        while (true) {
            const lockPayload = {
                id: lockId,
                operation: lockMeta?.operation || defaultOp,
                who: lockMeta?.who || getSystemUser(),
                created: new Date().toISOString()
            };

            const body = {
                message: `Acquire testform.state lock [${lockId}]`,
                content: Buffer.from(JSON.stringify(lockPayload, null, 2), 'utf-8').toString('base64'),
                branch: this.branch
            };

            const res = await this.apiRequest(`contents/${this.lockPath}`, {
                method: 'PUT',
                body
            });

            if (res.status === 201 || res.status === 200) {
                const data: any = await res.json();
                this.currentLockSha = data.content?.sha;
                this.currentLockId = lockId;
                return true;
            }

            if (res.status === 422 || res.status === 409) {
                if (Date.now() - start >= timeoutMs) {
                    throw new Error(
                        `Error acquiring the state lock: State lock file "${this.lockPath}" already exists on branch "${this.branch}".`
                    );
                }
                await new Promise(r => setTimeout(r, 1000));
            } else {
                const err = await res.text();
                throw new Error(`GitHub Backend: Error creating lock: HTTP ${res.status} - ${err}`);
            }
        }
    }

    async unlock(): Promise<boolean> {
        if (!this.currentLockSha) {
            const check = await this.apiRequest(`contents/${this.lockPath}?ref=${encodeURIComponent(this.branch)}`);
            if (check.status === 404) return true;
            if (check.ok) {
                const data: any = await check.json();
                this.currentLockSha = data.sha;
            } else {
                return false;
            }
        }

        const res = await this.apiRequest(`contents/${this.lockPath}`, {
            method: 'DELETE',
            body: {
                message: 'Release testform.state lock',
                sha: this.currentLockSha,
                branch: this.branch
            }
        });

        if (res.ok || res.status === 404) {
            this.currentLockSha = undefined;
            this.currentLockId = undefined;
            return true;
        }
        return false;
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        const check = await this.apiRequest(`contents/${this.lockPath}?ref=${encodeURIComponent(this.branch)}`);
        if (check.status === 404) {
            return { success: true };
        }
        if (!check.ok) {
            return { success: false, error: `Failed to check lock file: HTTP ${check.status}` };
        }

        const data: any = await check.json();
        const contentStr = Buffer.from(data.content, 'base64').toString('utf-8');
        try {
            const lockData = JSON.parse(contentStr);
            if (lockId && lockData.id && lockData.id !== lockId) {
                return {
                    success: false,
                    error: `Lock ID mismatch: expected ${lockId}, found ${lockData.id}`,
                    currentLockId: lockData.id
                };
            }
        } catch { }

        const del = await this.apiRequest(`contents/${this.lockPath}`, {
            method: 'DELETE',
            body: {
                message: `Force unlock testform.state [${lockId}]`,
                sha: data.sha,
                branch: this.branch
            }
        });

        return { success: del.ok || del.status === 404 };
    }

    async isLocked(): Promise<boolean> {
        const res = await this.apiRequest(`contents/${this.lockPath}?ref=${encodeURIComponent(this.branch)}`);
        return res.ok;
    }

    async listWorkspaces(): Promise<string[]> {
        const res = await this.apiRequest(`contents/env?ref=${encodeURIComponent(this.branch)}`);
        if (!res.ok) return [];
        const items = await res.json();
        if (!Array.isArray(items)) return [];
        return items.filter((item: any) => item.type === 'dir').map((item: any) => item.name);
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        const wsStatePath = `env/${name}/${this.config.path || FILE_STATE}`;
        const check = await this.apiRequest(`contents/${wsStatePath}?ref=${encodeURIComponent(this.branch)}`);
        if (check.status === 404) return true;
        if (!check.ok) return false;

        const data: any = await check.json();
        const res = await this.apiRequest(`contents/${wsStatePath}`, {
            method: 'DELETE',
            body: {
                message: `Delete workspace ${name} state`,
                sha: data.sha,
                branch: this.branch
            }
        });

        return res.ok;
    }
}
