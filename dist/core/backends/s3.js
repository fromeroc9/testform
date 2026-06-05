"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3Backend = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const crypto_1 = require("crypto");
const const_1 = require("../../const");
class S3Backend {
    config;
    workspace;
    s3;
    dynamo;
    originalKey;
    constructor(config, workspace = 'default') {
        this.config = config;
        this.workspace = workspace;
        const clientConfig = { region: config.region || process.env.AWS_REGION || 'us-east-1' };
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
        this.s3 = new client_s3_1.S3Client(clientConfig);
        if (config.dynamodb_table) {
            this.dynamo = new client_dynamodb_1.DynamoDBClient(clientConfig);
        }
        this.config.key = this.config.key || const_1.FILE_STATE;
        this.originalKey = this.config.key;
        if (this.workspace !== 'default') {
            this.config.key = `env:/${this.workspace}/${this.originalKey}`;
        }
    }
    async exists() {
        try {
            await this.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: this.config.bucket, Key: this.config.key }));
            return true;
        }
        catch (e) {
            return false;
        }
    }
    async read() {
        try {
            const command = new client_s3_1.GetObjectCommand({
                Bucket: this.config.bucket,
                Key: this.config.key,
            });
            const response = await this.s3.send(command);
            const raw = await response.Body?.transformToString();
            if (!raw) {
                return this.emptyState();
            }
            return JSON.parse(raw);
        }
        catch (err) {
            if (err instanceof client_s3_1.NoSuchKey || err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') {
                return this.emptyState();
            }
            throw err;
        }
    }
    async write(state) {
        const command = new client_s3_1.PutObjectCommand({
            Bucket: this.config.bucket,
            Key: this.config.key,
            Body: JSON.stringify(state, null, 2),
            ContentType: 'application/json',
        });
        await this.s3.send(command);
    }
    async lock(timeoutRaw) {
        if (!this.dynamo || !this.config.dynamodb_table) {
            // If no dynamodb table is configured, locking is bypassed (or purely optimistic).
            return true;
        }
        const timeoutMatch = timeoutRaw.match(/^(\d+)s$/);
        const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : 0;
        const start = Date.now();
        const lockId = (0, crypto_1.randomUUID)();
        const item = {
            LockID: { S: this.config.bucket + '/' + this.config.key },
            Info: { S: JSON.stringify({
                    id: lockId,
                    operation: 'Operation',
                    who: process.env.USER || 'unknown',
                    created: new Date().toISOString()
                }) }
        };
        while (true) {
            try {
                // Try to acquire lock
                await this.dynamo.send(new client_dynamodb_1.PutItemCommand({
                    TableName: this.config.dynamodb_table,
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(LockID)'
                }));
                return true;
            }
            catch (err) {
                if (err instanceof client_dynamodb_1.ConditionalCheckFailedException || err.name === 'ConditionalCheckFailedException') {
                    if (Date.now() - start >= timeoutMs) {
                        return false;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
                else {
                    throw err;
                }
            }
        }
    }
    async unlock() {
        if (!this.dynamo || !this.config.dynamodb_table)
            return true;
        try {
            await this.dynamo.send(new client_dynamodb_1.DeleteItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));
            return true;
        }
        catch (e) {
            return false;
        }
    }
    async forceUnlock(lockId) {
        if (!this.dynamo || !this.config.dynamodb_table) {
            return { success: false, error: 'DynamoDB locking is not configured for this backend.' };
        }
        try {
            const response = await this.dynamo.send(new client_dynamodb_1.GetItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));
            if (!response.Item || !response.Item.Info) {
                return { success: false, error: 'No lock exists for the given state.' };
            }
            const info = JSON.parse(response.Item.Info.S);
            if (info.id !== lockId) {
                return { success: false, currentLockId: info.id };
            }
            await this.dynamo.send(new client_dynamodb_1.DeleteItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));
            return { success: true };
        }
        catch (e) {
            return { success: false, error: `Failed to force unlock: ${e.message}` };
        }
    }
    async isLocked() {
        if (!this.dynamo || !this.config.dynamodb_table)
            return false;
        try {
            const response = await this.dynamo.send(new client_dynamodb_1.GetItemCommand({
                TableName: this.config.dynamodb_table,
                Key: { LockID: { S: this.config.bucket + '/' + this.config.key } }
            }));
            return !!response.Item;
        }
        catch (e) {
            return false;
        }
    }
    emptyState() {
        return {
            version: const_1.VERSION_STATE,
            serial: 0,
            lineage: (0, crypto_1.randomUUID)(),
            lastSync: '',
            resources: [],
        };
    }
    async listWorkspaces() {
        const workspaces = new Set(['default']);
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
        }
        catch (e) {
            // Ignore error and just return what we have (fallback to local knowledge basically)
        }
        return Array.from(workspaces);
    }
    async deleteWorkspace(name) {
        if (name === 'default')
            return false;
        try {
            const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
            const targetKey = `env:/${name}/${this.originalKey}`;
            const command = new DeleteObjectCommand({
                Bucket: this.config.bucket,
                Key: targetKey
            });
            await this.s3.send(command);
            return true;
        }
        catch (e) {
            return false;
        }
    }
}
exports.S3Backend = S3Backend;
