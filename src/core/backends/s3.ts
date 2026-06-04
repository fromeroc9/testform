import {
    S3Client,
    GetObjectCommand, HeadObjectCommand,
    PutObjectCommand,
    NoSuchKey
} from '@aws-sdk/client-s3';
import {
    DynamoDBClient,
    PutItemCommand,
    DeleteItemCommand,
    GetItemCommand,
    ConditionalCheckFailedException
} from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { IBackend } from './backend';
import { IState } from '../../types';
import { VERSION_STATE, FILE_STATE } from '../../const';

export interface S3BackendConfig {
    bucket: string;
    key?: string;
    region?: string;
    dynamodb_table?: string;
    profile?: string;
}

export class S3Backend implements IBackend {
    private s3: S3Client;
    private dynamo?: DynamoDBClient;
    private originalKey: string;

    constructor(private config: S3BackendConfig, private workspace: string = 'default') {
        const clientConfig: any = { region: config.region || process.env.AWS_REGION || 'us-east-1' };
        
        if (config.profile === 'local') {
            clientConfig.endpoint = config.region && config.region.startsWith('http') ? config.region : 'http://localhost:4566';
            clientConfig.region = process.env.AWS_REGION || 'us-east-1';
            clientConfig.forcePathStyle = true;
            clientConfig.credentials = {
                accessKeyId: 'test',
                secretAccessKey: 'test'
            };
        }
        
        // Profiles are usually handled by the SDK automatically if AWS_PROFILE is set,
        // or through credential providers, but for simplicity we rely on the default provider chain.
        this.s3 = new S3Client(clientConfig);
        
        if (config.dynamodb_table) {
            this.dynamo = new DynamoDBClient(clientConfig);
        }

        this.config.key = this.config.key || FILE_STATE;
        this.originalKey = this.config.key;
        if (this.workspace !== 'default') {
            this.config.key = `env:/${this.workspace}/${this.originalKey}`;
        }
    }

    async exists(): Promise<boolean> {
        try {
            await this.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.config.key }));
            return true;
        } catch (e: any) {
            return false;
        }
    }

    async read(): Promise<IState> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.config.bucket,
                Key: this.config.key,
            });
            const response = await this.s3.send(command);
            const raw = await response.Body?.transformToString();
            
            if (!raw) {
                return this.emptyState();
            }
            return JSON.parse(raw) as IState;
        } catch (err: any) {
            if (err instanceof NoSuchKey || err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') {
                return this.emptyState();
            }
            throw err;
        }
    }

    async write(state: IState): Promise<void> {
        const command = new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: this.config.key,
            Body: JSON.stringify(state, null, 2),
            ContentType: 'application/json',
        });
        await this.s3.send(command);
    }

    async lock(timeoutRaw: string): Promise<boolean> {
        if (!this.dynamo || !this.config.dynamodb_table) {
            // If no dynamodb table is configured, locking is bypassed (or purely optimistic).
            return true;
        }

        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const start = Date.now();
        const lockId = randomUUID();

        const item = {
            LockID: { S: this.config.bucket + '/' + this.config.key },
            Info: { S: JSON.stringify({
                id: lockId,
                operation: 'Operation',
                who: process.env.USER || 'unknown',
                created: new Date().toISOString()
            })}
        };

        while (true) {
            try {
                // Try to acquire lock
                await this.dynamo.send(new PutItemCommand({
                    TableName: this.config.dynamodb_table,
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(LockID)'
                }));
                return true;
            } catch (err: any) {
                if (err instanceof ConditionalCheckFailedException || err.name === 'ConditionalCheckFailedException') {
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
        if (!this.dynamo || !this.config.dynamodb_table) return true;

        try {
            await this.dynamo.send(new DeleteItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));
            return true;
        } catch (e) {
            return false;
        }
    }

    async forceUnlock(lockId: string): Promise<{ success: boolean; error?: string; currentLockId?: string }> {
        if (!this.dynamo || !this.config.dynamodb_table) {
            return { success: false, error: 'DynamoDB locking is not configured for this backend.' };
        }

        try {
            const response = await this.dynamo.send(new GetItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));

            if (!response.Item || !response.Item.Info) {
                return { success: false, error: 'No lock exists for the given state.' };
            }

            const info = JSON.parse(response.Item.Info.S!);
            if (info.id !== lockId) {
                return { success: false, currentLockId: info.id };
            }

            await this.dynamo.send(new DeleteItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));
            return { success: true };
        } catch (e: any) {
            return { success: false, error: `Failed to force unlock: ${e.message}` };
        }
    }

    async isLocked(): Promise<boolean> {
        if (!this.dynamo || !this.config.dynamodb_table) return false;

        try {
            const response = await this.dynamo.send(new GetItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));
            return !!response.Item;
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

    async listWorkspaces(): Promise<string[]> {
        const workspaces = new Set<string>(['default']);
        try {
            const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
            const command = new ListObjectsV2Command({
                Bucket: this.config.bucket,
                Prefix: 'env:/'
            });
            const response = await this.s3.send(command);
            if (response.Contents) {
                for (const item of response.Contents) {
                    if (item.Key) {
                        const match = item.Key.match(/^env:\/([^\/]+)\//);
                        if (match) {
                            workspaces.add(match[1]);
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore error and just return what we have (fallback to local knowledge basically)
        }
        return Array.from(workspaces);
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        if (name === 'default') return false;
        try {
            const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
            const targetKey = `env:/${name}/${this.originalKey}`;
            
            const command = new DeleteObjectCommand({
                Bucket: this.config.bucket,
                Key: targetKey
            });
            await this.s3.send(command);
            return true;
        } catch (e) {
            return false;
        }
    }
}
