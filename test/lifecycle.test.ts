import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { LifecycleResolver } from '../src/core/lifecycle';
import { State } from '../src/core/state';
import { destroyCmd } from '../src/commands/destroy';
import { detectAttributeDrift } from '../src/core/sync';
import { calculatePlan } from '../src/commands/plan';

describe('Lifecycle Meta-Arguments (Phase 3)', () => {
    const testDir = resolve(__dirname, 'tmp-lifecycle-test');

    beforeEach(() => {
        rmSync(testDir, { recursive: true, force: true });
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should parse lifecycle configuration from resource block and tags', () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

resource:
  global:
    lifecycle:
      prevent_destroy: false
      ignore_changes:
        - assignees
  testcase:
    lifecycle:
      prevent_destroy: true
      ignore_changes:
        - labels
        - priority
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const resolver = new LifecycleResolver(testDir);

        // Standard resource with global defaults
        const globalLc = resolver.getLifecycle('checkout/cart.run.feature.@tr-2', []);
        expect(globalLc.prevent_destroy).toBe(false);
        expect(globalLc.ignore_changes).toContain('assignees');

        // Specific testcase scope override
        const specificLc = resolver.getLifecycle('auth/login.case.feature.@tc-1', []);
        expect(specificLc.prevent_destroy).toBe(true);
        expect(specificLc.ignore_changes).toContain('labels');
        expect(specificLc.ignore_changes).toContain('priority');

        // Resource with Gherkin tags
        const taggedLc = resolver.getLifecycle('inventory/items.case.feature.@tc-3', ['@smoke', '@prevent_destroy', '@ignore_changes("status","milestone")']);
        expect(taggedLc.prevent_destroy).toBe(true);
        expect(taggedLc.ignore_changes).toContain('status');
        expect(taggedLc.ignore_changes).toContain('milestone');
    });

    it('should parse lifecycle defined inside resource.yml following Terraform parity', () => {
        const resourceYml = `
resource:
  testcase:
    match: "features/*.case.feature"
    lifecycle:
      prevent_destroy: true
      ignore_changes:
        - labels
        - assignees
`;
        writeFileSync(resolve(testDir, 'resource.yml'), resourceYml);

        const resolver = new LifecycleResolver(testDir);
        const tcLc = resolver.getLifecycle('auth/login.case.feature.@tc-1', []);
        expect(tcLc.prevent_destroy).toBe(true);
        expect(tcLc.ignore_changes).toContain('labels');
        expect(tcLc.ignore_changes).toContain('assignees');
    });

    it('should block destruction when prevent_destroy is active', async () => {
        const testformYml = `
version: "1.0"
provider: local
backend: local

resource:
  testcase:
    lifecycle:
      prevent_destroy: true
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const state = new State(testDir);
        await state.init();

        state.upsertResource({
            type: 'github_testcase',
            identity: 'auth/login.case.feature.@tc-1',
            attributes: {
                localHash: 'hash1',
                issueNumber: 1,
                remoteId: 'local:1',
                title: 'Login Test',
                labels: ['testcase', 'auth']
            },
            lastApplied: new Date().toISOString()
        });
        await state.save();

        await expect(destroyCmd({
            dir: testDir,
            scope: 'testcase',
            autoApprove: true,
            lock: false,
            input: false
        })).rejects.toThrow('Instance cannot be destroyed');

        // Verify resource was NOT deleted from state
        const remaining = state.getResources();
        expect(remaining.length).toBe(1);
        expect(remaining[0].identity).toBe('auth/login.case.feature.@tc-1');
    });

    it('should ignore changes in detectAttributeDrift when ignore_changes is specified', () => {
        const currentAttrs = {
            title: 'Test Title',
            labels: ['smoke', 'v1'],
            assignees: ['alice'],
            milestone: 'v1.0',
            custom_fields: {
                priority: 'High'
            }
        };

        const remoteIssue = {
            id: 1,
            number: 1,
            title: 'Test Title',
            body: 'steps...',
            state: 'open',
            labels: ['smoke', 'v1', 'drift-label-added-by-qa'],
            assignees: ['bob'], // Changed from alice to bob
            milestone: 'v1.0'
        };

        const remoteCustomFields = {
            priority: 'Low' // Changed from High to Low
        };

        // Without ignore_changes -> hasDrift must be true
        const driftWithoutIgnore = detectAttributeDrift(currentAttrs, remoteIssue as any, remoteCustomFields, []);
        expect(driftWithoutIgnore.hasDrift).toBe(true);

        // With ignore_changes on labels, assignees, and priority -> hasDrift must be false
        const driftWithIgnore = detectAttributeDrift(
            currentAttrs,
            remoteIssue as any,
            remoteCustomFields,
            ['labels', 'assignees', 'priority']
        );
        expect(driftWithIgnore.hasDrift).toBe(false);
    });

    it('should ignore tag changes in plan calculation when ignore_changes: [labels] is active', async () => {
        mkdirSync(resolve(testDir, 'auth'), { recursive: true });

        const featureContent = `
@testcase
Feature: Auth Feature
  @tc-1 @smoke
  Scenario: Login scenario
    Given que estoy en la pagina de login
    When ingreso mis credenciales
    Then veo el dashboard
`;
        writeFileSync(resolve(testDir, 'auth/login.case.feature'), featureContent);

        const testformYml = `
version: "1.0"
provider: local
backend: local

resource:
  testcase:
    lifecycle:
      ignore_changes:
        - labels
`;
        writeFileSync(resolve(testDir, 'testform.yml'), testformYml);

        const plan1 = await calculatePlan({
            dir: testDir,
            scope: 'testcase',
            lock: false
        });

        expect(plan1.changes.length).toBe(1);
        expect(plan1.changes[0].action).toBe('add');
        const calculatedHash = plan1.changes[0].localHash;

        // Simulate state already applied
        const state = new State(testDir);
        await state.init();
        state.upsertResource({
            type: 'github_testcase',
            identity: 'auth/login.case.feature.@tc-1',
            attributes: {
                localHash: calculatedHash,
                issueNumber: 10,
                remoteId: 'local:10',
                title: 'Login scenario',
                labels: ['smoke']
            },
            lastApplied: new Date().toISOString()
        });
        await state.save();

        // Now modify the feature file by adding a new tag @temporary-tag
        const modifiedFeatureContent = `
@testcase
Feature: Auth Feature
  @tc-1 @smoke @temporary-tag
  Scenario: Login scenario
    Given que estoy en la pagina de login
    When ingreso mis credenciales
    Then veo el dashboard
`;
        writeFileSync(resolve(testDir, 'auth/login.case.feature'), modifiedFeatureContent);

        const plan2 = await calculatePlan({
            dir: testDir,
            scope: 'testcase',
            lock: false
        });

        // Because labels is in ignore_changes, hash calculation stripped tags, so no change is planned
        expect(plan2.changes.length).toBe(0);
        expect(plan2.hasChanges).toBe(false);
    });
});
