import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { policyCmd } from '../src/commands/policy';
import { policy, registerPolicy } from '../src/core/policy';
import { getCommandHelp, HELP_POLICY } from '../src/core/help';
import { Config } from '../src/core/config';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Policy Command and Management', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-policy-test-'));
    });

    afterEach(() => {
        try {
            rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignore
        }
    });

    it('should provide Terraform-style help for policy command', () => {
        const help = getCommandHelp('policy');
        expect(help).toBeDefined();
        expect(help).toContain('Usage: testform [global options] policy [options]');
        expect(help).toContain('-enable=ID');
        expect(help).toContain('-disable=ID');
        expect(help).toContain('-show=ID');
        expect(help).toContain('-scope=SCOPE');
        expect(help).toContain('-json');
    });

    it('should list all built-in policies with default execution', async () => {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await policyCmd({ dir: tmpDir });
            const output = logs.join('\n');
            expect(output).toContain('ID');
            expect(output).toContain('SCOPE');
            expect(output).toContain('TYPE');
            expect(output).toContain('STATUS');
            expect(output).toContain('DESCRIPTION');
            expect(output).toContain('identity-required');
            expect(output).toContain('required-gherkin');
            expect(output).toContain('undeclared-fields');
            expect(output).toContain('system');
            expect(output).toContain('enabled');
        } finally {
            console.log = originalLog;
        }
    });

    it('should output policies in JSON format when --json is provided', async () => {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await policyCmd({ dir: tmpDir, json: true });
            const output = logs.join('\n');
            const parsed = JSON.parse(output);
            expect(Array.isArray(parsed)).toBe(true);
            const gherkinPolicy = parsed.find((p: any) => p.id === 'required-gherkin');
            expect(gherkinPolicy).toBeDefined();
            expect(gherkinPolicy.type).toBe('system');
            expect(gherkinPolicy.scope).toContain('testcase');
            expect(gherkinPolicy.enabled).toBe(true);
        } finally {
            console.log = originalLog;
        }
    });

    it('should filter policies by scope', async () => {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await policyCmd({ dir: tmpDir, scope: 'testplan', json: true });
            const output = logs.join('\n');
            const parsed = JSON.parse(output);
            expect(Array.isArray(parsed)).toBe(true);
            for (const p of parsed) {
                expect(p.scope).toContain('testplan');
            }
            expect(parsed.some((p: any) => p.id === 'duplicate-testruns-in-testplan')).toBe(true);
        } finally {
            console.log = originalLog;
        }
    });

    it('should show detailed information of a specific policy with --show', async () => {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await policyCmd({ dir: tmpDir, show: 'identity-unique' });
            const output = logs.join('\n');
            expect(output).toContain('Policy: identity-unique');
            expect(output).toContain('Type:');
            expect(output).toContain('Scope:');
            expect(output).toContain('Status:');
            expect(output).toContain('Description:');
        } finally {
            console.log = originalLog;
        }
    });

    it('should disable and enable a policy, persisting to main.yml', async () => {
        writeFileSync(join(tmpDir, 'main.yml'), 'provider:\n  type: local\n', 'utf-8');

        // 1. Disable
        await policyCmd({ dir: tmpDir, disable: 'required-gherkin' });
        expect(policy.isEnabled('required-gherkin')).toBe(false);

        const contentAfterDisable = readFileSync(join(tmpDir, 'main.yml'), 'utf-8');
        expect(contentAfterDisable).toContain('required-gherkin');

        // 2. Enable again
        await policyCmd({ dir: tmpDir, enable: 'required-gherkin' });
        expect(policy.isEnabled('required-gherkin')).toBe(true);

        const contentAfterEnable = readFileSync(join(tmpDir, 'main.yml'), 'utf-8');
        expect(contentAfterEnable).not.toContain('required-gherkin');
    });

    it('should auto-discover custom policies from .testform/policies/', async () => {
        const policiesDir = join(tmpDir, '.testform', 'policies');
        mkdirSync(policiesDir, { recursive: true });

        const customPolicyScript = `
module.exports = {
    id: "custom-naming-rule",
    scope: ["testcase"],
    description: "Custom enterprise naming check",
    action: (scenarios, rules) => {
        // custom logic
    }
};
`;
        writeFileSync(join(policiesDir, 'naming.js'), customPolicyScript, 'utf-8');

        await policyCmd({ dir: tmpDir });

        const custom = policy.get('custom-naming-rule');
        expect(custom).toBeDefined();
        expect(custom?.type).toBe('user');
        expect(custom?.description).toBe('Custom enterprise naming check');
    });

    it('should auto-discover shared module policies from .testform/modules/<mod>/policies/', async () => {
        const modulePoliciesDir = join(tmpDir, '.testform', 'modules', 'enterprise_standards', 'policies');
        mkdirSync(modulePoliciesDir, { recursive: true });

        const modulePolicyScript = `
module.exports = ({ registerPolicy }) => {
    registerPolicy({
        id: "module-jira-compliance",
        scope: ["testcase", "testrun"],
        description: "Enforces Jira issue linkage across 200 projects",
        action: (scenarios, rules) => {
            // shared module logic
        }
    });
};
`;
        writeFileSync(join(modulePoliciesDir, 'jira.js'), modulePolicyScript, 'utf-8');

        await policyCmd({ dir: tmpDir });

        const modPolicy = policy.get('module-jira-compliance');
        expect(modPolicy).toBeDefined();
        expect(modPolicy?.type).toBe('user');
        expect(modPolicy?.description).toContain('Jira issue linkage');
    });
});
