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

    it('should support inline single-line data source syntax (no wasted filename/address line)', () => {
        mkdirSync(resolve(testDir, 'fixtures'), { recursive: true });
        writeFileSync(resolve(testDir, 'fixtures/users.json'), JSON.stringify({ admin: { user: 'admin' } }));

        const testformYml = `
version: "1.0"
data:
  local_file:
    usuarios: "fixtures/users.json"
  testcase:
    login_core: "auth/login.case.feature.@tc-1"
  direct_users: "fixtures/users.json"
  direct_login: "auth/login.case.feature.@tc-1"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const resolver = new DataResolver(testDir);
        const decls = resolver.getDeclarations();

        expect(decls['usuarios'].file).toBe('fixtures/users.json');
        expect(decls['local_file.usuarios'].file).toBe('fixtures/users.json');
        expect(decls['login_core'].address).toBe('auth/login.case.feature.@tc-1');
        expect(decls['testcase.login_core'].address).toBe('auth/login.case.feature.@tc-1');
        expect(decls['direct_users'].file).toBe('fixtures/users.json');
        expect(decls['direct_login'].address).toBe('auth/login.case.feature.@tc-1');

        expect(resolver.resolvePath('usuarios.admin.user')).toBe('admin');
        expect(resolver.resolvePath('local_file.usuarios.admin.user')).toBe('admin');
        expect(resolver.resolvePath('direct_users.admin.user')).toBe('admin');
    });

    it('should return an array when an address or tag matches multiple scenarios', async () => {
        // 1. Static feature file with multiple scenarios sharing a tag
        mkdirSync(resolve(testDir, 'suites'), { recursive: true });
        const smokeFeature = `
@tr-smoke
Feature: Smoke Test Suite
  Scenario: TC 1 Smoke Verification
    Given service is alive
  Scenario: TC 2 Database Ping
    Given db is alive
  Scenario: TC 3 Cache Ping
    Given redis is alive
`;
        writeFileSync(resolve(testDir, 'suites/smoke.run.feature'), smokeFeature.trim());

        const testformYml = `
version: "1.0"
data:
  smoke_suite: "suites/smoke.run.feature.@tr-smoke"
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const resolver = new DataResolver(testDir);
        const result = resolver.resolvePath('smoke_suite');

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(3);
        expect(result[0].title).toBe('TC 1 Smoke Verification');
        expect(result[1].title).toBe('TC 2 Database Ping');
        expect(result[2].title).toBe('TC 3 Cache Ping');

        // Test array index resolution with bracket and dot notations
        expect(resolver.resolvePath('smoke_suite[0].title')).toBe('TC 1 Smoke Verification');
        expect(resolver.resolvePath('smoke_suite.0.title')).toBe('TC 1 Smoke Verification');
        expect(resolver.resolvePath('smoke_suite.1.title')).toBe('TC 2 Database Ping');
        expect(resolver.resolvePath('smoke_suite.length')).toBe(3);

        // Test Splat expressions (* and [*]) to access an attribute from ALL matched elements
        const allTitlesBracket = resolver.resolvePath('smoke_suite[*].title');
        const allTitlesDot = resolver.resolvePath('smoke_suite.*.title');
        expect(allTitlesBracket).toEqual([
            'TC 1 Smoke Verification',
            'TC 2 Database Ping',
            'TC 3 Cache Ping'
        ]);
        expect(allTitlesDot).toEqual([
            'TC 1 Smoke Verification',
            'TC 2 Database Ping',
            'TC 3 Cache Ping'
        ]);

        // 2. State-based multiple resource resolution
        const state = new State(testDir);
        await state.init();

        state.upsertResource({
            type: 'github_testcase',
            identity: 'suites/smoke.run.feature.@tc-1',
            attributes: {
                localHash: 'hash1',
                remoteId: 'local:1',
                issueNumber: 1,
                title: 'Login Test',
                labels: ['tr-smoke', 'auth']
            },
            lastApplied: new Date().toISOString()
        });

        state.upsertResource({
            type: 'github_testcase',
            identity: 'suites/smoke.run.feature.@tc-2',
            attributes: {
                localHash: 'hash2',
                remoteId: 'local:2',
                issueNumber: 2,
                title: 'Payment Test',
                labels: ['tr-smoke', 'checkout']
            },
            lastApplied: new Date().toISOString()
        });

        const stateResolver = new DataResolver(testDir);
        const stateSmokeResult = stateResolver.resolvePath('smoke_suite', state);
        expect(Array.isArray(stateSmokeResult)).toBe(true);
        expect(stateSmokeResult.length).toBe(2);
        expect(stateSmokeResult[0].title).toBe('Login Test');
        expect(stateSmokeResult[1].title).toBe('Payment Test');
    });

    it('should resolve http data source with GET and POST requests, auto-parsing JSON', async () => {
        const { spawn } = await import('child_process');
        const serverScript = `
const http = require('http');
const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ login: 'octocat', id: 583231, role: 'developer' }));
    } else if (req.method === 'POST' && req.url === '/auth') {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const parsed = JSON.parse(raw);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token: 'jwt-xyz-123', user: parsed.username }));
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});
server.listen(0, '127.0.0.1', () => {
    console.log(server.address().port);
});
`;
        const child = spawn(process.execPath, ['-e', serverScript]);
        let port = '';
        for await (const chunk of child.stdout) {
            port = chunk.toString().trim().split('\n')[0].trim();
            break;
        }

        const baseUrl = `http://127.0.0.1:${port}`;

        try {
            const testformYml = `
version: "1.0"
data:
  # 1. Inline URL auto-detected as http
  direct_api: "${baseUrl}/user"

  # 2. Typed http block with GET
  http:
    typed_user: "${baseUrl}/user"

  # 3. Explicit POST with headers and body
  auth_session:
    type: "http"
    url: "${baseUrl}/auth"
    method: "POST"
    headers:
      Content-Type: "application/json"
    body:
      username: "supertester"
      password: "secretpassword"
`;
            writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

            const resolver = new DataResolver(testDir);
            const decls = resolver.getDeclarations();

            expect(decls['direct_api']).toBeDefined();
            expect(decls['typed_user']).toBeDefined();
            expect(decls['auth_session']).toBeDefined();

            // 1. GET resolution
            expect(resolver.resolvePath('direct_api.login')).toBe('octocat');
            expect(resolver.resolvePath('direct_api.role')).toBe('developer');
            expect(resolver.resolvePath('direct_api.status_code')).toBe(200);

            expect(resolver.resolvePath('typed_user.login')).toBe('octocat');
            expect(resolver.resolvePath('http.typed_user.id')).toBe(583231);

            // 2. POST resolution
            expect(resolver.resolvePath('auth_session.token')).toBe('jwt-xyz-123');
            expect(resolver.resolvePath('auth_session.user')).toBe('supertester');
            expect(resolver.resolvePath('auth_session.status_code')).toBe(200);
        } finally {
            child.kill();
        }
    });
});
