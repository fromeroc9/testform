import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { OutputResolver } from '../src/core/outputs';
import { State } from '../src/core/state';
import { VariableParser } from '../src/core/variables';
import { outputCmd } from '../src/commands/output';

describe('Output System (Phase 1)', () => {
    const testDir = resolve(__dirname, 'tmp-output-test');

    beforeEach(() => {
        rmSync(testDir, { recursive: true, force: true });
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should parse output declarations from testform.yml and outputs.yml', () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

variable:
  environment:
    default: "staging"

outputs:
  active_env:
    description: "Ambiente activo"
    value: "\${var.environment}"
  static_val: "literal-value"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const outputsYml = `
outputs:
  extra_output:
    value: "from-outputs-yml"
`;
        writeFileSync(resolve(testDir, 'outputs.yml'), outputsYml);

        const resolver = new OutputResolver(testDir);
        const decls = resolver.getDeclarations();

        expect(decls['active_env']).toBeDefined();
        expect(decls['active_env'].value).toBe('${var.environment}');
        expect(decls['active_env'].description).toBe('Ambiente activo');
        expect(decls['static_val'].value).toBe('literal-value');
        expect(decls['extra_output'].value).toBe('from-outputs-yml');
    });

    it('should resolve variable and resource attribute outputs against state', async () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

variable:
  environment:
    default: "prod"

locals:
  tag_env: "@env-\${var.environment}"

outputs:
  env: "\${var.environment}"
  tag: "\${local.tag_env}"
  smoke_id: "\${testrun.suites/smoke.run.feature.@tr-1.remoteId}"
  smoke_issue: "\${testrun.suites/smoke.run.feature.@tr-1.issueNumber}"
  login_title: "\${testcase.auth/login.case.feature.@tc-1.title}"
  composite: "Run ID: \${testrun.suites/smoke.run.feature.@tr-1.remoteId} in \${var.environment}"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const state = new State(testDir);
        await state.init();

        state.upsertResource({
            type: 'github_testrun',
            identity: 'suites/smoke.run.feature.@tr-1',
            attributes: {
                localHash: 'hash1',
                remoteId: 'local:7',
                issueNumber: 42,
                title: 'Suite de Smoke Tests',
                labels: ['testrun', 'smoke'],
            },
            lastApplied: new Date().toISOString()
        });

        state.upsertResource({
            type: 'github_testcase',
            identity: 'auth/login.case.feature.@tc-1',
            attributes: {
                localHash: 'hash2',
                remoteId: 'local:1',
                issueNumber: 10,
                title: 'Inicio de sesión exitoso',
                labels: ['testcase', 'auth']
            },
            lastApplied: new Date().toISOString()
        });

        const vars = new VariableParser(undefined, undefined, testDir);
        const resolver = new OutputResolver(testDir);
        const resolved = resolver.resolve(state, vars);

        expect(resolved['env'].value).toBe('prod');
        expect(resolved['tag'].value).toBe('@env-prod');
        expect(resolved['smoke_id'].value).toBe('local:7');
        expect(resolved['smoke_issue'].value).toBe(42);
        expect(resolved['login_title'].value).toBe('Inicio de sesión exitoso');
        expect(resolved['composite'].value).toBe('Run ID: local:7 in prod');
    });

    it('should format outputs in HCL list, JSON, and raw formats', async () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

outputs:
  simple_str: "hello"
  number_val: 123
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const state = new State(testDir);
        await state.init();

        const resolver = new OutputResolver(testDir);
        const resolved = resolver.resolve(state);

        // HCL format
        const hclFormatted = resolver.format(resolved);
        expect(hclFormatted).toContain('number_val = 123');
        expect(hclFormatted).toContain('simple_str = "hello"');

        // JSON format
        const jsonFormatted = resolver.format(resolved, { json: true });
        const parsedJson = JSON.parse(jsonFormatted);
        expect(parsedJson.simple_str.value).toBe('hello');
        expect(parsedJson.number_val.value).toBe(123);

        // Single output & raw format
        const singleFormatted = resolver.format(resolved, { name: 'simple_str' });
        expect(singleFormatted).toBe('simple_str = "hello"');

        const rawFormatted = resolver.format(resolved, { name: 'simple_str', raw: true });
        expect(rawFormatted).toBe('hello');
    });

    it('should namespace outputs declared in module directories', () => {
        mkdirSync(resolve(testDir, 'modules/auth'), { recursive: true });
        const moduleYml = `
outputs:
  auth_token: "secret-token-123"
`;
        writeFileSync(resolve(testDir, 'modules/auth/auth.yml'), moduleYml);

        const resolver = new OutputResolver(testDir);
        const decls = resolver.getDeclarations();

        expect(decls['module.auth.auth_token']).toBeDefined();
        expect(decls['module.auth.auth_token'].value).toBe('secret-token-123');
    });
});
