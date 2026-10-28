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
  github:
    owner: acme-corp
    repository: core-banking
    token_env: GITHUB_TOKEN

backend: local

resource:
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
        writeFileSync(join(tmpDir, 'testform.yml'), 'version: "1.0"\nprovider:\n  github:\n    owner: from-yaml\n', 'utf8');
        writeFileSync(join(tmpDir, 'testform.json'), JSON.stringify({ version: "1.0", provider: { config: { owner: "from-json" } } }), 'utf8');

        const config = new Config(tmpDir);
        expect(config.getGitHub()?.owner).toBe('from-yaml');
        expect(config.getResolvedPath()).toBe(join(tmpDir, 'testform.yml'));
    });

    it('should generate main.yml by default on initCmd with testform block', async () => {
        writeFileSync(join(tmpDir, 'sample.case.feature'), '@testcase\nFeature: Test\nScenario: One\nGiven step');
        await initCmd({ dir: tmpDir, lock: false });

        const expectedYmlPath = join(tmpDir, 'main.yml');
        expect(existsSync(expectedYmlPath)).toBe(true);

        const content = readFileSync(expectedYmlPath, 'utf8');
        expect(content).toContain('testform:');
        expect(content).toContain('required_version:');
        expect(content).toContain('provider:');
        expect(content).toContain('github:');
        expect(content).toContain('resource:');
    });

    it('should respect and load existing testform.yml for backward compatibility', async () => {
        writeFileSync(join(tmpDir, 'sample.case.feature'), '@testcase\nFeature: Test\nScenario: One\nGiven step');
        writeFileSync(join(tmpDir, 'testform.yml'), 'version: "1.0"\nprovider: local\nbackend: local\n');
        await initCmd({ dir: tmpDir, lock: false });

        expect(existsSync(join(tmpDir, 'testform.yml'))).toBe(true);
        expect(existsSync(join(tmpDir, 'main.yml'))).toBe(false);
    });

    it('should support main.yml with root testform block', () => {
        const yamlContent = `
testform:
  required_version: ">= 1.0"
  backend:
    local:
      path: ./testform.state

provider:
  github:
    owner: terraform-style
    repository: my-repo

resource:
  testcase:
    match: "*.case.feature"
`;
        writeFileSync(join(tmpDir, 'main.yml'), yamlContent, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getResolvedPath()).toBe(join(tmpDir, 'main.yml'));
        expect(config.getRequiredVersion()).toBe('>= 1.0');
        expect(config.getBackend()?.type).toBe('local');
        expect(config.getProviderType()).toBe('github');
        expect(config.getGitHub()?.owner).toBe('terraform-style');
    });

    it('should support Propuesta A: resource, match, scaffold, and fields object map', () => {
        const yamlContent = `
version: "1.0"
provider:
  github:
    owner: my-org
    repository: my-repo
    project_id: 42
    token_env: CUSTOM_GH_TOKEN

resource:
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
        expect(priorityField?.source).toBe('tag');
        expect(priorityField?.required).toBe(false); // overridden by testcase
        expect(priorityField?.enum).toEqual(['@low', '@high']);

        const assigneesField = fields.find(f => f.name === 'assignees');
        expect(assigneesField).toBeDefined();
        expect(assigneesField?.source).toBe('step');

        const browserField = fields.find(f => f.name === 'browser');
        expect(browserField).toBeDefined();
        expect(browserField?.source).toBe('step');
        expect(browserField?.required).toBe(true);
    });

    it('should support resource fields block and scaffold filename', () => {
        const yamlContent = `
version: "1.0"
provider: local

resource:
  global:
    fields:
      env:
        source: step
  testrun:
    match: "*.run.feature::*"
    scaffold:
      directory: "runs"
      filename: "{slug}.run.feature"
    fields:
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
        expect(fields.find(f => f.name === 'env')?.source).toBe('step');
        expect(fields.find(f => f.name === 'testcases')?.source).toBe('step');
    });

    it('should parse dictionary format for providers directly without type or env wrapper', () => {
        const yamlContent = `
version: "1.0"
provider:
  github:
    owner: enterprise-corp
    repository: core-payments
    project_id: 77
    token_env: GITHUB_TOKEN
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
resource:
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

    it('should fallback gracefully to standard defaults when match or resource are not declared', () => {
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

    it('should automatically load scopes from external resource.yml when separated from main.yml', () => {
        writeFileSync(join(tmpDir, 'main.yml'), `
testform:
  required_version: ">= 1.0.0"
  backend: local
provider: local
`, 'utf8');

        writeFileSync(join(tmpDir, 'resource.yml'), `
resource:
  global:
    scaffold:
      filename: "{YYYYMMDD}_{HHmmss}"
    fields:
      - name: project
        source: step
        required: true
        default: "Core Project"
      - name: priority
        source: tag
        enum: ["@low", "@medium", "@high"]
        default: "@medium"
  testcase:
    match: "*.case.feature"
    identity: "tc-*"
    fields:
      - name: module
        source: step
        required: true
  testrun:
    match: "*.run.feature"
    identity: "tr-*"
`, 'utf8');

        const config = new Config(tmpDir);
        expect(config.getIdentity('testcase')).toBe('tc-*');
        expect(config.getIdentity('testrun')).toBe('tr-*');
        expect(config.getConvention('testcase')?.filename).toBe('{YYYYMMDD}_{HHmmss}');

        const tcFields = config.getFields('testcase');
        expect(tcFields.some(f => f.name === 'project')).toBe(true);
        expect(tcFields.some(f => f.name === 'priority')).toBe(true);
        expect(tcFields.some(f => f.name === 'module')).toBe(true);
    });
});

