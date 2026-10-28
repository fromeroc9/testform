import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { modulesCmd } from '../src/commands/modules';

describe('Command modulesCmd (testform modules)', () => {
    let tmpDir: string;
    let logged: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-modules-test-'));
        logged = [];
        console.log = vi.fn((...args: any[]) => {
            logged.push(args.map(a => String(a)).join(' '));
        });
    });

    afterEach(() => {
        console.log = originalLog;
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should inform when no modules are declared in configuration', async () => {
        await modulesCmd({ dir: tmpDir });
        const output = logged.join('\n');
        expect(output).toContain('No modules found in configuration.');
    });

    it('should output format_version 1.0 and null modules when no modules exist in json mode', async () => {
        await modulesCmd({ dir: tmpDir, isJson: true });
        const output = logged.join('\n');
        expect(output).toBe('{"format_version":"1.0","modules":null}');
    });

    it('should list declared modules in human-readable tree format matching Terraform', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
modules:
  auth_standard:
    source: "./modules/auth/login.case.feature"
    scenario: "@tc-login"
    vars:
      user: "admin"
      timeout: 5000
  remote_auth:
    source: "git::https://github.com/my-org/qa-modules.git//auth?ref=v1.2.0"
`);

        await modulesCmd({ dir: tmpDir });
        const output = logged.join('\n');
        expect(output).toContain('Modules declared by configuration:');
        expect(output).toContain('├── "auth_standard"[./modules/auth/login.case.feature]');
        expect(output).toContain('└── "remote_auth"[git::https://github.com/my-org/qa-modules.git//auth?ref=v1.2.0] v1.2.0');
    });

    it('should support module singular block in configuration', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
version: "1.0"
module:
  checkout:
    source: "./checkout"
    version: "2.1.0"
`);

        await modulesCmd({ dir: tmpDir });
        const output = logged.join('\n');
        expect(output).toContain('Modules declared by configuration:');
        expect(output).toContain('└── "checkout"[./checkout] 2.1.0');
    });

    it('should output modules list in valid JSON format matching Terraform schema with -json flag', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
modules:
  auth_staging:
    source: "./modules/auth/login.case.feature"
    vars:
      role: "viewer"
`);

        await modulesCmd({ dir: tmpDir, isJson: true });
        const output = logged.join('\n');
        const parsed = JSON.parse(output);

        expect(parsed.format_version).toBe('1.0');
        expect(parsed.modules).toBeDefined();
        expect(Array.isArray(parsed.modules)).toBe(true);
        expect(parsed.modules.length).toBe(1);
        expect(parsed.modules[0].key).toBe('auth_staging');
        expect(parsed.modules[0].source).toBe('./modules/auth/login.case.feature');
        expect(parsed.modules[0].version).toBe('');
    });
});
