import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseModuleTargets, parseGitSource, isGitSource, ModuleRegistry, loadModuleSteps } from '../src/core/module';
import { Parser } from '../src/core/parser';
import { OutputResolver } from '../src/core/outputs';
import { VariableParser } from '../src/core/variables';
import { State } from '../src/core/state';
import { reassembleSplitTags } from '../src/core/utils';

describe('Repowered Module System (Phase 5)', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-module-repower-'));
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should parse @module tags with variable={...} parameters and scenario selection', () => {
        const tag = '@module(source="./auth/login.case.feature", variable={user: "admin", env: "${var.environment}"})';
        const targets = parseModuleTargets(tag);

        expect(targets).toBeDefined();
        expect(targets?.length).toBe(1);
        expect(targets?.[0].source).toBe('./auth/login.case.feature');
        expect(targets?.[0].variable).toEqual({
            user: 'admin',
            env: '${var.environment}'
        });

        const tagWithScenario = '@module(source="./auth.feature", scenario="@tc-login", variable={role: "qa", timeout: 5000})';
        const targets2 = parseModuleTargets(tagWithScenario);
        expect(targets2?.[0].source).toBe('./auth.feature');
        expect(targets2?.[0].scenario).toBe('@tc-login');
        expect(targets2?.[0].variable).toEqual({
            role: 'qa',
            timeout: 5000
        });

        // Verify backward compatibility for vars= is eradicated (does not parse vars= as input variables)
        const legacyTag = '@module(source="./auth.feature", vars={user: "legacy"})';
        const legacyTargets = parseModuleTargets(legacyTag);
        expect(legacyTargets?.[0].variable).toBeUndefined();
    });

    it('should support direct native module variables in YAML (Terraform parity)', () => {
        const modDir = join(tmpDir, 'modules', 'auth');
        mkdirSync(modDir, { recursive: true });
        writeFileSync(join(modDir, 'login.case.feature'), `@testcase
Feature: Login Module
  @tc-login
  Scenario: Autenticacion
    Given credencial de usuario "<user>" y rol "<role>"
`);

        // testform.yml defining module with native direct arguments (no vars: container)
        writeFileSync(join(tmpDir, 'testform.yml'), `
module:
  auth_native:
    source: "./modules/auth/login.case.feature"
    user: "native_admin"
    role: "SuperAdmin"
`);

        const mainFile = join(tmpDir, 'dashboard.case.feature');
        writeFileSync(mainFile, `@testcase
Feature: Dashboard
  @tc-dash
  @module("auth_native")
  Scenario: Ver Dashboard
    When carga las metricas
`);

        const parser = new Parser(tmpDir);
        const scenarios = parser.content();
        const dashScenario = scenarios.find(s => s.name === 'Ver Dashboard');

        expect(dashScenario).toBeDefined();
        expect(dashScenario?.steps.length).toBe(2);
        expect(dashScenario?.steps[0].text).toBe('credencial de usuario "native_admin" y rol "SuperAdmin"');
        expect(dashScenario?.steps[1].text).toBe('carga las metricas');
    });

    it('should reassemble tags split across whitespace by Gherkin parser', () => {
        const splitTags = [
            '@module(source="./modules/auth/login.case.feature",',
            'variable={user:',
            '"admin",',
            'env:',
            '"staging"})'
        ];

        const reassembled = reassembleSplitTags(splitTags, '@module(');
        expect(reassembled.length).toBe(1);
        expect(reassembled[0]).toBe('@module(source="./modules/auth/login.case.feature", variable={user: "admin", env: "staging"})');

        const targets = parseModuleTargets(reassembled[0]);
        expect(targets).toBeDefined();
        expect(targets?.[0].variable).toEqual({
            user: 'admin',
            env: 'staging'
        });
    });

    it('should inject input variables into module steps during scenario composition', () => {
        const modDir = join(tmpDir, 'modules', 'auth');
        mkdirSync(modDir, { recursive: true });
        const modFile = join(modDir, 'login.case.feature');
        writeFileSync(modFile, '@testcase\n' +
            'Feature: Auth Module\n' +
            '  @tc-login\n' +
            '  Scenario: Do Login\n' +
            '    Given el usuario ingresa "<user>" y contrasena "<password>"\n' +
            '    And navega hacia "${var.base_url}"\n'
        );

        const mainFile = join(tmpDir, 'payment.case.feature');
        writeFileSync(mainFile, `@testcase
Feature: Checkout
  @tc-pay
  @module(source="./modules/auth/login.case.feature", variable={user: "admin_user", password: "SecretPassword123", base_url: "https://app.corp.internal"})
  Scenario: Realizar Pago Seguro
    When confirma la transaccion de $100
    Then transaccion autorizada
`);

        const parser = new Parser(tmpDir);
        const scenarios = parser.content();
        const payScenario = scenarios.find(s => s.name === 'Realizar Pago Seguro');

        expect(payScenario).toBeDefined();
        // Should have 2 inherited steps + 2 own steps = 4 steps
        expect(payScenario?.steps.length).toBe(4);
        expect(payScenario?.steps[0].text).toBe('el usuario ingresa "admin_user" y contrasena "SecretPassword123"');
        expect(payScenario?.steps[1].text).toBe('navega hacia "https://app.corp.internal"');
        expect(payScenario?.steps[2].text).toBe('confirma la transaccion de $100');
        expect(payScenario?.steps[3].text).toBe('transaccion autorizada');
    });

    it('should support declared modules in testform.yml and invocation by name with overrides', () => {
        const modDir = join(tmpDir, 'modules', 'auth');
        mkdirSync(modDir, { recursive: true });
        const modFile = join(modDir, 'login.case.feature');
        writeFileSync(modFile, `@testcase
Feature: Login Helper
  @tc-auth
  Scenario: Autenticacion
    Given credencial de usuario "<user>"
`);

        // testform.yml defining module
        writeFileSync(join(tmpDir, 'testform.yml'), `
module:
  auth_standard:
    source: "./modules/auth/login.case.feature"
    variable:
      user: "default_standard_user"
`);

        const mainFile = join(tmpDir, 'account.case.feature');
        writeFileSync(mainFile, `@testcase
Feature: Perfil
  @tc-profile
  @module("auth_standard")
  Scenario: Ver Perfil
    When accede a configuracion
`);

        const parser = new Parser(tmpDir);
        const scenarios = parser.content();
        const profileScenario = scenarios.find(s => s.name === 'Ver Perfil');

        expect(profileScenario).toBeDefined();
        expect(profileScenario?.steps.length).toBe(2);
        expect(profileScenario?.steps[0].text).toBe('credencial de usuario "default_standard_user"');
        expect(profileScenario?.steps[1].text).toBe('accede a configuracion');
    });

    it('should scope module outputs under module.<name>.<output> and resolve references', () => {
        // Module folder with outputs.yml
        const modDir = join(tmpDir, 'modules', 'auth');
        mkdirSync(modDir, { recursive: true });
        writeFileSync(join(modDir, 'outputs.yml'), `
outputs:
  session_token:
    value: "tok_secret_xyz123"
  user_id:
    value: 42
`);

        // Root testform.yml referencing module output in root output
        writeFileSync(join(tmpDir, 'testform.yml'), `
outputs:
  global_session:
    value: "\${module.auth.session_token}"
  app_environment:
    value: "production"
`);

        const resolver = new OutputResolver(tmpDir);
        const decls = resolver.getDeclarations();

        // 1. Module outputs are strictly scoped
        expect(decls['module.auth.session_token']).toBeDefined();
        expect(decls['module.auth.session_token'].value).toBe('tok_secret_xyz123');
        expect(decls['module.auth.user_id']).toBeDefined();
        expect(decls['module.auth.user_id'].value).toBe(42);

        // 2. Global output references module output
        expect(decls['global_session']).toBeDefined();
        expect(decls['global_session'].value).toBe('${module.auth.session_token}');

        // 3. Resolution evaluates module reference
        const state = new State(tmpDir);
        const resolved = resolver.resolve(state);
        expect(resolved['global_session'].value).toBe('tok_secret_xyz123');
        expect(resolved['module.auth.session_token'].value).toBe('tok_secret_xyz123');
        expect(resolved['module.auth.user_id'].value).toBe(42);
    });

    it('should parse Git source URLs with subpaths and refs', () => {
        const fullSource = 'git::https://github.com/my-org/qa-library.git//modules/login?ref=v2.1.0';
        expect(isGitSource(fullSource)).toBe(true);

        const parsed = parseGitSource(fullSource);
        expect(parsed.repoUrl).toBe('https://github.com/my-org/qa-library.git');
        expect(parsed.subPath).toBe('modules/login');
        expect(parsed.ref).toBe('v2.1.0');

        const sshSource = 'git@github.com:my-org/qa-library.git';
        expect(isGitSource(sshSource)).toBe(true);
        const parsedSsh = parseGitSource(sshSource);
        expect(parsedSsh.repoUrl).toBe('git@github.com:my-org/qa-library.git');
        expect(parsedSsh.subPath).toBeUndefined();
        expect(parsedSsh.ref).toBeUndefined();
    });
});
