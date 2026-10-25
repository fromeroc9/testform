# Ejemplo Práctico: Testform con Automatización E2E, API y Performance

Este ejemplo demuestra de manera práctica y ejecutable **cómo se relaciona Testform con las herramientas de automatización reales** (Playwright para E2E, Fetch/Supertest para API y pruebas de carga para Performance).

---

## 🎯 La Pregunta Clave: ¿Por qué no es solo un gestor manual?

A primera vista, un archivo Gherkin (`Scenario:`, `Given`, `When`, `Then`) puede parecer un caso de prueba manual de Jira o TestRail. 

Sin embargo, en la arquitectura **Test-as-Code (TaC)**:
1. **Testform es el Plano de Control (Control Plane):**  
   - Define el **contrato declarativo** de la prueba (con IDs `@tc-*` y tags `@e2e`, `@api`, `@smoke`).
   - Gobierna las **variables de entorno y URLs** (`main.yml` o `variables.yml`).
   - Inyecta **datasets y fixtures** (`fixtures/todos.json` vía `${data.*}`).
   - Establece el **grafo de dependencias DAG** (`@depends_on("auth.@login")`).
   - Mantiene el **ledger autoritativo de estado** (`testform.state`).
2. **Los Test Runners son los Ejecutores de Código:**  
   - **E2E Runner (Playwright):** Abre el navegador web, hace clicks y verifica el DOM.
   - **API Runner:** Ejecuta llamadas HTTP (POST, GET) contra servicios REST reales.
   - **Performance Runner:** Dispara peticiones concurrentes y calcula percentiles de latencia (p95).
3. **El Provider de Testform gestiona la Plataforma de Casos:**  
   - Los **Providers** (`local`, `github`, `gitlab`) NO ejecutan navegadores ni sockets; su función es **versionar y sincronizar los casos de prueba, runs y estado en Git o en el issue tracker**.

---

## 🏗️ Estructura del Proyecto

```text
examples/todo-app/
├── main.yml                       # Configuración del proyecto, variables, data y outputs
├── fixtures/
│   └── todos.json                 # Dataset estructurado de tareas
├── features/
│   ├── e2e_todo.case.feature      # Casos de prueba declarativos E2E (@tc-e2e-001, @tc-e2e-002)
│   ├── api_todo.case.feature      # Casos de prueba declarativos de API (@tc-api-001, @tc-api-002)
│   └── perf_todo.case.feature     # Casos de prueba declarativos de Performance (@tc-perf-001)
├── runners/
│   ├── e2e/
│   │   ├── todo.spec.ts           # Script de Playwright (vinculado a @tc-e2e-001)
│   │   └── todo_e2e_runner.js     # Ejecutor autónomo E2E verificando TodoMVC
│   ├── api/
│   │   └── todo_api_runner.js     # Ejecutor real HTTP contra JSONPlaceholder
│   └── perf/
│       └── todo_perf_runner.js    # Ejecutor de carga concurrente midiendo p95 SLA
├── orchestrator.js                # Orquestador del ciclo completo (Plan -> Execute -> State)
└── testform.state                 # Ledger de estado persistido con evidencia de corrida
```

---

## 🔗 ¿Cómo se conectan los tres mundos?

### 1. Pruebas E2E (UI / Web)
- **En Testform:**
  ```gherkin
  @tc-e2e-001 @smoke
  Scenario: Creación de una nueva tarea en TodoMVC
    Given el navegador abre la URL "${var.e2e_app_url}"
    When el usuario ingresa la tarea "Aprender Testform y Test-as-Code"
  ```
- **En el Runner de Playwright (`runners/e2e/todo.spec.ts`):**
  ```typescript
  test('@tc-e2e-001 Creación de una nueva tarea en TodoMVC', async ({ page }) => {
    await page.goto(process.env.TF_VAR_e2e_app_url || 'https://demo.playwright.dev/todomvc/');
    await page.locator('.new-todo').fill('Aprender Testform y Test-as-Code');
    await page.locator('.new-todo').press('Enter');
    await expect(page.locator('.todo-list li')).toHaveCount(1);
  });
  ```

---

### 2. Pruebas de API (REST Público)
- **En Testform:**
  ```gherkin
  @tc-api-001 @smoke
  Scenario: Creación de tarea mediante POST HTTP
    Given el endpoint REST es "${var.api_base_url}/todos"
    When envío un POST con el título "${data.todos_fixture.buy_groceries.title}"
    Then la API responde con código de estado HTTP 201
  ```
- **En el Runner de API (`runners/api/todo_api_runner.js`):**
  Consume la fixture `fixtures/todos.json`, ejecuta `fetch('https://jsonplaceholder.typicode.com/todos', { method: 'POST' })`, valida HTTP 201 y captura el ID generado.

---

### 3. Pruebas de Performance (Carga y SLA)
- **En Testform:**
  ```gherkin
  @tc-perf-001 @load
  Scenario: Evaluación de latencia bajo peticiones concurrentes
    Given el endpoint objetivo "${var.api_base_url}/todos"
    When se ejecutan 15 peticiones concurrentes
    Then la latencia máxima p95 es inferior a ${var.perf_max_latency_ms} ms
  ```
- **En el Runner de Performance (`runners/perf/todo_perf_runner.js`):**
  Ejecuta 15 peticiones simultáneas, calcula el percentil 95 ($p95 \le 1500\text{ ms}$) y reporta si cumple con el SLA de calidad.

---

## 🚀 Cómo ejecutar este ejemplo

Desde la raíz de este proyecto:

```bash
node examples/todo-app/orchestrator.js
```

### Flujo de Ejecución en Consola:
1. **Plan & Validate:** Carga variables, datasets y valida el grafo acíclico (`@depends_on`).
2. **Dispatch Runners:** Dispara las pruebas reales de API, E2E y Performance.
3. **Persist State:** Genera y actualiza el ledger inmutable `testform.state` con la evidencia de ejecución y los outputs.
