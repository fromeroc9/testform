import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { providersCmd } from '../src/commands/providers';
import { getCommandHelp, HELP_PROVIDERS, HELP_PROVIDERS_LOCK, HELP_PROVIDERS_MIRROR, HELP_PROVIDERS_SCHEMA } from '../src/core/help';
import { TestformError } from '../src/core/errors';

describe('providers command', () => {
    let tempDir: string;
    let consoleLogSpy: any;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'testform-providers-test-'));
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    });

    it('fails with diagnostic error when directory contains no configuration files', async () => {
        await expect(providersCmd({ dir: tempDir })).rejects.toThrow('No configuration files');
    });

    it('prints provider requirements tree when configuration file is present', async () => {
        writeFileSync(join(tempDir, 'main.yml'), `
version: "1.0"
provider: local
resource:
  testcase:
    filename: testcase.case.feature
`);
        await providersCmd({ dir: tempDir });
        expect(consoleLogSpy).toHaveBeenCalled();
        const logs = consoleLogSpy.mock.calls.map((c: any) => c.join(' ')).join('\n');
        expect(logs).toContain('Providers required by configuration:');
        expect(logs).toContain('provider[registry.testform.io/fromeroc9/local] 1.0.0');
    });

    it('handles providers lock subcommand and writes lockfile', async () => {
        writeFileSync(join(tempDir, 'main.yml'), `
version: "1.0"
provider:
  github:
    owner: testowner
    repository: testrepo
`);
        await providersCmd({ dir: tempDir, action: 'lock' });
        const lockFilePath = join(tempDir, '.testform', 'cache', 'lock.json');
        expect(existsSync(lockFilePath)).toBe(true);
        const lockContent = readFileSync(lockFilePath, 'utf-8');
        expect(lockContent).toContain('registry.testform.io/fromeroc9/github');
    });

    it('handles providers mirror subcommand', async () => {
        writeFileSync(join(tempDir, 'main.yml'), `
version: "1.0"
provider: local
`);
        // Missing target directory
        await expect(providersCmd({ dir: tempDir, action: 'mirror', args: [] }))
            .rejects.toThrow('Missing target directory argument');

        // With target directory
        await providersCmd({ dir: tempDir, action: 'mirror', args: ['mirror-dir'] });
        expect(existsSync(join(tempDir, 'mirror-dir', 'local.json'))).toBe(true);
    });

    it('handles providers schema subcommand in human-readable and json formats', async () => {
        writeFileSync(join(tempDir, 'main.yml'), `
version: "1.0"
provider:
  github:
    owner: testowner
    repository: testrepo
`);
        // Human-readable format
        await providersCmd({ dir: tempDir, action: 'schema' });
        let logs = consoleLogSpy.mock.calls.map((c: any) => c.join(' ')).join('\n');
        expect(logs).toContain('Provider Schema: fromeroc9/github');
        expect(logs).toContain('Resource: github_testcase');

        // JSON format
        consoleLogSpy.mockClear();
        await providersCmd({ dir: tempDir, action: 'schema', isJson: true });
        logs = consoleLogSpy.mock.calls.map((c: any) => c.join(' ')).join('\n');
        const parsed = JSON.parse(logs);
        expect(parsed.format_version).toBe('1.0');
        expect(parsed.provider_schemas['registry.testform.io/fromeroc9/github']).toBeDefined();
        expect(parsed.provider_schemas['registry.testform.io/fromeroc9/github'].resource_schemas['github_testcase']).toBeDefined();
    });

    it('returns proper subcommand help texts', () => {
        expect(getCommandHelp('providers')).toBe(HELP_PROVIDERS);
        expect(getCommandHelp('providers lock')).toBe(HELP_PROVIDERS_LOCK);
        expect(getCommandHelp('providers mirror')).toBe(HELP_PROVIDERS_MIRROR);
        expect(getCommandHelp('providers schema')).toBe(HELP_PROVIDERS_SCHEMA);
    });
});
