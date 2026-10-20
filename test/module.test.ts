import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseModuleTag, resolveModulePath, loadModuleSteps } from '../src/core/module';
import { Parser } from '../src/core/parser';

describe('Feature and Scenario Modules (@module)', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-module-test-'));
    });

    afterEach(() => {
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should parse single and array module tags', () => {
        expect(parseModuleTag('@module(source="./auth.feature")')).toEqual(['./auth.feature']);
        expect(parseModuleTag('@module(source=["./m1.feature","./m2.feature"])')).toEqual(['./m1.feature', './m2.feature']);
        expect(parseModuleTag('@module("./auth.feature")')).toEqual(['./auth.feature']);
        expect(parseModuleTag('@notamodule')).toBeNull();
    });

    it('should resolve module steps from a module feature file', () => {
        const modFile = join(tmpDir, 'auth.feature');
        writeFileSync(modFile, `@testcase
Feature: Auth Module
  Scenario: Login
    Given el usuario esta en login
    When ingresa credenciales
    Then accede al sistema
`);

        const steps = loadModuleSteps(modFile);
        expect(steps.length).toBe(3);
        expect(steps[0].text).toBe('el usuario esta en login');
        expect(steps[1].text).toBe('ingresa credenciales');
        expect(steps[2].text).toBe('accede al sistema');
    });

    it('should inherit module steps in scenario with @module tag', () => {
        const modDir = join(tmpDir, 'modules');
        mkdirSync(modDir);
        const modFile = join(modDir, 'login.case.feature');
        writeFileSync(modFile, `@testcase
Feature: Login Helper
  Scenario: Do Login
    Given usuario autenticado
`);

        const mainFile = join(tmpDir, 'checkout.case.feature');
        writeFileSync(mainFile, `@testcase
Feature: Checkout E2E
  @tc-1
  @module(source="./modules/login.case.feature")
  Scenario: Pagar carrito
    When confirma la orden
    Then orden creada
`);

        const parser = new Parser(tmpDir);
        const scenarios = parser.content();
        const checkoutScenario = scenarios.find(s => s.name === 'Pagar carrito');

        expect(checkoutScenario).toBeDefined();
        // Should have inherited step + scenario own steps
        expect(checkoutScenario?.steps.length).toBe(3);
        expect(checkoutScenario?.steps[0].text).toBe('usuario autenticado');
        expect(checkoutScenario?.steps[1].text).toBe('confirma la orden');
        expect(checkoutScenario?.steps[2].text).toBe('orden creada');
    });

    it('should inherit only specific scenario steps when scenario id is specified via shorthand or argument', () => {
        const modDir = join(tmpDir, 'modules-targeted');
        mkdirSync(modDir, { recursive: true });
        const modFile = join(modDir, 'auth.case.feature');
        writeFileSync(modFile, `@testcase
Feature: Auth Helpers
  @tc-login
  Scenario: Do Login
    Given usuario logueado con credenciales

  @tc-register
  Scenario: Do Register
    Given usuario registrado en el sistema
`);

        const mainFile = join(tmpDir, 'account.case.feature');
        writeFileSync(mainFile, `@testcase
Feature: Mi Cuenta
  @tc-1
  @module(source="./modules-targeted/auth.case.feature::tc-login")
  Scenario: Ver perfil
    When consulta sus datos
    Then muestra su nombre
`);

        const parser = new Parser(tmpDir);
        const scenarios = parser.content();
        const profileScenario = scenarios.find(s => s.name === 'Ver perfil');

        expect(profileScenario).toBeDefined();
        // Should have 1 step from @tc-login, NOT from @tc-register, plus 2 scenario steps = 3 steps total
        expect(profileScenario?.steps.length).toBe(3);
        expect(profileScenario?.steps[0].text).toBe('usuario logueado con credenciales');
        expect(profileScenario?.steps[1].text).toBe('consulta sus datos');
        expect(profileScenario?.steps[2].text).toBe('muestra su nombre');
    });
});

