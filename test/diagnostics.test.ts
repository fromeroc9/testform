import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Diag, Diagnostic } from '../src/core/diagnostics';
import { logger } from '../src/core/logger';

describe('Diagnostic Components (Terraform-styled)', () => {
    let pushSpy: any;
    let exitSpy: any;

    beforeEach(() => {
        pushSpy = vi.spyOn(logger, 'push').mockImplementation(() => {});
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('process.exit');
        }) as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should format a diagnostic with source location and code snippet', () => {
        const diag = Diag.implicitRule({
            file: 'tests/run1.run.feature',
            line: 12,
            rule: 'checkout.case.feature',
            scenario: '@tc-1',
            target: 'tests/run1.run.feature',
        });

        const notifyObj = diag.toNotify();
        expect(notifyObj.type).toBe('error');
        expect(notifyObj.title).toBe('Cannot mark status on implicit rule');
        expect(notifyObj.detail).toEqual(expect.arrayContaining([
            'on tests/run1.run.feature line 12, in rule "checkout.case.feature":',
            '  12:   Rule: checkout.case.feature',
            '',
            'Scenario "@tc-1" belongs to the implicit Rule "checkout.case.feature".',
            'Testform requires explicit Scenario blocks in order to track and record execution outcomes.',
            '',
            'To expand this rule into explicit scenarios with initial pending status, run:',
            '  testform suite fill -target="tests/run1.run.feature"',
        ]));
    });

    it('should emit to logger.push on .emit()', () => {
        const diag = Diag.targetNotFound({
            scopeKey: 'testrun',
            target: 'missing.run.feature',
        });

        diag.emit();
        expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            title: "No testrun matched target 'missing.run.feature'.",
            detail: expect.arrayContaining([
                'Run `testform state list` to list available resources.',
            ]),
        }));
    });

    it('should call process.exit(1) on .abort()', () => {
        const diag = Diag.usage({
            syntax: 'testform suite <init|fill|link|mark>',
            detail: ['Available subcommands: init, fill, link, mark'],
        });

        expect(() => diag.abort()).toThrow('process.exit');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pushSpy).toHaveBeenCalled();
    });

    it('should format ambiguous target diagnostic correctly', () => {
        const diag = Diag.ambiguousTarget({
            scopeKey: 'testrun',
            target: 'sprint',
            matches: ['sprint1.run.feature', 'sprint2.run.feature'],
        });

        const notifyObj = diag.toNotify();
        expect(notifyObj.title).toContain("Multiple testrun files matched 'sprint'");
        expect(notifyObj.detail).toEqual([
            '  - sprint1.run.feature',
            '  - sprint2.run.feature',
        ]);
    });

    it('should format testcaseNotFound with accepted strategies', () => {
        const diag = Diag.testcaseNotFound({
            identifier: '@tc-99',
            target: 'run.feature',
            available: ['@tc-1', '@tc-2'],
        });

        const notifyObj = diag.toNotify();
        expect(notifyObj.title).toContain("Testcase '@tc-99' not found in testrun 'run.feature'.");
        expect(notifyObj.detail).toEqual(expect.arrayContaining([
            'Available testcases in this run (up to 10):',
            '  - @tc-1',
            '  - @tc-2',
            '',
            'Accepted identity strategies:',
        ]));
    });

    it('should format unknown subcommand diagnostic', () => {
        const diag = Diag.unknownSubcommand({
            command: 'suite',
            subcommand: 'foobar',
            available: ['init', 'fill', 'link', 'mark'],
        });

        const notifyObj = diag.toNotify();
        expect(notifyObj.title).toBe("Unknown suite subcommand: 'foobar'");
        expect(notifyObj.detail).toEqual(['Available subcommands: init, fill, link, mark']);
    });
});
