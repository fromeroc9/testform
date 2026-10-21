import { describe, it, expect } from 'vitest';
import { loadDriver, ALLOWED_DRIVERS, isDriverAvailable, ensureDriverInstalled } from '../../src/core/driver';

describe('Dynamic Driver Loader', () => {
    it('should reject packages not in the whitelist', () => {
        expect(() => {
            loadDriver('some-arbitrary-package');
        }).toThrow(/not a recognized cloud driver/);
    });

    it('should load a whitelisted driver from local node_modules', () => {
        const s3 = loadDriver('@aws-sdk/client-s3');
        expect(s3).toBeDefined();
        expect(s3.S3Client).toBeDefined();
    });

    it('should return from in-memory cache on subsequent calls instantly', () => {
        const first = loadDriver('@aws-sdk/client-s3');
        const second = loadDriver('@aws-sdk/client-s3');
        expect(first).toBe(second);
    });

    it('should expose the whitelist with descriptions', () => {
        expect(ALLOWED_DRIVERS['@aws-sdk/client-s3']).toContain('S3');
        expect(ALLOWED_DRIVERS['@azure/storage-blob']).toContain('Azure');
        expect(ALLOWED_DRIVERS['@google-cloud/storage']).toContain('Google');
    });

    it('should check if driver is available with isDriverAvailable', () => {
        expect(isDriverAvailable('@aws-sdk/client-s3')).toBe(true);
        expect(isDriverAvailable('non-existent-package')).toBe(false);
    });

    it('should ensure driver installed returns true if already available', () => {
        expect(ensureDriverInstalled('@aws-sdk/client-s3')).toBe(true);
    });
});
