import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { DataResolver } from '../src/core/data';
import { State } from '../src/core/state';
import { VariableParser } from '../src/core/variables';
import { OutputResolver } from '../src/core/outputs';

describe('Data Sources System (Phase 2)', () => {
    const testDir = resolve(__dirname, 'tmp-data-test');

    beforeEach(() => {
        rmSync(testDir, { recursive: true, force: true });
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should parse scopeless and scoped data declarations from testform.yml and data.yml', () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

data:
  usuarios:
    file: "fixtures/users.json"
  login_core:
    address: "auth/login.case.feature.@tc-1"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const dataYml = `
data:
  checkout_flow:
    address: "checkout/order.case.feature.@tc-2"
  testcase:
    scoped_tc:
      address: "auth/logout.case.feature.@tc-3"
`;
        writeFileSync(resolve(testDir, 'data.yml'), dataYml);

        const resolver = new DataResolver(testDir);
        const decls = resolver.getDeclarations();

        expect(decls['usuarios']).toBeDefined();
        expect(decls['usuarios'].file).toBe('fixtures/users.json');
        expect(decls['login_core']).toBeDefined();
        expect(decls['login_core'].address).toBe('auth/login.case.feature.@tc-1');
        expect(decls['checkout_flow']).toBeDefined();
        expect(decls['checkout_flow'].address).toBe('checkout/order.case.feature.@tc-2');
        // Both scoped and scopeless should be registered for scoped blocks
        expect(decls['testcase.scoped_tc']).toBeDefined();
        expect(decls['scoped_tc']).toBeDefined();
    });

    it('should resolve file dataset sources (.json and .yaml) and nested property paths', () => {
        mkdirSync(resolve(testDir, 'fixtures'), { recursive: true });
        
        const usersJson = {
            standard_user: {
                username: "standard_user",
                password: "secret_sauce",
                role: "tester"
            },
            locked_out_user: {
                username: "locked_out_user",
                password: "secret_sauce"
            }
        };
        writeFileSync(resolve(testDir, 'fixtures/users.json'), JSON.stringify(usersJson, null, 2));

        const testformYml = `
version: "1.0"
provider: local
backend: local

data:
  usuarios:
    file: "fixtures/users.json"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const resolver = new DataResolver(testDir);
        
        expect(resolver.resolvePath('usuarios.standard_user.username')).toBe('standard_user');
        expect(resolver.resolvePath('usuarios.standard_user.password')).toBe('secret_sauce');
        expect(resolver.resolvePath('usuarios.standard_user.role')).toBe('tester');
        expect(resolver.resolvePath('usuarios.locked_out_user.username')).toBe('locked_out_user');
        expect(resolver.resolvePath('usuarios.non_existent')).toBeUndefined();
    });

    it('should resolve address references against State resources', async () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

data:
  login_tc:
    address: "auth/login.case.feature.@tc-1"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const state = new State(testDir);
        await state.init();

        state.upsertResource({
            type: 'github_testcase',
            identity: 'auth/login.case.feature.@tc-1',
            attributes: {
                localHash: 'hash123',
                remoteId: 'local:10',
                issueNumber: 101,
                title: 'Login con credenciales válidas',
                labels: ['auth', 'tc-1', 'smoke'],
                status: 'PASSED',
                custom_fields: {
                    priority: 'high',
                    module: 'auth'
                }
            },
            lastApplied: new Date().toISOString()
        });

        const resolver = new DataResolver(testDir);

        expect(resolver.resolvePath('login_tc.id', state)).toBe('local:10');
        expect(resolver.resolvePath('login_tc.remoteId', state)).toBe('local:10');
        expect(resolver.resolvePath('login_tc.identity', state)).toBe('auth/login.case.feature.@tc-1');
        expect(resolver.resolvePath('login_tc.tag', state)).toBe('@tc-1');
        expect(resolver.resolvePath('login_tc.uri', state)).toBe('auth/login.case.feature');
        expect(resolver.resolvePath('login_tc.title', state)).toBe('Login con credenciales válidas');
        expect(resolver.resolvePath('login_tc.status', state)).toBe('PASSED');
        expect(resolver.resolvePath('login_tc.custom_fields.priority', state)).toBe('high');
    });

    it('should interpolate \${data.*} inside VariableParser and OutputResolver', async () => {
        mkdirSync(resolve(testDir, 'fixtures'), { recursive: true });
        writeFileSync(resolve(testDir, 'fixtures/users.json'), JSON.stringify({
            admin: {
                user: "superadmin"
            }
        }));

        const testformYml = `
version: "1.0"
provider: local
backend: local

data:
  credenciales:
    file: "fixtures/users.json"
  login_tc:
    address: "auth/login.case.feature.@tc-1"

local:
  admin_user: "\${data.credenciales.admin.user}"

outputs:
  resolved_admin: "\${data.credenciales.admin.user}"
  tc_id: "\${data.login_tc.id}"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const state = new State(testDir);
        await state.init();

        state.upsertResource({
            type: 'github_testcase',
            identity: 'auth/login.case.feature.@tc-1',
            attributes: {
                localHash: 'hash99',
                issueNumber: 99,
                remoteId: 'local:99',
                title: 'Test Login'
            },
            lastApplied: new Date().toISOString()
        });

        const varParser = new VariableParser(undefined, undefined, testDir);
        expect(varParser.getLocals()['admin_user']).toBe('superadmin');

        const template = "When I enter '${data.credenciales.admin.user}' as username";
        expect(varParser.applyToTemplate(template)).toBe("When I enter 'superadmin' as username");

        const outputResolver = new OutputResolver(testDir);
        const resolvedOutputs = outputResolver.resolve(state, varParser);

        expect(resolvedOutputs['resolved_admin'].value).toBe('superadmin');
        expect(resolvedOutputs['tc_id'].value).toBe('local:99');
    });
});
