/**
 * @fileoverview Custom domain errors for Testform.
 *
 * Replacing hardcoded process.exit(1) in core classes with typed errors
 * allows for proper error handling, cleanup in try/finally blocks,
 * and robust unit testing without needing process.exit mocks.
 */

export class TestformError extends Error {
    public readonly exitCode: number;

    constructor(message: string, exitCode: number = 1) {
        super(message);
        this.name = 'TestformError';
        this.exitCode = exitCode;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class ConfigurationError extends TestformError {
    constructor(message: string) {
        super(message, 1);
        this.name = 'ConfigurationError';
    }
}

export class StateLockError extends TestformError {
    constructor(message: string) {
        super(message, 1);
        this.name = 'StateLockError';
    }
}
