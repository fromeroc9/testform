import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProviderInstaller, computeFileHash } from '../src/core/provider-installer';
import { Config } from '../src/core/config';
import { createProvider } from '../src/providers/loader';
import { providersCmd } from '../src/commands/providers';

describe('ProviderInstaller & Dynamic Registry', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'testform-dyn-provider-'));
    });

    afterEach(() => {
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    });

    it('computes terraform-compliant h1: hash', () => {
        const testFile = join(tempDir, 'sample.txt');
        writeFileSync(testFile, 'hello testform provider');
        const hash = computeFileHash(testFile);
        expect(hash).toMatch(/^h1:[A-Za-z0-9+/=]+$/);
    });

    it('parses required_providers shorthand and object syntax from main.yml', () => {
        writeFileSync(join(tempDir, 'main.yml'), `
testform:
  required_version: ">= 1.0.0"
  required_providers:
    gitlab: "git::https://gitlab.miempresa.com/qa/providers.git//gitlab.ts?ref=v1.2.0"
    github:
      source: "git::https://github.com/miempresa/testform-provider-github.git"
      version: "1.0.0"
    local: "./custom-providers/local-provider.ts"
`);
        const config = new Config(tempDir, false);
        const req = config.getRequiredProviders();

        expect(req.gitlab).toBeDefined();
        expect(req.gitlab.source).toBe('git::https://gitlab.miempresa.com/qa/providers.git//gitlab.ts?ref=v1.2.0');

        expect(req.github).toBeDefined();
        expect(req.github.source).toBe('git::https://github.com/miempresa/testform-provider-github.git');
        expect(req.github.version).toBe('1.0.0');

        expect(req.local).toBeDefined();
        expect(req.local.source).toBe('./custom-providers/local-provider.ts');
    });

    it('installs a local provider file into .testform/providers/<name> and records lockfile', async () => {
        // Create custom provider source
        const srcDir = join(tempDir, 'my-custom-providers');
        mkdirSync(srcDir, { recursive: true });
        const providerFile = join(srcDir, 'custom-gitlab.js');
        writeFileSync(providerFile, `
class CustomGitLab {
    constructor(config) {
        this.config = config;
    }
    formatRemoteId(id) {
        return 'GL-' + id;
    }
}
module.exports = CustomGitLab;
`);

        const installer = new ProviderInstaller(tempDir);
        const result = await installer.install('custom_gitlab', {
            source: './my-custom-providers/custom-gitlab.js',
            version: '1.2.0'
        });

        expect(result.name).toBe('custom_gitlab');
        expect(result.version).toBe('1.2.0');
        expect(result.hash).toMatch(/^h1:/);
        expect(existsSync(result.entrypoint)).toBe(true);

        // Record lockfile
        installer.recordLockfile([result]);

        const lockHcl = join(tempDir, '.testform.lock.hcl');
        expect(existsSync(lockHcl)).toBe(true);
        const content = readFileSync(lockHcl, 'utf-8');
        expect(content).toContain('provider "custom_gitlab"');
        expect(content).toContain('version     = "1.2.0"');
        expect(content).toContain(result.hash);
    });

    it('dynamically loads the installed provider through createProvider', async () => {
        // 1. Prepare workspace with installed provider in .testform/providers/myprovider
        const installedDir = join(tempDir, '.testform', 'providers', 'myprovider');
        mkdirSync(installedDir, { recursive: true });
        const entrypoint = join(installedDir, 'index.js');
        writeFileSync(entrypoint, `
class MyProvider {
    constructor(config) {
        this.name = 'my-dynamic-provider';
        this.config = config;
    }
    formatRemoteId(id) {
        return 'DYN-' + id;
    }
}
module.exports = MyProvider;
`);

        // 2. Prepare main.yml
        writeFileSync(join(tempDir, 'main.yml'), `
version: "1.0"
provider:
  myprovider:
    token: "secret123"
`);

        const config = new Config(tempDir, false);
        const provider = await createProvider(config, tempDir);

        expect(provider).toBeDefined();
        expect(provider.formatRemoteId(42)).toBe('DYN-42');
    });

    it('rejects undeclared provider with strict Terraform-like error', async () => {
        writeFileSync(join(tempDir, 'main.yml'), `
testform:
  required_providers:
    gitlab: "git::https://gitlab.com/qa/gitlab.git"

provider:
  jira:
    token: "xyz"
`);
        const config = new Config(tempDir, false);
        await expect(createProvider(config, tempDir)).rejects.toThrow('Undeclared provider "jira"');
    });

    it('rejects uninstalled remote provider with init instruction error', async () => {
        writeFileSync(join(tempDir, 'main.yml'), `
testform:
  required_providers:
    gitlab: "git::https://gitlab.com/qa/gitlab.git"

provider:
  gitlab:
    token: "xyz"
`);
        const config = new Config(tempDir, false);
        await expect(createProvider(config, tempDir)).rejects.toThrow('Provider "gitlab" is not installed');
    });

    it('scaffolds a full enterprise provider project structure with --project', async () => {
        const projectPath = join(tempDir, 'my-gitlab-provider');
        await providersCmd({
            dir: tempDir,
            action: 'scaffold',
            args: ['gitlab', projectPath, '--project']
        });

        expect(existsSync(join(projectPath, 'package.json'))).toBe(true);
        expect(existsSync(join(projectPath, 'tsconfig.json'))).toBe(true);
        expect(existsSync(join(projectPath, 'README.md'))).toBe(true);
        expect(existsSync(join(projectPath, 'src', 'index.ts'))).toBe(true);
        expect(existsSync(join(projectPath, 'src', 'client.ts'))).toBe(true);
        expect(existsSync(join(projectPath, 'src', 'types.ts'))).toBe(true);
        expect(existsSync(join(projectPath, 'test', 'provider.test.ts'))).toBe(true);

        const pkgContent = readFileSync(join(projectPath, 'package.json'), 'utf-8');
        expect(pkgContent).toContain('testform-provider-gitlab');

        const indexContent = readFileSync(join(projectPath, 'src', 'index.ts'), 'utf-8');
        expect(indexContent).toContain('GitlabProvider');
    });

    it('supports agnostic provider with apis dictionary', async () => {
        const providerFile = join(tempDir, 'agnostic-provider.ts');
        writeFileSync(providerFile, `
export default class AgnosticProvider {
    public name = 'agnostic';
    public apis = {
        testcase: {
            create: async (data: any) => ({ id: 'TC-101', number: 101, title: data.title }),
            update: async (id: any, data: any) => ({ id, number: Number(id), title: data.title }),
            delete: async (id: any) => {}
        }
    };
    formatRemoteId(id: any) {
        return 'AG-' + id;
    }
}
`);
        writeFileSync(join(tempDir, 'main.yml'), `
testform:
  required_providers:
    agnostic: "./agnostic-provider.ts"

provider:
  agnostic: {}
`);
        const config = new Config(tempDir, false);
        const provider = await createProvider(config, tempDir);

        expect(provider.apis).toBeDefined();
        expect(provider.apis?.testcase).toBeDefined();
        const res = await provider.apis?.testcase.create?.({ title: 'My Agnostic Case' });
        expect(res).toEqual({ id: 'TC-101', number: 101, title: 'My Agnostic Case' });
        expect(provider.formatRemoteId(res.id)).toBe('AG-TC-101');
    });
});
