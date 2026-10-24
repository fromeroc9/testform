import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    GherkinEditor,
    findFeatureFiles,
    findNextIdentity,
    formatGherkin,
    updateFeatureScenario,
} from '../src/core/editor';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

describe('GherkinEditor module', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-editor-test-'));
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    describe('findFeatureFiles', () => {
        it('should find feature files in the root directory', () => {
            writeFileSync(join(tmpDir, 'test1.feature'), 'Feature: Test 1');
            writeFileSync(join(tmpDir, 'test2.txt'), 'Not a feature');

            const files = findFeatureFiles(tmpDir, false);
            expect(files.length).toBe(1);
            expect(files[0]).toContain('test1.feature');
        });

        it('should ignore hidden folders and node_modules', () => {
            const gitDir = join(tmpDir, '.git');
            const nmDir = join(tmpDir, 'node_modules');
            mkdirSync(gitDir);
            mkdirSync(nmDir);
            writeFileSync(join(gitDir, 'hidden.feature'), 'Feature: Hidden');
            writeFileSync(join(nmDir, 'vendor.feature'), 'Feature: Vendor');
            writeFileSync(join(tmpDir, 'valid.feature'), 'Feature: Valid');

            const files = findFeatureFiles(tmpDir, true);
            expect(files.length).toBe(1);
            expect(files[0]).toContain('valid.feature');
        });

        it('should recurse into subdirectories when recursive is true', () => {
            const subDir = join(tmpDir, 'sub');
            mkdirSync(subDir);
            writeFileSync(join(subDir, 'nested.feature'), 'Feature: Nested');

            expect(findFeatureFiles(tmpDir, false).length).toBe(0);
            expect(findFeatureFiles(tmpDir, true).length).toBe(1);
        });
    });

    describe('findNextIdentity', () => {
        it('should return null if pattern has no wildcard', () => {
            expect(findNextIdentity(tmpDir, '@tc-fixed')).toBeNull();
        });

        it('should return @tc-1 when no existing files contain the pattern', () => {
            writeFileSync(join(tmpDir, 'case.feature'), 'Feature: Test\nScenario: One');
            const next = findNextIdentity(tmpDir, '@tc-*');
            expect(next).toBe('@tc-1');
        });

        it('should increment max existing identity number', () => {
            writeFileSync(
                join(tmpDir, 'cases.feature'),
                'Feature: Cases\n@tc-1\nScenario: A\n@tc-5\nScenario: B\n@tc-2\nScenario: C'
            );
            const next = findNextIdentity(tmpDir, '@tc-*');
            expect(next).toBe('@tc-6');
        });
    });

    describe('formatGherkin', () => {
        it('should indent features, scenarios, steps, and tags properly', () => {
            const unformatted = `@tag1\nFeature: Test\n@tag2\nScenario: My scenario\nGiven something\nWhen action\nThen result`;
            const formatted = formatGherkin(unformatted);

            expect(formatted).toContain('Feature: Test');
            expect(formatted).toContain('  @tag2');
            expect(formatted).toContain('  Scenario: My scenario');
            expect(formatted).toContain('    Given something');
            expect(formatted).toContain('    When action');
            expect(formatted).toContain('    Then result');
        });

        it('should preserve docstrings indentation without altering content', () => {
            const withDocString = `Feature: Doc\n  Scenario: S\n    Given text:\n"""\nhello world\n"""`;
            const formatted = formatGherkin(withDocString);
            expect(formatted).toContain('hello world');
        });
    });

    describe('updateScenarioTitleAndTags', () => {
        it('should update scenario title and tags in place', () => {
            const filePath = join(tmpDir, 'edit.feature');
            const initial = `@old-tag\n  Scenario: Old Title\n    Given step 1`;
            writeFileSync(filePath, initial, 'utf8');

            const success = updateFeatureScenario(filePath, 'Old Title', 'New Title', ['new-tag-1', 'new-tag-2']);
            expect(success).toBe(true);

            const updatedContent = readFileSync(filePath, 'utf8');
            expect(updatedContent).toContain('Scenario: New Title');
            expect(updatedContent).toContain('@new-tag-1 @new-tag-2');
        });

        it('should return false if file does not exist', () => {
            const success = updateFeatureScenario(join(tmpDir, 'missing.feature'), 'A', 'B');
            expect(success).toBe(false);
        });
    });

    describe('linkRuleOrScenario and updateScenarioStatus', () => {
        it('should link rule and scenario and mark status', () => {
            const runFile = join(tmpDir, 'test.run.feature');
            writeFileSync(runFile, '@testrun\nFeature: Test Run\n', 'utf8');

            const linkResult = GherkinEditor.linkRuleOrScenario(runFile, 'auth.feature', 'Login success', 'passed');
            expect(linkResult.addedRule).toBe(true);
            expect(linkResult.addedScenario).toBe(true);

            const content = readFileSync(runFile, 'utf8');
            expect(content).toContain('Rule: auth.feature');
            expect(content).toContain('Scenario: Login success');
            expect(content).toContain('mark status = passed');

            // Now update the status to failed
            GherkinEditor.updateScenarioStatus(runFile, 'auth.feature', 'Login success', 'failed');
            const updatedContent = readFileSync(runFile, 'utf8');
            expect(updatedContent).toContain('mark status = failed');
        });

        it('should throw error when updating status of unexpanded scenario', () => {
            const runFile = join(tmpDir, 'test.run.feature');
            writeFileSync(runFile, '@testrun\nFeature: Test Run\n  Rule: auth.feature\n', 'utf8');

            expect(() => {
                GherkinEditor.updateScenarioStatus(runFile, 'auth.feature', 'Unexpanded', 'passed');
            }).toThrow(/Scenario 'Unexpanded' is not expanded/);
        });
    });

    describe('expandScenarios', () => {
        it('should expand implicit scenarios into explicit scenarios', () => {
            const runFile = join(tmpDir, 'expand.run.feature');
            writeFileSync(runFile, '@testrun\nFeature: Run\n  Rule: auth.feature\n', 'utf8');

            GherkinEditor.expandScenarios(runFile, ['auth.feature.Login', 'auth.feature.Logout'], 'pending');

            const content = readFileSync(runFile, 'utf8');
            expect(content).toContain('Scenario: Login');
            expect(content).toContain('Scenario: Logout');
            expect(content).toContain('mark status = pending');
        });
    });
});
