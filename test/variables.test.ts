import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VariableParser } from '../src/core/variables';

describe('VariableParser 5-Tier Priority Hierarchy', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'tf-vars-test-'));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should load Nivel 0 (Monolito Base testform.yml)', () => {
        writeFileSync(join(tmpDir, 'testform.yml'), `
vars:
  app_url:
    default: "https://base.local"
  env: "dev"
local:
  api: "\${var.app_url}/api"
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        expect(parser.getVars().app_url).toBe('https://base.local');
        expect(parser.getVars().env).toBe('dev');
        expect(parser.getLocals().api).toBe('https://base.local/api');
    });

    it('should override Nivel 0 with Nivel 1 (vars.yml / local.yml)', () => {
        writeFileSync(join(tmpDir, 'testform.yml'), `
vars:
  app_url:
    default: "https://base.local"
  timeout: 5000
local:
  api: "\${var.app_url}/v0"
`);

        writeFileSync(join(tmpDir, 'vars.yml'), `
vars:
  timeout: 8000
  new_var: "hello"
`);

        writeFileSync(join(tmpDir, 'local.yml'), `
local:
  api: "\${var.app_url}/v1"
  extra_local: "extra"
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        // app_url retained from Nivel 0
        expect(parser.getVars().app_url).toBe('https://base.local');
        // timeout overridden by Nivel 1
        expect(parser.getVars().timeout).toBe('8000');
        expect(parser.getVars().new_var).toBe('hello');
        // local.api overridden by Nivel 1
        expect(parser.getLocals().api).toBe('https://base.local/v1');
        expect(parser.getLocals().extra_local).toBe('extra');
    });

    it('should override Nivel 0 & 1 with Nivel 2 (Funcionalidad / Dominio auth.yml, checkout.yml)', () => {
        writeFileSync(join(tmpDir, 'testform.yml'), `
vars:
  app_url:
    default: "https://base.local"
  timeout: 5000
local:
  auth_endpoint: "\${var.app_url}/auth"
`);

        writeFileSync(join(tmpDir, 'vars.yml'), `
vars:
  timeout: 8000
`);

        // Create domain folder and file: auth/auth.yml
        const authDir = join(tmpDir, 'auth');
        mkdirSync(authDir);
        writeFileSync(join(authDir, 'auth.yml'), `
vars:
  timeout: 12000
  auth_retries: 3
local:
  auth_endpoint: "\${var.app_url}/custom-auth/login"
  auth_cookie: "session_token"
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        // app_url retained from Nivel 0
        expect(parser.getVars().app_url).toBe('https://base.local');
        // timeout overridden by Nivel 2 domain file (12000 beats 8000 and 5000)
        expect(parser.getVars().timeout).toBe('12000');
        expect(parser.getVars().auth_retries).toBe('3');
        // local.auth_endpoint overridden by Nivel 2
        expect(parser.getLocals().auth_endpoint).toBe('https://base.local/custom-auth/login');
        expect(parser.getLocals().auth_cookie).toBe('session_token');
    });

    it('should override Nivel 0, 1, 2 with Nivel 4 (-var-file) and Nivel 5 (-var)', () => {
        writeFileSync(join(tmpDir, 'testform.yml'), `
vars:
  app_url:
    default: "https://base.local"
  timeout: 5000
  env: "dev"
`);

        // Nivel 2 domain file
        writeFileSync(join(tmpDir, 'checkout.yml'), `
vars:
  timeout: 10000
  env: "qa"
`);

        // Nivel 4: var file passed via -var-file
        const varFile = join(tmpDir, 'staging.yml');
        writeFileSync(varFile, `
vars:
  timeout: 15000
  env: "staging"
`);

        // Nivel 5: -var CLI flag (env=production)
        const parser = new VariableParser(
            ['env=production'], // Nivel 5
            [varFile],          // Nivel 4
            tmpDir
        );

        // timeout is taken from Nivel 4 (-var-file) over Nivel 2 and Nivel 0
        expect(parser.getVars().timeout).toBe('15000');
        // env is taken from Nivel 5 (-var CLI flag) over Nivel 4, 2, 0
        expect(parser.getVars().env).toBe('production');
        // app_url retained from Nivel 0
        expect(parser.getVars().app_url).toBe('https://base.local');
    });

    it('should evaluate multi-pass nested local expressions and template interpolation', () => {
        writeFileSync(join(tmpDir, 'testform.yml'), `
vars:
  host: "api.midominio.com"
local:
  base: "https://\${var.host}"
  v1: "\${local.base}/v1"
  users_url: "\${local.v1}/users"
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        expect(parser.getLocals().base).toBe('https://api.midominio.com');
        expect(parser.getLocals().v1).toBe('https://api.midominio.com/v1');
        expect(parser.getLocals().users_url).toBe('https://api.midominio.com/v1/users');

        const templated = parser.applyToTemplate('GET \${local.users_url}?env=\${var.host}');
        expect(templated).toBe('GET https://api.midominio.com/v1/users?env=api.midominio.com');
    });
});
