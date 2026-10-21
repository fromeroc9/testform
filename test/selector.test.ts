import { describe, it, expect, vi } from 'vitest';
import {
    matchesScope,
    detectScopeFromTarget,
    matchesTarget,
    parseSpec,
    matchesScenarioSpec,
    matchesStateKey,
} from '../src/core/selector';
import { logger } from '../src/core/logger';

describe('Target and Spec Selector (src/core/selector)', () => {
    describe('matchesScope', () => {
        it('should match scope by file extension', () => {
            expect(matchesScope({ uri: 'auth/login.case.feature' }, 'testcase')).toBe(true);
            expect(matchesScope({ uri: 'runs/sprint14.run.feature' }, 'testrun')).toBe(true);
            expect(matchesScope({ uri: 'plans/q3.plan.feature' }, 'testplan')).toBe(true);
            expect(matchesScope({ uri: 'auth/login.case.feature' }, 'testrun')).toBe(false);
        });

        it('should match scope by feature tags', () => {
            expect(matchesScope({ uri: 'custom.feature', feature: { tags: ['@testcase'] } }, 'testcase')).toBe(true);
            expect(matchesScope({ uri: 'custom.feature', feature: { tags: ['@testrun'] } }, 'testrun')).toBe(true);
            expect(matchesScope({ uri: 'custom.feature', feature: { tags: ['@testplan'] } }, 'testplan')).toBe(true);
        });
    });

    describe('detectScopeFromTarget', () => {
        it('should detect scope from target name or tag', () => {
            expect(detectScopeFromTarget('sprint.run.feature')).toBe('testrun');
            expect(detectScopeFromTarget('@tr-42')).toBe('testrun');
            expect(detectScopeFromTarget('release.plan.feature')).toBe('testplan');
            expect(detectScopeFromTarget('@tp-1')).toBe('testplan');
            expect(detectScopeFromTarget('checkout.case.feature')).toBe('testcase');
            expect(detectScopeFromTarget('@tc-1')).toBe('testcase');
        });
    });

    describe('matchesTarget', () => {
        it('should match by exact identity or prefix', () => {
            expect(matchesTarget('tests/login.case.feature::@tc-1', 'tests/login.case.feature')).toBe(true);
            expect(matchesTarget('tests/login.case.feature', 'login.case.feature')).toBe(true);
            expect(matchesTarget('tests/login.case.feature', 'login')).toBe(true);
            expect(matchesTarget('@tr-1', '@tr-1')).toBe(true);
        });

        it('should support array of targets', () => {
            expect(matchesTarget('tests/a.run.feature', ['tests/b.run.feature', 'tests/a.run.feature'])).toBe(true);
            expect(matchesTarget('tests/c.run.feature', ['tests/b.run.feature', 'tests/a.run.feature'])).toBe(false);
        });
    });

    describe('parseSpec', () => {
        it('should parse tag and status', () => {
            const parsed = parseSpec('@tc-1=passed');
            expect(parsed.casePart).toBe('@tc-1');
            expect(parsed.featurePart).toBe('');
            expect(parsed.newStatus).toBe('passed');
        });

        it('should parse file@tag=status format', () => {
            const parsed = parseSpec('cuenta/inicio-sesion.feature@tc-1=failed');
            expect(parsed.featurePart).toBe('cuenta/inicio-sesion.feature');
            expect(parsed.casePart).toBe('@tc-1');
            expect(parsed.newStatus).toBe('failed');
        });

        it('should parse file::@tag=status format', () => {
            const parsed = parseSpec('checkout.case.feature::@tc-2=passed');
            expect(parsed.featurePart).toBe('checkout.case.feature');
            expect(parsed.casePart).toBe('@tc-2');
            expect(parsed.newStatus).toBe('passed');
        });

        it('should parse scenario title with status', () => {
            const parsed = parseSpec('Pago con tarjeta de credito=blocked');
            expect(parsed.casePart).toBe('Pago con tarjeta de credito');
            expect(parsed.newStatus).toBe('blocked');
        });

        it('should strip provider type prefix', () => {
            const parsed = parseSpec('github_testcase.cuenta/login.case.feature::@tc-1=passed');
            expect(parsed.featurePart).toBe('cuenta/login.case.feature');
            expect(parsed.casePart).toBe('@tc-1');
        });

        it('should detect whole file for linking', () => {
            const parsed = parseSpec('checkout.case.feature', { command: 'link' });
            expect(parsed.isWholeFile).toBe(true);
            expect(parsed.featurePart).toBe('checkout.case.feature');
        });

        it('should abort on invalid status', () => {
            const pushSpy = vi.spyOn(logger, 'push').mockImplementation(() => {});
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
                throw new Error('process.exit');
            }) as any);

            expect(() => parseSpec('@tc-1=invalid_status')).toThrow('process.exit');
            expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                title: expect.stringContaining("Invalid status 'invalid_status'"),
            }));

            pushSpy.mockRestore();
            exitSpy.mockRestore();
        });
    });

    describe('matchesScenarioSpec & matchesStateKey (3 identity strategies)', () => {
        const scenario = {
            uri: 'auth/login.case.feature',
            name: 'Validar credenciales correctas',
            custom: { identity: '@tc-1' },
        };

        it('Strategy 1: Tag / ID match', () => {
            expect(matchesScenarioSpec(scenario, { casePart: '@tc-1' })).toBe(true);
            expect(matchesScenarioSpec(scenario, { casePart: 'tc-1' })).toBe(true);
        });

        it('Strategy 2: Scenario Title match', () => {
            expect(matchesScenarioSpec(scenario, { casePart: 'validar credenciales correctas' })).toBe(true);
        });

        it('Strategy 3: Full identity match', () => {
            expect(matchesScenarioSpec(scenario, { casePart: 'auth/login.case.feature::@tc-1' })).toBe(true);
        });

        it('should reject if featurePart does not match', () => {
            expect(matchesScenarioSpec(scenario, { featurePart: 'checkout.case.feature', casePart: '@tc-1' })).toBe(false);
            expect(matchesScenarioSpec(scenario, { featurePart: 'login.case.feature', casePart: '@tc-1' })).toBe(true);
        });

        it('should match state keys using 3 strategies', () => {
            const stateKey = 'auth/login.case.feature::@tc-1';
            const title = 'Validar credenciales correctas';

            expect(matchesStateKey(stateKey, title, { casePart: '@tc-1' })).toBe(true);
            expect(matchesStateKey(stateKey, title, { casePart: 'validar credenciales correctas' })).toBe(true);
            expect(matchesStateKey(stateKey, title, { casePart: '@tc-1', rawIdentifier: stateKey })).toBe(true);
            expect(matchesStateKey(stateKey, title, { featurePart: 'other.feature', casePart: '@tc-1' })).toBe(false);
        });
    });
});
