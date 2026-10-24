import { test, expect } from '@playwright/test';

/**
 * Playwright E2E Test Suite
 * Mapeado directamente a features/e2e_todo.case.feature
 * 
 * En Testform:
 * - El tag @tc-e2e-001 vincula la especificación declarativa en Git con este test real.
 * - La URL se parametriza con la variable ${var.e2e_app_url}.
 */

test.describe('Gestión de Tareas en Aplicación Web TodoMVC', () => {

  test('@tc-e2e-001 Creación de una nueva tarea en TodoMVC', async ({ page }) => {
    // 1. Abrir la app web TodoMVC
    const appUrl = process.env.TF_VAR_e2e_app_url || 'https://demo.playwright.dev/todomvc';
    await page.goto(appUrl);

    // 2. Ingresar la tarea en el input
    const todoInput = page.locator('.new-todo');
    await todoInput.fill('Aprender Testform y Test-as-Code');
    await todoInput.press('Enter');

    // 3. Aserciones
    const todoList = page.locator('.todo-list li');
    await expect(todoList).toHaveCount(1);
    await expect(todoList.first()).toHaveText('Aprender Testform y Test-as-Code');
  });

  test('@tc-e2e-002 Marcar tarea como completada', async ({ page }) => {
    const appUrl = process.env.TF_VAR_e2e_app_url || 'https://demo.playwright.dev/todomvc';
    await page.goto(appUrl);

    // Crear tarea inicial
    const todoInput = page.locator('.new-todo');
    await todoInput.fill('Aprender Testform y Test-as-Code');
    await todoInput.press('Enter');

    // Marcar checkbox
    const checkbox = page.locator('.todo-list li .toggle');
    await checkbox.check();

    // Aserción de estado completado
    const completedItem = page.locator('.todo-list li.completed');
    await expect(completedItem).toBeVisible();
    await expect(page.locator('.todo-count')).toContainText('0 items left');
  });

});
