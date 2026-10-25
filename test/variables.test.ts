import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VariableParser } from '../src/core/variables';

describe('VariableParser Hierarchy, Auto-load *.vars.yml and AST Engine', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'tf-vars-test-'));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should load Base main.yml with variable: and locals: blocks', () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
variable:
  app_url:
    default: "https://base.local"
  env: "dev"
locals:
  api: "\${var.app_url}/api"
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        expect(parser.getVars().app_url).toBe('https://base.local');
        expect(parser.getVars().env).toBe('dev');
        expect(parser.getLocals().api).toBe('https://base.local/api');
    });

    it('should override base with variables.yml and locals.yml', () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
variable:
  app_url:
    default: "https://base.local"
  timeout: 5000
locals:
  api: "\${var.app_url}/v0"
`);

        writeFileSync(join(tmpDir, 'variables.yml'), `
variable:
  timeout: 8000
  new_var: "hello"
`);

        writeFileSync(join(tmpDir, 'locals.yml'), `
locals:
  api: "\${var.app_url}/v1"
  extra_local: "extra"
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        expect(parser.getVars().app_url).toBe('https://base.local');
        expect(parser.getVars().timeout).toBe('8000');
        expect(parser.getVars().new_var).toBe('hello');
        expect(parser.getLocals().api).toBe('https://base.local/v1');
        expect(parser.getLocals().extra_local).toBe('extra');
    });

    it('should auto-load *.vars.yml files automatically in workspace', () => {
        writeFileSync(join(tmpDir, 'variables.yml'), `
variable:
  environment:
    default: "dev"
  concurrency:
    default: 10
`);

        // testform.vars.yml auto-loaded!
        writeFileSync(join(tmpDir, 'testform.vars.yml'), `
environment: "staging"
concurrency: 25
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        expect(parser.getVars().environment).toBe('staging');
        expect(parser.getVars().concurrency).toBe('25');
    });

    it('should allow -var-file to override auto-loaded *.vars.yml, and -var to override -var-file', () => {
        writeFileSync(join(tmpDir, 'variables.yml'), `
variable:
  environment:
    default: "dev"
  timeout: 5000
`);

        // Auto-loaded *.vars.yml
        writeFileSync(join(tmpDir, 'default.vars.yml'), `
environment: "staging"
timeout: 8000
`);

        // Explicit -var-file
        const prodVarFile = join(tmpDir, 'prod.vars.yml');
        writeFileSync(prodVarFile, `
environment: "prod"
timeout: 15000
`);

        // CLI: -var-file=prod.vars.yml and -var="timeout=20000"
        const parser = new VariableParser(
            ['timeout=20000'],
            [prodVarFile],
            tmpDir
        );

        expect(parser.getVars().environment).toBe('prod');
        expect(parser.getVars().timeout).toBe('20000');
    });

    it('should evaluate AST functions in locals (lower, format, replace)', () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
variable:
  host: "api.miempresa.com"
  env_raw: "STAGING"
locals:
  env: "\${lower(var.env_raw)}"
  full_url: "\${format('https://%s.%s/v1', local.env, var.host)}"
`);

        const parser = new VariableParser(undefined, undefined, tmpDir);
        expect(parser.getLocals().env).toBe('staging');
        expect(parser.getLocals().full_url).toBe('https://staging.api.miempresa.com/v1');
    });

    it('should validate enum restriction on variable declaration', () => {
        writeFileSync(join(tmpDir, 'variables.yml'), `
variable:
  environment:
    type: string
    default: "staging"
    enum: ["dev", "staging", "prod"]
`);

        // Passing default "staging" should succeed
        const validParser = new VariableParser(undefined, undefined, tmpDir);
        expect(validParser.getVars().environment).toBe('staging');

        // Invalid value provided via CLI should throw Error with enum details
        expect(() => {
            new VariableParser(['environment=qa'], undefined, tmpDir);
        }).toThrow(/Variable enum validation error/);
    });

    it('should evaluate custom validation condition and throw error_message when condition fails', () => {
        writeFileSync(join(tmpDir, 'variables.yml'), `
variable:
  image_tag:
    type: string
    default: "v1.2.0"
    validation:
      condition: "\${startswith(var.image_tag, 'v')}"
      error_message: "The image_tag value must start with 'v'."
`);

        // Valid default "v1.2.0" should succeed
        const validParser = new VariableParser(undefined, undefined, tmpDir);
        expect(validParser.getVars().image_tag).toBe('v1.2.0');

        // Invalid value without 'v' prefix should throw error_message
        expect(() => {
            new VariableParser(['image_tag=latest'], undefined, tmpDir);
        }).toThrow(/The image_tag value must start with 'v'/);
    });
});
