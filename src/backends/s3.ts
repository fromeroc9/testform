import type { S3Client as S3ClientType } from '@aws-sdk/client-s3';
import type { DynamoDBClient as DynamoDBClientType } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { IBackend } from './backend';
import { IState } from '../core/types';
import { VERSION_STATE, FILE_STATE } from '../core/const';
import { loadDriver } from '../core/driver';

function getAwsS3(): any {
    return loadDriver('@aws-sdk/client-s3');
}

function getAwsDynamo(): any {
    return loadDriver('@aws-sdk/client-dynamodb');
}

export interface S3BackendConfig {
    bucket: string;
    key?: string;
    region?: string;
    dynamodb_table?: string;
    profile?: string;
    endpoint?: string;
    namespace?: string;
    forcePathStyle?: boolean;
}

export class S3Backend implements IBackend {
    private s3: S3ClientType;
    private dynamo?: DynamoDBClientType;
    private originalKey: string;

    constructor(private config: S3BackendConfig, private workspace: string = 'default') {
        const { S3Client } = getAwsS3();
        const clientConfig: any = { region: config.region || process.env.AWS_REGION || 'us-east-1' };
        
        let endpoint = config.endpoint;
        // Option A: Auto-construct OCI endpoint if namespace is provided
        if (!endpoint && config.namespace) {
            const reg = config.region || process.env.AWS_REGION || 'us-ashburn-1';
            endpoint = `https://${config.namespace}.compat.objectstorage.${reg}.oraclecloud.com`;
        }

        // Option B: If explicit endpoint is provided, use it
        if (endpoint) {
            clientConfig.endpoint = endpoint;
            // OCI Object Storage and custom S3 endpoints require path-style addressing!
            clientConfig.forcePathStyle = config.forcePathStyle ?? true;
        }

        if (config.forcePathStyle !== undefined) {
            clientConfig.forcePathStyle = config.forcePathStyle;
        }

        if (config.profile === 'local') {
            clientConfig.endpoint = config.region && config.region.startsWith('http') ? config.region : 'http://localhost:4566';
            clientConfig.region = process.env.AWS_REGION || 'us-east-1';
            clientConfig.forcePathStyle = true;
            clientConfig.credentials = {
                accessKeyId: 'test',
                secretAccessKey: 'test'
            };
        }
        
        this.s3 = new S3Client(clientConfig);
        
        if (config.dynamodb_table) {
            const { DynamoDBClient } = getAwsDynamo();
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
            const { HeadObjectCommand } = getAwsS3();
            await this.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.config.key }));
            return true;
        } catch (e: any) {
            return false;
        }
    }

    async read(): Promise<IState> {
        const { GetObjectCommand, NoSuchKey } = getAwsS3();
        try {
            const command = new GetObjectCommand({
                Bucket: this.config.bucket,
                Key: this.config.key,
            });
            const response: any = await this.s3.send(command);
            const raw = await response.Body?.transformToString();
            
            if (!raw) {
                return this.emptyState();
            }
            return JSON.parse(raw) as IState;
        } catch (err: any) {
            if (NoSuchKey && (err instanceof NoSuchKey || err.name === 'NoSuchKey' || err.Code === 'NoSuchKey')) {
                return this.emptyState();
            }
            if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') {
                return this.emptyState();
            }
            throw err;
        }
    }

    async write(state: IState): Promise<void> {
        const { PutObjectCommand } = getAwsS3();
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
            return true;
        }

        const { PutItemCommand, ConditionalCheckFailedException } = getAwsDynamo();
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
                await this.dynamo.send(new PutItemCommand({
                    TableName: this.config.dynamodb_table,
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(LockID)'
                }));
                return true;
            } catch (err: any) {
                const isConflict = (ConditionalCheckFailedException && err instanceof ConditionalCheckFailedException) || err.name === 'ConditionalCheckFailedException';
                if (isConflict) {
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

        const { DeleteItemCommand } = getAwsDynamo();
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

        const { GetItemCommand, DeleteItemCommand } = getAwsDynamo();
        try {
            const response: any = await this.dynamo.send(new GetItemCommand({
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

        const { GetItemCommand } = getAwsDynamo();
        try {
            const response: any = await this.dynamo.send(new GetItemCommand({
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
            const { ListObjectsV2Command } = getAwsS3();
            const command = new ListObjectsV2Command({
                Bucket: this.config.bucket,
                Prefix: 'env:/'
            });
            const response: any = await this.s3.send(command);
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
            // Ignore error and just return what we have
        }
        return Array.from(workspaces);
    }

    async deleteWorkspace(name: string): Promise<boolean> {
        if (name === 'default') return false;
        try {
            const { DeleteObjectCommand } = getAwsS3();
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
