# Recursos y Lenguaje Declarativo

En TestForm, no utilizas el lenguaje HCL de Terraform. Utilizas **Gherkin puro**. Tus archivos `.feature` son la representación declarativa del estado deseado de tu infraestructura de pruebas.

Dependiendo del comando CLI (específicamente, la bandera `-scope`), TestForm interpretará tus archivos `.feature` de diferentes maneras. Existen tres "Scopes" principales, que equivalen a tres tipos de recursos en GitHub.

---

## Scope: Testcase (`github_testcase`)

Este es el nivel fundamental. Cada Escenario individual en Gherkin se convertirá en un Issue separado en GitHub.

**Archivos procesados:**
TestForm buscará archivos que terminen en `.case.feature` o que contengan el tag `@testcase` a nivel del Feature.

**Ejemplo de Recurso:**

```gherkin
@testcase @login
Feature: Flujo de Autenticación
  Como usuario, quiero ingresar al sistema para acceder a mi cuenta.

  @high
  Scenario: Login exitoso con credenciales correctas
    Given el usuario está en la página de login
    When el usuario ingresa un usuario válido
    And el usuario ingresa una contraseña válida
    Then el sistema muestra el dashboard principal
```

**Mapeo a GitHub:**
- **Título**: "Login exitoso con credenciales correctas"
- **Cuerpo**: Se generará un bloque Markdown con los pasos (Given/When/Then). La descripción del Feature se descarta a este nivel.
- **Labels**: TestForm heredará los tags: `login`, `high`. (Se omite `@testcase` y símbolos `@`).

---

## Scope: Testrun (`github_testrun`)

El scope de Testrun se utiliza para ejecutar las pruebas. TestForm agrupa *todos* los casos de prueba definidos dentro del mismo archivo `.feature` en una única unidad de ejecución (un único Issue de GitHub).

**Archivos procesados:**
Archivos que terminan en `.run.feature` o contienen el tag `@testrun`.

**Estructura Requerida:**
Para un Testrun, la estructura Gherkin debe usar la palabra clave `Rule` para vincular los casos de prueba ejecutados. TestForm inyectará automáticamente "Checklists" en el cuerpo del Issue en GitHub para que hagas seguimiento del estado.

**Ejemplo de Recurso:**

```gherkin
@testrun
Feature: Regresión Semanal V1.0
  Esta es la regresión correspondiente al sprint 1.

  Background:
    * assignees = "qa-lead"
    * milestone = "Sprint 1"

  Rule: login.case.feature
    Scenario: @[1]
      * link status = passed
    
    Scenario: @[2]
      * link status = failed

  Rule: checkout.case.feature
```

**Mapeo a GitHub:**
- **Título**: "Regresión Semanal V1.0"
- **Cuerpo**: Incluye la descripción ("Esta es la regresión..."). TestForm inyectará un bloque "Test Cases" con casillas de verificación enlazando a los Issues de GitHub generados previamente en el scope `testcase`.
- **Selección de Casos de Prueba**: 
  - Si declaras un **Scenario específico** bajo una Rule (ej. `Scenario: @[1]`), TestForm solo incluirá ese caso de prueba exacto (nota que se usa el ID único / Tag del caso de prueba, no su nombre completo).
  - Si **solo declaras la Rule** sin ningún escenario debajo (como el ejemplo de `checkout.case.feature`), TestForm **ejecutará e incluirá automáticamente todos los testcases** descubiertos en ese archivo.
- **Campos Custom**: Utilizando el bloque `Background`, TestForm asignará el Issue a `qa-lead` y lo moverá al milestone `Sprint 1`.
- **Estados y Comentarios**: TestForm leerá la variable `* link status` declarada en cada escenario. TestForm creará **comentarios** independientes dentro del Issue de Testrun para reportar el estado del testcase usando una tabla Markdown.

### Modo Imperativo (`--set-status`)
En lugar de modificar manualmente el archivo `.feature` para escribir `* link status = passed`, puedes automatizar esto usando el CLI de TestForm. Por ejemplo, en tu entorno de CI:

```bash
testform apply -scope testrun --set-status="Login exitoso con credenciales correctas=passed"
```

TestForm se encargará de inyectar o actualizar el paso `* link status = passed` directamente en el archivo `.run.feature` local (autocompletando el escenario explícitamente si era implícito) y de sincronizarlo con GitHub en el mismo comando. ¡Tú mantienes el control total local y remoto!

### Autocompletado Masivo (`--expand`)
Si has importado escenarios implícitamente solo declarando la regla (ej. `Rule: checkout.case.feature`) y deseas que TestForm haga explícitos todos los escenarios encontrados para un mejor control local, puedes usar el flag `--expand` durante un apply normal:

```bash
testform apply -scope testrun --expand
```
Esto modificará tu archivo `.run.feature`, inyectando cada `Scenario` detectado con un estado `* link status = pending` debajo de su respectiva `Rule`.

---

## Scope: Testplan (`github_testplan`)

El Testplan es el nivel superior. Agrupa múltiples ejecuciones (Testruns). Es ideal para un ciclo de pruebas complejo que involucra varios frentes.

**Archivos procesados:**
Archivos que terminan en `.plan.feature` o contienen el tag `@testplan`.

**Ejemplo de Recurso:**

```gherkin
@testplan
Feature: Release 2.0 Plan de Pruebas
  Ejecución consolidada para la salida a producción.

  Rule: regresion-pagos.run.feature
  Rule: regresion-login.run.feature
```

**Mapeo a GitHub:**
- **Título**: "Release 2.0 Plan de Pruebas".
- **Cuerpo**: TestForm escaneará tu `testform.state` buscando los Testruns declarados (ej. `regresion-pagos.run.feature`) e inyectará una checklist maestra en este Issue conectando las ejecuciones de manera jerárquica. Adicionalmente, TestForm utilizará la API nativa de "Sub-Issues" de GitHub para enlazar estructuralmente los testruns a este testplan maestro.
