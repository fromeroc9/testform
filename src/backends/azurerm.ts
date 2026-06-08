import { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';
import { randomUUID } from 'crypto';
import { IBackend } from './backend';
import { IState } from '../core/types';
import { VERSION_STATE, FILE_STATE } from '../core/const';

export interface AzureRMBackendConfig {
    resource_group_name: string;
    storage_account_name: string;
    container_name: string;
    key?: string;
    // Assume auth happens via env variables like AZURE_STORAGE_CONNECTION_STRING
    // or Azure DefaultAzureCredential. For simplicity, we assume the connection string is provided.
    connection_string?: string;
}

export class AzureRMBackend implements IBackend {
    private containerClient: ContainerClient;
    private blobClient: BlockBlobClient;
    private currentLeaseId?: string;
    private originalKey: string;

    constructor(private config: AzureRMBackendConfig, private workspace: string = 'default') {
        const connectionString = config.connection_string || process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (!connectionString) {
            const error = new Error("AZURE_STORAGE_CONNECTION_STRING env variable is missing");
            error.name = 'AzureRM Backend Configuration Error';
            throw error;
        }

        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        this.containerClient = blobServiceClient.getContainerClient(config.container_name);

        this.config.key = this.config.key || FILE_STATE;
        this.originalKey = this.config.key;
        if (this.workspace !== 'default') {
            this.config.key = `env:/${this.workspace}/${this.originalKey}`;
        }

        this.blobClient = this.containerClient.getBlockBlobClient(this.config.key);
    }

    async exists(): Promise<boolean> {
        try {
            return await this.blobClient.exists();
        } catch (e: any) {
            return false;
        }
    }

    async read(): Promise<IState> {
        try {
            await this.containerClient.createIfNotExists();
            const exists = await this.blobClient.exists();
            if (!exists) {
                return this.emptyState();
            }

            const response = await this.blobClient.download(0);
            const raw = await this.streamToString(response.readableStreamBody as NodeJS.ReadableStream);
            return JSON.parse(raw) as IState;
        } catch (err) {
            return this.emptyState();
        }
    }

    async write(state: IState): Promise<void> {
        await this.containerClient.createIfNotExists();
        const content = JSON.stringify(state, null, 2);

        const options: any = { blobHTTPHeaders: { blobContentType: 'application/json' } };
        if (this.currentLeaseId) {
            options.conditions = { leaseId: this.currentLeaseId };
        }

        await this.blobClient.upload(content, content.length, options);
    }

    async lock(timeoutRaw: string): Promise<boolean> {
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const start = Date.now();

        // Ensure blob exists before leasing
        const exists = await this.blobClient.exists();
        if (!exists) {
            await this.write(this.emptyState());
        }

        const leaseClient = this.blobClient.getBlobLeaseClient();

        while (true) {
            try {
                // -1 means infinite lease
                const response = await leaseClient.acquireLease(-1);
                this.currentLeaseId = response.leaseId;

                // Write lock metadata
                try {
                    await this.blobClient.setMetadata({
                        id: randomUUID(),
                        operation: 'Operation',
                        who: process.env.USER || 'unknown',
                        created: new Date().toISOString()
                    }, { conditions: { leaseId: this.currentLeaseId } });
                } catch (metaErr: any) {
                    // Floci emulator bug workaround: it returns 201 Created instead of 200 OK
                    // for setMetadata, which crashes the strict Azure SDK.
                    if (metaErr.statusCode !== 201) {
                        throw metaErr;
                    }
                }

                return true;
            } catch (err: any) {
                if (err.statusCode === 409 || err.code === 'LeaseAlreadyPresent') {
                    if (Date.now() - start >= timeoutMs) {
                        return false;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    throw err;
                }
            }
        }
    }

    async unlock(): Promise<boolean> {
        if (!this.currentLeaseId) return true;

        try {
            const leaseClient = this.blobClient.getBlobLeaseClient(this.currentLeaseId);
            await leaseClient.releaseLease();
            this.currentLeaseId = undefined;
            return true;
        } catch (e) {
            return false;
        }
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        try {
            const props = await this.blobClient.getProperties();
            const currentLockId = props.metadata?.id;

            if (props.leaseState === 'available') {
                return { success: false, error: 'No lock exists for the given state.' };
            }

            if (currentLockId !== lockId) {
                return { success: false, currentLockId: currentLockId || 'unknown' };
            }

            // Break the lease
            const leaseClient = this.blobClient.getBlobLeaseClient();
            await leaseClient.breakLease(0);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: `Failed to force unlock: ${err.message}` };
        }
    }

    async isLocked(): Promise<boolean> {
        try {
            const props = await this.blobClient.getProperties();
            return props.leaseState !== 'available';
        } catch (e) {
            return false;
        }
    }

    private emptyState(): IState {
        return {
            version: VERSION_STATE,
            serial: 0,
            lineage: randomUUID(),
            lastSync: '',
            resources: [],
        };
    }

    private async streamToString(readableStream: NodeJS.ReadableStream): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: any[] = [];
            readableStream.on("data", (data) => {
                chunks.push(data.toString());
            });
            readableStream.on("end", () => {
                resolve(chunks.join(""));
            });
            readableStream.on("error", reject);
        });
    }

    async listWorkspaces(): Promise<string[]> {
        const workspaces = new Set<string>(['default']);
        try {
            for await (const blob of this.containerClient.listBlobsFlat({ prefix: 'env:/' })) {
                const match = blob.name.match(/^env:\/([^\/]+)\//);
                if (match) {
                    workspaces.add(match[1]);
                }
            }
        } catch (e) {
            // fallback
        }
        return Array.from(workspaces);
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        if (name === 'default') return false;
        try {
            const targetKey = `env:/${name}/${this.originalKey}`;
            const targetClient = this.containerClient.getBlockBlobClient(targetKey);
            await targetClient.deleteIfExists();
            return true;
        } catch (e) {
            return false;
        }
    }
}
