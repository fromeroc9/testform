import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '../src/core/config';
import { initCmd } from '../src/commands/init';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

describe('YAML Configuration Support', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-yaml-test-'));
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should parse testform.yml with comments and clean YAML syntax', () => {
        const yamlContent = `
# Testform Project Configuration
version: "1.0"

provider:
  type: github
  config:
    owner: acme-corp
    repository: core-banking
    tokenEnv: GITHUB_TOKEN

backend:
  type: local

scope:
  testcase:
    identity: "@tc-*"
    fields:
      - name: priority
        type: tags
`;
        writeFileSync(join(tmpDir, 'testform.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getConfig().version).toBe('1.0');
        expect(config.getAdapterType()).toBe('github');
        expect(config.getGitHub()?.owner).toBe('acme-corp');
        expect(config.getGitHub()?.repository).toBe('core-banking');
        expect(config.getIdentity('testcase')).toBe('@tc-*');
        expect(config.getResolvedPath()).toBe(join(tmpDir, 'testform.yml'));
    });

    it('should parse testform.yaml alternative extension', () => {
        const yamlContent = `
version: "1.0"
provider:
  type: local
`;
        writeFileSync(join(tmpDir, 'testform.yaml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getConfig().version).toBe('1.0');
        expect(config.getAdapterType()).toBe('local');
        expect(config.getResolvedPath()).toBe(join(tmpDir, 'testform.yaml'));
    });

    it('should ignore testform.json since only YAML config files are supported', () => {
        const jsonContent = JSON.stringify({
            version: "1.0",
            provider: {
                type: "github",
                config: { owner: "legacy-owner", repository: "legacy-repo" }
            }
        });
        writeFileSync(join(tmpDir, 'testform.json'), jsonContent, 'utf8');

        // Should throw because no YAML config exists
        expect(() => new Config(tmpDir)).toThrow(/No configuration files/);
    });

    it('should resolve testform.yml even if testform.json exists in directory', () => {
        writeFileSync(join(tmpDir, 'testform.yml'), 'version: "1.0"\nprovider:\n  type: github\n  config:\n    owner: from-yaml\n', 'utf8');
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: "1.0", provider: { config: { owner: "from-json" } } }), 'utf8');

        const config = new Config(tmpDir);
        expect(config.getGitHub()?.owner).toBe('from-yaml');
        expect(config.getResolvedPath()).toBe(join(tmpDir, 'testform.yml'));
    });

    it('should generate testform.yml by default on initCmd', async () => {
        writeFileSync(join(tmpDir, 'sample.case.feature'), '@testcase\nFeature: Test\nScenario: One\nGiven step');
        await initCmd({ dir: tmpDir, lock: false });

        const expectedYmlPath = join(tmpDir, 'testform.yml');
        expect(existsSync(expectedYmlPath)).toBe(true);

        const content = readFileSync(expectedYmlPath, 'utf8');
        expect(content).toContain('version: "1.0"');
        expect(content).toContain('provider:');
        expect(content).toContain('github:');
        expect(content).toContain('scopes:');
    });

    it('should support Propuesta A: scopes, match, scaffold, and fields object map', () => {
        const yamlContent = `
version: "1.0"
provider:
  type: github
  config:
    owner: my-org
    repository: my-repo
    project_id: 42
    token_env: CUSTOM_GH_TOKEN

scopes:
  global:
    fields:
      priority:
        source: tag
        required: true
        enum:
          - "@low"
          - "@medium"
          - "@high"
      assignees:
        source: step

  testcase:
    match: "*.case.feature::*"
    scaffold:
      directory: "testcases"
      filename: "{slug}_{YYYYMMDD}.case.feature"
    fields:
      priority:
        source: tag
        required: false
        enum:
          - "@low"
          - "@high"
      browser:
        source: step
        required: true
`;
        writeFileSync(join(tmpDir, 'testform.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getGitHub()?.projectId).toBe(42);
        expect(config.getGitHub()?.tokenEnv).toBe('CUSTOM_GH_TOKEN');
        expect(config.getIdentity('testcase')).toBe('tc-*');
        
        const convention = config.getConvention('testcase');
        expect(convention?.directory).toBe('testcases');
        expect(convention?.filename).toBe('{slug}_{YYYYMMDD}.case.feature');

        const fields = config.getFields('testcase');
        expect(fields).toHaveLength(3); // priority, assignees, browser

        const priorityField = fields.find(f => f.name === 'priority');
        expect(priorityField).toBeDefined();
        expect(priorityField?.type).toBe('tags');
        expect(priorityField?.source).toBe('tag');
        expect(priorityField?.required).toBe(false); // overridden by testcase
        expect(priorityField?.values).toEqual(['@low', '@high']);

        const assigneesField = fields.find(f => f.name === 'assignees');
        expect(assigneesField).toBeDefined();
        expect(assigneesField?.type).toBe('keywords');
        expect(assigneesField?.source).toBe('step');

        const browserField = fields.find(f => f.name === 'browser');
        expect(browserField).toBeDefined();
        expect(browserField?.type).toBe('keywords');
        expect(browserField?.required).toBe(true);
    });

    it('should support top-level fields block and scaffold pattern alias', () => {
        const yamlContent = `
version: "1.0"
provider:
  type: local

scopes:
  testrun:
    match: "*.run.feature::*"
    scaffold:
      directory: "runs"
      pattern: "{slug}.run.feature"

fields:
  global:
    env:
      source: step
  testrun:
    testcases:
      source: step
`;
        writeFileSync(join(tmpDir, 'testform.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getIdentity('testrun')).toBe('tr-*');
        
        const convention = config.getConvention('testrun');
        expect(convention?.directory).toBe('runs');
        expect(convention?.filename).toBe('{slug}.run.feature');

        const fields = config.getFields('testrun');
        expect(fields).toHaveLength(2);
        expect(fields.find(f => f.name === 'env')?.type).toBe('keywords');
        expect(fields.find(f => f.name === 'testcases')?.type).toBe('keywords');
    });

    it('should parse dictionary format for providers directly without type or env wrapper', () => {
        const yamlContent = `
version: "1.0"
provider:
  github:
    owner: enterprise-corp
    repository: core-payments
    projectId: 77
    tokenEnv: GITHUB_TOKEN
`;
        writeFileSync(join(tmpDir, 'testform.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getProviderType()).toBe('github');
        const gh = config.getGitHub();
        expect(gh?.owner).toBe('enterprise-corp');
        expect(gh?.repository).toBe('core-payments');
        expect(gh?.projectId).toBe(77);
    });

    it('should parse provider: local as direct scalar string', () => {
        const yamlContent = `
version: "1.0"
provider: local
`;
        writeFileSync(join(tmpDir, 'testform.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getProviderType()).toBe('local');
        expect(config.getAdapterType()).toBe('local');
    });

    it('should extract custom identity pattern from match or identity property', () => {
        const yamlContent = `
version: "1.0"
provider: local
scopes:
  testcase:
    match: "*.case.feature.login-*"
  testrun:
    match: "*.run.feature"
    identity: "smoke-*"
`;
        writeFileSync(join(tmpDir, 'testform.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getIdentity('testcase')).toBe('login-*');
        expect(config.getIdentity('testrun')).toBe('smoke-*');
    });

    it('should fallback gracefully to standard defaults when match or scopes are not declared', () => {
        const yamlContent = `
version: "1.0"
provider: local
`;
        writeFileSync(join(tmpDir, 'testform.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getMatch('testcase')).toBeUndefined();
        expect(config.getIdentity('testcase')).toBe('tc-*');
        expect(config.getIdentity('testrun')).toBe('tr-*');
        expect(config.getIdentity('testplan')).toBe('tp-*');
    });
});

