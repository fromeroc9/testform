import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { specCmd } from '../src/commands/spec';
import { importCmd } from '../src/commands/import';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { State } from '../src/core/state';
import { getCommandHelp } from '../src/core/help';

describe('Testform Spec Command Tree & Results Ingestion', () => {
    let tmpDir: string;
    let logs: string[] = [];

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-spec-test-'));
        writeFileSync(join(tmpDir, 'main.yml'), 'provider:\n  local: {}\n');
        logs = [];
        vi.spyOn(console, 'log').mockImplementation((...args) => {
            logs.push(args.join(' '));
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    describe('spec testcase', () => {
        it('should create a new testcase specification file', async () => {
            await specCmd({
                dir: tmpDir,
                resource: 'testcase',
                action: 'new',
                target: 'auth.case.feature',
                title: 'User Authentication'
            });

            const filePath = join(tmpDir, 'tests/features/auth.case.feature');
            expect(existsSync(filePath)).toBe(true);
            const content = readFileSync(filePath, 'utf-8');
            expect(content).toContain('@testcase');
            expect(content).toContain('Feature: User Authentication');
        });

        it('should add a scenario to an existing testcase specification', async () => {
            await specCmd({
                dir: tmpDir,
                resource: 'testcase',
                action: 'new',
                target: 'cart.case.feature',
                title: 'Shopping Cart'
            });

            await specCmd({
                dir: tmpDir,
                resource: 'testcase',
                action: 'add',
                target: 'cart.case.feature',
                title: 'Add item with discount'
            });

            const filePath = join(tmpDir, 'tests/features/cart.case.feature');
            const content = readFileSync(filePath, 'utf-8');
            expect(content).toContain('@tc-1');
            expect(content).toContain('Scenario: Add item with discount');
        });

        it('should delete a scenario by identity tag', async () => {
            const filePath = join(tmpDir, 'sample.case.feature');
            writeFileSync(filePath, `@testcase\nFeature: Test\n\n  @tc-1\n  Scenario: TC 1\n    Given step\n\n  @tc-2\n  Scenario: TC 2\n    Given step\n`);

            await specCmd({
                dir: tmpDir,
                resource: 'testcase',
                action: 'delete',
                target: '@tc-1'
            });

            const content = readFileSync(filePath, 'utf-8');
            expect(content).not.toContain('@tc-1');
            expect(content).not.toContain('Scenario: TC 1');
            expect(content).toContain('@tc-2');
            expect(content).toContain('Scenario: TC 2');
        });

        it('should display reverse lookup status querying linked runs and bugs', async () => {
            const state = new State(tmpDir);
            await state.init();

            // Populate testcase, testrun, and bug in state
            state.upsertResource({
                type: 'github_testcase',
                identity: 'Magento/cart.case.feature.@tc-01',
                attributes: {
                    title: 'Add discount voucher to cart',
                    labels: ['critical', 'checkout']
                } as any,
                lastApplied: new Date().toISOString()
            });

            state.upsertResource({
                type: 'github_testrun',
                identity: '20261029.run.feature.@tr-1',
                attributes: {
                    title: 'Sprint 42 Nightly Regression',
                    testcases: {
                        'Magento/cart.case.feature.@tc-01': 'failed'
                    },
                    testcaseTraces: {
                        'Magento/cart.case.feature.@tc-01': 'AssertionError: Coupon DISCOUNT20 returned 500'
                    },
                    testcaseEvidence: {
                        'Magento/cart.case.feature.@tc-01': ['evidence/err_500.png']
                    }
                } as any,
                lastApplied: new Date().toISOString()
            });

            state.upsertResource({
                type: 'github_bug',
                identity: 'bugs.bug.feature.@bg-1',
                attributes: {
                    title: '500 Internal Error applying DISCOUNT20',
                    testcase: 'Magento/cart.case.feature.@tc-01',
                    status: 'failed',
                    severity: 'critical',
                    priority: 'high',
                    trace: 'AssertionError: Coupon DISCOUNT20 returned 500',
                    evidence: ['evidence/err_500.png']
                } as any,
                lastApplied: new Date().toISOString()
            });

            await state.save();

            // Test default view
            logs = [];
            await specCmd({
                dir: tmpDir,
                resource: 'testcase',
                action: 'status',
                target: 'Magento/cart.case.feature.@tc-01'
            });

            const out = logs.join('\n');
            expect(out).toContain('TESTCASE: Magento/cart.case.feature.@tc-01');
            expect(out).toContain('Add discount voucher to cart');
            expect(out).toContain('20261029.run.feature.@tr-1');
            expect(out).toContain('failed');
            expect(out).toContain('bugs.bug.feature.@bg-1');
            expect(out).toContain('critical');

            // Test with -show-name and -show-detail
            logs = [];
            await specCmd({
                dir: tmpDir,
                resource: 'testcase',
                action: 'status',
                target: 'Magento/cart.case.feature.@tc-01',
                showName: true,
                showDetail: true
            });

            const detailOut = logs.join('\n');
            expect(detailOut).toContain('Sprint 42 Nightly Regression');
            expect(detailOut).toContain('500 Internal Error applying DISCOUNT20');
            expect(detailOut).toContain('AssertionError: Coupon DISCOUNT20 returned 500');
            expect(detailOut).toContain('evidence/err_500.png');
        });
    });

    describe('spec testrun', () => {
        it('should create new testrun in evolution mode and link testcases', async () => {
            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                action: 'new',
                target: 'nightly.run.feature',
                title: 'Nightly Execution'
            });

            const filePath = join(tmpDir, 'tests/runs/nightly.run.feature');
            expect(existsSync(filePath)).toBe(true);
            const content = readFileSync(filePath, 'utf-8');
            expect(content).toContain('@testrun @tr-1');
            expect(content).toContain('Feature: Nightly Execution');

            // Add case
            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                action: 'add',
                target: 'nightly.run.feature',
                case: 'Magento/cart.case.feature.@tc-01',
                status: 'pending'
            });

            const updatedContent = readFileSync(filePath, 'utf-8');
            expect(updatedContent).toContain('Scenario: Magento/cart.case.feature.@tc-01');
            expect(updatedContent).toContain('* set status = pending');

            // Mark case execution
            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                action: 'set',
                target: 'nightly.run.feature',
                case: 'Magento/cart.case.feature.@tc-01',
                status: 'passed',
                trace: undefined,
                evidence: 'evidence/step_ok.png'
            });

            const markedContent = readFileSync(filePath, 'utf-8');
            expect(markedContent).toContain('* set status = passed');
            expect(markedContent).toContain('* set evidence = evidence/step_ok.png');
        });

        it('should display testrun dashboard with -show-name and -show-detail', async () => {
            const state = new State(tmpDir);
            await state.init();

            state.upsertResource({
                type: 'github_testcase',
                identity: 'auth.case.feature.@tc-1',
                attributes: {
                    title: 'Login with Google OAuth'
                } as any,
                lastApplied: new Date().toISOString()
            });

            state.upsertResource({
                type: 'github_testrun',
                identity: '@tr-8',
                attributes: {
                    title: 'Release Candidate Verification',
                    testcases: {
                        'auth.case.feature.@tc-1': 'failed'
                    },
                    testcaseTraces: {
                        'auth.case.feature.@tc-1': 'OAuth token expired'
                    },
                    testcaseEvidence: {
                        'auth.case.feature.@tc-1': ['evidence/oauth_error.png']
                    }
                } as any,
                lastApplied: new Date().toISOString()
            });

            await state.save();

            logs = [];
            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                action: 'status',
                target: '@tr-8',
                showName: true,
                showDetail: true
            });

            const out = logs.join('\n');
            expect(out).toContain('TESTRUN: Release Candidate Verification');
            expect(out).toContain('Login with Google OAuth');
            expect(out).toContain('OAuth token expired');
            expect(out).toContain('evidence/oauth_error.png');
        });
    });

    describe('spec testplan', () => {
        it('should create testplan and link testruns', async () => {
            await specCmd({
                dir: tmpDir,
                resource: 'testplan',
                action: 'new',
                target: 'release_v2.plan.feature',
                title: 'Release v2.0 Master Plan'
            });

            const filePath = join(tmpDir, 'tests/plans/release_v2.plan.feature');
            expect(existsSync(filePath)).toBe(true);

            await specCmd({
                dir: tmpDir,
                resource: 'testplan',
                action: 'add',
                target: 'release_v2.plan.feature',
                run: 'tests/runs/smoke.run.feature.@tr-1'
            });

            const content = readFileSync(filePath, 'utf-8');
            expect(content).toContain('Scenario: tests/runs/smoke.run.feature.@tr-1');
        });
    });

    describe('spec bug', () => {
        it('should create bug container, add bug scenarios, and mark bug resolution', async () => {
            await specCmd({
                dir: tmpDir,
                resource: 'bug',
                action: 'new',
                target: 'sprint42.bug.feature',
                title: 'Defects from Sprint 42'
            });

            const filePath = join(tmpDir, 'tests/bugs/sprint42.bug.feature');
            expect(existsSync(filePath)).toBe(true);

            // Add bug scenario
            await specCmd({
                dir: tmpDir,
                resource: 'bug',
                action: 'add',
                target: 'sprint42.bug.feature',
                case: 'Magento/checkout.case.feature.@tc-05',
                title: 'Payment gateway timeout',
                status: 'failed',
                severity: 'critical',
                priority: 'high',
                trace: 'TimeoutError: Gateway did not respond in 30s',
                evidence: 'evidence/gateway_timeout.png'
            });

            let content = readFileSync(filePath, 'utf-8');
            expect(content).toContain('@bg-1');
            expect(content).toContain('Scenario: Payment gateway timeout');
            expect(content).toContain('* set target = Magento/checkout.case.feature.@tc-05');
            expect(content).toContain('* set status = failed');
            expect(content).toContain('* set severity = critical');
            expect(content).toContain('* set priority = high');
            expect(content).toContain('* set trace = TimeoutError: Gateway did not respond in 30s');
            expect(content).toContain('* set evidence = evidence/gateway_timeout.png');

            // Mark bug resolved
            await specCmd({
                dir: tmpDir,
                resource: 'bug',
                action: 'set',
                target: '@bg-1',
                status: 'passed'
            });

            content = readFileSync(filePath, 'utf-8');
            expect(content).toContain('* set status = passed');
        });
    });

    describe('import -results="cucumber.json" -auto-create-bugs', () => {
        it('should ingest cucumber.json, decode Base64 embeddings to PNGs, create run and auto-create bugs', async () => {
            // 1x1 transparent PNG base64
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            const cucumberJson = [
                {
                    uri: 'Magento/cart.case.feature',
                    name: 'Cart Feature',
                    elements: [
                        {
                            name: 'Add item to cart',
                            type: 'scenario',
                            tags: [{ name: '@tc-01' }],
                            steps: [
                                {
                                    name: 'I navigate to cart',
                                    result: { status: 'passed' }
                                }
                            ]
                        },
                        {
                            name: 'Checkout empty cart',
                            type: 'scenario',
                            tags: [{ name: '@tc-02' }],
                            steps: [
                                {
                                    name: 'I click checkout',
                                    result: {
                                        status: 'failed',
                                        error_message: 'AssertionError: Expected cart error banner not shown'
                                    },
                                    embeddings: [
                                        {
                                            mime_type: 'image/png',
                                            data: pngBase64
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ];

            const resultsFile = join(tmpDir, 'cucumber-results.json');
            writeFileSync(resultsFile, JSON.stringify(cucumberJson), 'utf-8');

            await importCmd({
                dir: tmpDir,
                results: 'cucumber-results.json',
                autoCreateBugs: true
            });

            // Verify evidence directory and created PNG file
            const evidenceDir = join(tmpDir, 'evidence');
            expect(existsSync(evidenceDir)).toBe(true);

            // Verify run feature created
            const runsDir = join(tmpDir, 'tests/runs');
            expect(existsSync(runsDir)).toBe(true);
            const runFiles = require('fs').readdirSync(runsDir);
            expect(runFiles.length).toBeGreaterThan(0);

            const runContent = readFileSync(join(runsDir, runFiles[0]), 'utf-8');
            expect(runContent).toContain('Scenario: Magento/cart.case.feature.@tc-01');
            expect(runContent).toContain('* set status = passed');
            expect(runContent).toContain('Scenario: Magento/cart.case.feature.@tc-02');
            expect(runContent).toContain('* set status = failed');
            expect(runContent).toContain('* set trace = AssertionError: Expected cart error banner not shown');
            expect(runContent).toContain('* set evidence = evidence/ev_');

            // Verify bug feature created
            const bugsDir = join(tmpDir, 'tests/bugs');
            expect(existsSync(bugsDir)).toBe(true);
            const bugFiles = require('fs').readdirSync(bugsDir);
            expect(bugFiles.length).toBeGreaterThan(0);

            const bugContent = readFileSync(join(bugsDir, bugFiles[0]), 'utf-8');
            expect(bugContent).toContain('@bug');
            expect(bugContent).toContain('@bg-1');
            expect(bugContent).toContain('Scenario: Bug in Checkout empty cart');
            expect(bugContent).toContain('* set target = Magento/cart.case.feature.@tc-02');
            expect(bugContent).toContain('* set status = failed');
            expect(bugContent).toContain('* set severity = high');
            expect(bugContent).toContain('* set trace = AssertionError: Expected cart error banner not shown');
            expect(bugContent).toContain('* set evidence = evidence/ev_');
        });
    });

    describe('spec autocomplete & target enhancements', () => {
        it('should autocomplete empty testrun rules using spec testrun fill', async () => {
            const caseFile = join(tmpDir, 'tests/features/payment.case.feature');
            const runFile = join(tmpDir, 'tests/runs/execution.run.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/features'), { recursive: true });
            require('fs').mkdirSync(join(tmpDir, 'tests/runs'), { recursive: true });

            writeFileSync(caseFile, `@testcase\nFeature: Payment\n\n  @tc-1\n  Scenario: Credit Card\n    Given card\n\n  @tc-2\n  Scenario: Cash\n    Given cash\n`, 'utf-8');
            writeFileSync(runFile, `@testrun @tr-1\nFeature: Execution\n\n  Rule: payment.case.feature\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                action: 'fill',
                target: '@tr-1'
            });

            const content = readFileSync(runFile, 'utf-8');
            expect(content).toContain('Scenario: @tc-1');
            expect(content).toContain('Scenario: @tc-2');
            expect(content).toContain('* set status = pending');
        });

        it('should support inline status in -case (e.g. -case="@tc-1=passed")', async () => {
            const runFile = join(tmpDir, 'tests/runs/inline.run.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/runs'), { recursive: true });
            writeFileSync(runFile, `@testrun @tr-2\nFeature: Inline Status Run\n\n  Scenario: @tc-1\n    * set status = pending\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                action: 'set',
                target: '@tr-2',
                case: '@tc-1=passed'
            });

            const content = readFileSync(runFile, 'utf-8');
            expect(content).toContain('* set status = passed');
        });

        it('should support positional args for testcase in spec testrun set', async () => {
            const runFile = join(tmpDir, 'tests/runs/pos.run.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/runs'), { recursive: true });
            writeFileSync(runFile, `@testrun @tr-3\nFeature: Positional Run\n\n  Scenario: @tc-5\n    * set status = pending\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                action: 'set',
                target: '@tr-3',
                args: ['@tc-5=skipped']
            });

            const content = readFileSync(runFile, 'utf-8');
            expect(content).toContain('* set status = skipped');
        });

        it('should resolve sub-command help in getCommandHelp', () => {
            expect(getCommandHelp('spec testcase')).toContain('spec testcase <action>');
            expect(getCommandHelp('spec testrun')).toContain('spec testrun <action>');
            expect(getCommandHelp('spec testplan')).toContain('spec testplan <action>');
            expect(getCommandHelp('spec bug')).toContain('spec bug <action>');
        });

        it('should autocomplete using flag -fill in spec testrun -fill -target=@tr-1', async () => {
            const caseFile = join(tmpDir, 'tests/features/order.case.feature');
            const runFile = join(tmpDir, 'tests/runs/order.run.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/features'), { recursive: true });
            require('fs').mkdirSync(join(tmpDir, 'tests/runs'), { recursive: true });

            writeFileSync(caseFile, `@testcase\nFeature: Order\n\n  @tc-10\n  Scenario: Place Order\n    Given item\n`, 'utf-8');
            writeFileSync(runFile, `@testrun @tr-10\nFeature: Order Run\n\n  Rule: order.case.feature\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                fill: true,
                target: '@tr-10'
            });

            const content = readFileSync(runFile, 'utf-8');
            expect(content).toContain('Scenario: @tc-10');
            expect(content).toContain('* set status = pending');
        });

        it('should generate testrun matching tag coincidence using -include=smoke without brackets', async () => {
            const caseFile = join(tmpDir, 'tests/features/smoke.case.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/features'), { recursive: true });
            writeFileSync(caseFile, `@testcase\nFeature: Smoke Tests\n\n  @smoke\n  Scenario: Fast Check\n    Given ok\n\n  @manual\n  Scenario: Manual Check\n    Given wait\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                include: 'smoke',
                title: 'Smoke Suite'
            });

            const runsDir = join(tmpDir, 'tests/runs');
            const files = require('fs').readdirSync(runsDir);
            const smokeRun = files.find((f: string) => f.includes('smoke') || f.endsWith('.run.feature'));
            expect(smokeRun).toBeDefined();

            const content = readFileSync(join(runsDir, smokeRun!), 'utf-8');
            expect(content).toContain('Fast Check');
            expect(content).not.toContain('Manual Check');
        });

        it('should match multiple or compound tags (e.g. -include="one tag") and respect -test-directory', async () => {
            const subDir = join(tmpDir, 'testcase/ParaBank');
            const otherDir = join(tmpDir, 'testcase/Other');
            require('fs').mkdirSync(subDir, { recursive: true });
            require('fs').mkdirSync(otherDir, { recursive: true });

            writeFileSync(join(subDir, 'bill.case.feature'), `@testcase\nFeature: Bill\n\n  @one_tag\n  Scenario: Pay Bill\n    Given bill\n`, 'utf-8');
            writeFileSync(join(otherDir, 'loan.case.feature'), `@testcase\nFeature: Loan\n\n  @one_tag\n  Scenario: Apply Loan\n    Given loan\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                include: 'one_tag',
                testDirectory: 'testcase/ParaBank',
                title: 'ParaBank Tag Run'
            });

            const runsDir = join(tmpDir, 'tests/runs');
            const files = require('fs').readdirSync(runsDir);
            const targetRun = files[files.length - 1];
            const content = readFileSync(join(runsDir, targetRun), 'utf-8');

            expect(content).toContain('Pay Bill');
            expect(content).not.toContain('Apply Loan');
        });

        it('should include full feature file and exclude unwanted tags with -include="order.case.feature" -exclude=wip', async () => {
            const caseFile = join(tmpDir, 'tests/features/order.case.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/features'), { recursive: true });
            writeFileSync(caseFile, `@testcase\nFeature: Order Feature\n\n  @tc-1\n  Scenario: Order Complete Item\n    Given item\n\n  @tc-2 @wip\n  Scenario: Order Draft Feature\n    Given draft\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                include: 'order.case.feature',
                exclude: 'wip',
                title: 'Order Production Run'
            });

            const runsDir = join(tmpDir, 'tests/runs');
            const files = require('fs').readdirSync(runsDir);
            const targetRun = files[files.length - 1];
            const content = readFileSync(join(runsDir, targetRun), 'utf-8');

            expect(content).toContain('Order Complete Item');
            expect(content).not.toContain('Order Draft Feature');
        });

        it('should filter scenarios with -include=smoke -exclude=manual', async () => {
            const caseFile = join(tmpDir, 'tests/features/filter.case.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/features'), { recursive: true });
            writeFileSync(caseFile, `@testcase\nFeature: Filter Suite\n\n  @smoke\n  Scenario: Automated Smoke\n    Given auto\n\n  @smoke @manual\n  Scenario: Manual Smoke Scenario\n    Given manual\n\n  @other\n  Scenario: Unrelated Scenario\n    Given none\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                include: 'smoke',
                exclude: 'manual',
                title: 'Automated Smoke Run'
            });

            const runsDir = join(tmpDir, 'tests/runs');
            const files = require('fs').readdirSync(runsDir);
            const targetRun = files[files.length - 1];
            const content = readFileSync(join(runsDir, targetRun), 'utf-8');

            expect(content).toContain('Automated Smoke');
            expect(content).not.toContain('Manual Smoke Scenario');
            expect(content).not.toContain('Unrelated Scenario');
        });

        it('should filter candidate scenarios during -fill with -include and -exclude', async () => {
            const caseFile = join(tmpDir, 'tests/features/checkout.case.feature');
            const runFile = join(tmpDir, 'tests/runs/checkout.run.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/features'), { recursive: true });
            require('fs').mkdirSync(join(tmpDir, 'tests/runs'), { recursive: true });

            writeFileSync(caseFile, `@testcase\nFeature: Checkout\n\n  @tc-1 @smoke\n  Scenario: Valid Card\n    Given card\n\n  @tc-2 @smoke @wip\n  Scenario: Crypto Payment\n    Given crypto\n`, 'utf-8');
            writeFileSync(runFile, `@testrun @tr-25\nFeature: Checkout Run\n\n  Rule: checkout.case.feature\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                fill: true,
                target: '@tr-25',
                include: 'smoke',
                exclude: 'wip'
            });

            const content = readFileSync(runFile, 'utf-8');
            expect(content).toContain('Scenario: @tc-1');
            expect(content).not.toContain('@tc-2');
        });

        it('should include all testcases except excluded with -exclude=manual', async () => {
            const caseFile1 = join(tmpDir, 'tests/features/a.case.feature');
            const caseFile2 = join(tmpDir, 'tests/features/b.case.feature');
            require('fs').mkdirSync(join(tmpDir, 'tests/features'), { recursive: true });

            writeFileSync(caseFile1, `@testcase\nFeature: A\n\n  Scenario: Normal Case A\n    Given a\n`, 'utf-8');
            writeFileSync(caseFile2, `@testcase\nFeature: B\n\n  @manual\n  Scenario: Manual Case B\n    Given b\n`, 'utf-8');

            await specCmd({
                dir: tmpDir,
                resource: 'testrun',
                exclude: 'manual',
                title: 'All Except Manual Run'
            });

            const runsDir = join(tmpDir, 'tests/runs');
            const files = require('fs').readdirSync(runsDir);
            const targetRun = files[files.length - 1];
            const content = readFileSync(join(runsDir, targetRun), 'utf-8');

            expect(content).toContain('Normal Case A');
            expect(content).not.toContain('Manual Case B');
        });
    });
});
