# Propuesta de Valor: Testform
## Test Management as Code (TMaC) para la Era de la Integración Continua

---

### Resumen Ejecutivo

En el desarrollo ágil y los entornos de DevOps modernos, la infraestructura evolucionó hacia **Infrastructure as Code (IaC)** con herramientas como Terraform, permitiendo control de versiones, automatización y trazabilidad total. Sin embargo, la **gestión de pruebas (QA)** quedó rezagada en plataformas aisladas, manuales y costosas (Jira, TestRail, Zephyr, hojas de cálculo).

**Testform** introduce el paradigma **Test Management as Code (TMaC)**: la primera solución CLI declarativa que permite a los equipos de ingeniería y QA gestionar el ciclo de vida completo de pruebas directamente desde archivos Gherkin (`.feature`) versionados en Git, sincronizándolos automáticamente con plataformas de gestión como GitHub (y próximamente GitLab y Azure DevOps).

---

### 1. La Problemática del Mercado (Pain Points)

1. **Desincronización Crónica (Test Drift):**
   * Los casos de prueba en herramientas tradicionales se desactualizan rápidamente frente al código real de la aplicación.
   * No existe una fuente única de verdad: los desarrolladores ven el código y los QA ven tickets desfasados.
2. **Costos Elevados de Licenciamiento (TCO Excesivo):**
   * Las plataformas SaaS de gestión de pruebas cobran tarifas recurrentes por usuario (seat-based), encareciendo la escala para equipos medianos y grandes.
3. **Falta de Integración en el Pipeline CI/CD:**
   * Las pruebas se ejecutan de manera aislada; no hay una forma nativa de generar planes de cambio (`plan`) o aplicar actualizaciones (`apply`) de los casos de prueba dentro de un Pull Request.
4. **Dependencia y Bloqueo de Proveedor (Vendor Lock-in):**
   * Migrar entre herramientas tradicionales es prácticamente imposible o requiere scripts manuales propensos a errores.

---

### 2. La Solución: Testform (TMaC)

Testform traslada el flujo de trabajo estándar de la industria (IaC) al aseguramiento de calidad (QA), tratando a los casos de prueba como **recursos de infraestructura declarativos**.

```
  Git Repository (*.feature)
            │
            ▼
      [ testform plan ]      <-- Previsualiza altas (+), bajas (-) y cambios (~)
            │
            ▼
      [ testform apply ]     <-- Sincroniza atómicamente con GitHub / GitLab
            │
            ▼
   Plataforma de Gestión (Issues, Milestones, Labels)
```

#### Pilares de la Solución:
* **Single Source of Truth en Git:** Casos de prueba escritos en lenguaje natural (Gherkin) que conviven en el mismo repositorio del producto.
* **Flujo Declarativo Predecible:** `init` ➔ `validate` ➔ `plan` ➔ `apply`.
* **State Management Criptográfico:** Seguimiento de cambios mediante hashes SHA-256 (`testform.state`) con bloqueo concurrente (`state lock`) para evitar condiciones de carrera en pipelines paralelos.
* **Detección y Reconciliación de Deriva:** Detección en vivo de cambios no autorizados en la nube mediante `diff --remote` con resolución interactiva paso a paso (`-i, --interactive`).

---

### 3. Propuesta de Valor y Retorno de Inversión (ROI)

| Dimensión | Enfoque Tradicional (TestRail / Zephyr / Jira) | Con Testform (TMaC) | Impacto / ROI |
| :--- | :--- | :--- | :--- |
| **Fuente de Verdad** | Plataforma externa desacoplada de Git. | Archivos `.feature` en Git junto al código. | **100% trazabilidad** por Pull Request y commits. |
| **Actualizaciones** | Manuales ticket por ticket en interfaces web lentas. | Automáticas mediante `testform apply` en CI/CD. | **Reducción del 70%** en tiempo administrativo de QA. |
| **Detección de Deriva** | Inexistente; las discrepancias se descubren en auditorías. | `testform diff --remote` detecta desvíos al instante. | **Cero desincronización** entre pruebas y negocio. |
| **Costo por Usuario** | Facturación mensual/anual por cada QA y Dev ($$$). | Binario Open-Core / CLI sin costo por asiento. | **Ahorro de hasta un 80%** en licencias SaaS de QA. |
| **Vendor Lock-in** | Alto (formatos y bases de datos propietarias). | Nulo (estándar abierto BDD/Gherkin). | **Libertad tecnológica total**. |

---

### 4. Características Principales del Producto

#### A. Modelo Jerárquico de 3 Alcances (*Scopes*)
* **`testcase`**: Casos de prueba atómicos con etiquetas, asignados y campos personalizados.
* **`testrun`**: Ciclos de ejecución y regresión (ej. Smoke Tests, Sprint Run).
* **`testplan`**: Planes directores y matrices de cobertura funcional.

#### B. Motor de Deriva Interactiva (`diff --remote -i`)
Si un usuario edita un caso de prueba manualmente desde la interfaz web de GitHub, Testform lo detecta y ofrece tres caminos automatizados:
1. **PULL**: Actualiza el archivo `.feature` local con los cambios remotos.
2. **OVERWRITE**: Reafirma la autoridad de Git y sobreescribe la nube en el próximo `apply`.
3. **SKIP**: Mantiene la inspección sin realizar modificaciones destructivas.

#### C. Motor Avanzado de Búsqueda y Extracción (`query`)
Permite a desarrolladores, QAs y bots de CI/CD consultar el estado de las pruebas en segundos:
```bash
# Consultar casos de prueba abiertos con etiqueta smoke en formato JSON
testform query -s testcase --status open --label smoke --json

# Contar recursos asignados a un release específico
testform query --milestone "Release 2.4" --count
```

#### D. Adopción Sin Fricción (`import`)
Permite incorporar proyectos ya existentes mediante `testform import <address> <issueNumber>`. Si el caso no existe en local, Testform genera el archivo Gherkin automáticamente a partir del issue de GitHub.

#### E. Aislamiento Multi-Ambiente (`workspace`)
Soporte nativo para alternar entre diferentes entornos de pruebas (`qa`, `staging`, `production`) con estados completamente aislados.

---

### 5. Plan de Implementación y Adopción Gradual

1. **Fase 1: Diagnóstico e Importación (Semana 1)**
   * Inicialización con `testform init`.
   * Importación de issues y suites existentes en GitHub mediante `testform import`.
2. **Fase 2: Integración en CI/CD (Semana 2)**
   * Integración de `testform validate` y `testform plan` en GitHub Actions / GitLab CI ante cada Pull Request.
   * Validación automática de sintaxis y prevención de derivas.
3. **Fase 3: Adopción Total y Automatización (Semana 3+)**
   * Ejecución desatendida de `testform apply` en ramas principales.
   * Extracción de métricas y consultas automatizadas con `testform query` y `testform report`.

---

### 6. Próximos Pasos (Call to Action)

* **Demostración Técnica en Vivo:** Sesión práctica de 30 minutos mostrando el ciclo completo `plan` ➔ `apply` ➔ `diff --remote -i`.
* **Prueba de Concepto (PoC):** Despliegue guiado de Testform en un repositorio piloto en menos de 48 horas.
* **Contacto:** Equipo de Ingeniería y Producto Testform.
