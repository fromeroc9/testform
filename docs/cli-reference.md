# CLI Reference

The Testform Command Line Interface (CLI) is your primary tool for managing testing infrastructure. It follows a syntax very similar to HashiCorp's Terraform.

```bash
testform [global options] <command> [arguments]
```

## Global Options

These options can be used with any command, placed before the subcommand:
- `-chdir=DIR`: Switch to a different working directory before executing.
- `--projectId=ID`: Override the GitHub Projects V2 ID (useful for monorepos with multiple project boards).
- `-help`: Show help output.
- `-version`: Show the current Testform version.

---

## Core Workflow Commands

### `init`
Initializes a new or existing Testform working directory by creating the necessary configuration files (`testform.json`) and preparing the local backend.
*Run this command first on any new project.*

**Options:**
- `-backend=false`: Force the backend to use the 'local' configuration, ignoring any remote backend configured in `testform.json`.
- `-backend-config=path`: Dynamically inject or override configuration values for a remote backend. This can be a 'key=value' format or a path to a file, and can be specified multiple times. Useful for passing sensitive credentials or dynamically changing environments (e.g., `-backend-config="sas_token=..."`).
- `-reconfigure`: Reconfigure a backend, ignoring any saved configuration.
- `-migrate-state`: Reconfigure a backend, and attempt to migrate any existing state.
- `-lock=false`: Don't hold a state lock during backend migration.
- `-lock-timeout=0s`: Duration to retry a state lock.
- `-no-color`: If specified, output won't contain any color.
- `-json`: If specified, machine readable output will be printed in JSON format.

**Example Input/Output:**
```bash
$ testform init

Initializing the backend...

Successfully configured the backend "local"! Testform will automatically
use this backend unless the backend configuration changes.

Initializing provider plugins...
- Finding latest version of testform/github...
- Installing testform/github v1.0.3...
- Installed testform/github v1.0.3 (signed by Testform)

Testform has been successfully initialized!
```

### `validate`
Checks whether the configuration (i.e., your `.feature` files and `testform.json`) is syntactically valid and complies with all defined policies. It ensures all required fields are present and that there are no schema errors before you run a plan.

**Options:**
- `-json`: Outputs the validation results and diagnostics in a structured JSON format, useful for CI/CD pipelines.
- `-no-color`: If specified, output won't contain any color.
- `-no-tests`: Skips the policy validation checks and only verifies that the files can be parsed correctly.
- `-test-directory=path`: Set the Testform test directory where `.feature` files are located (defaults to "tests").
- `-query="string"`: Acts as a search filter. Only validates scenarios whose name, tags, custom identity, or file path match the specified string (case-insensitive).
- `-fail-on-warnings`: If specified, the validation process will exit with a failure code (exit code 1) if any warnings are detected, even if there are no strict errors.

**Example Input/Output:**
```bash
$ testform validate -test-directory=./Magento
╷
│ Warning: Undeclared field 'type_of_test'
│ 
│   in /Magento/cart.feature:
│ The field 'type_of_test' is used but not declared in testform.json schema.
╵
Success! The configuration is valid, but there were some warnings.
```
*(Note: If you run with `-fail-on-warnings`, the same output would result in an exit code of 1 instead of a success message).*

### `plan`
Generates a speculative execution plan. It compares your local `.feature` files against the `testform.state` file and outputs exactly what actions it will take (e.g., creating 2 test cases, destroying 1, updating 1). **It will not modify GitHub.**

**Technical Behavior:**
- **Strict Case-Sensitivity:** The comparison between local configuration and the remote state is strictly case-sensitive. If your local file uses `@TestCase` and GitHub has `testcase`, a drift will be detected.
- **Handling Defaults:** If a field is not defined explicitly in your `.feature` file, Testform evaluates its inherited default from `testform.json` or the `Background`. If the remote state is missing this value, `plan` will correctly propose an update to apply your local default to GitHub, ensuring total state synchronization.

**Options:**
- `-out=path`: Write the plan to a file to guarantee exact execution during `apply`. The path is resolved relative to the `-chdir` directory.
- `-destroy`: Generate a plan to delete all tracked resources.
- `-replace=resource`: Force the replacement of a specific resource instance (e.g. `-replace="github_testcase.cart::@tc-01"`).
- `-refresh-only`: Only update the state to match the remote system, without proposing any local configuration changes.
- `-var="key=value"`: Set a variable in the Testform configuration.
- `-var-file=path`: Set variables from a file (e.g. `staging.json`). The path is resolved relative to the `-chdir` directory.
- `-target=resource`: Target a specific resource for planning (e.g. `-target="cart.feature::@tc-01"`).

**Example Input/Output:**
```bash
$ testform plan -out=plan.out

Acquiring state lock. This may take a few moments...
github_testcase.cart::@tc-01: Refreshing state... [id=testform-demo:169]

Testform used the selected providers to generate the following execution plan.
Resource actions are indicated with the following symbols:
  ~ update in-place
  + create

Testform will perform the following actions:

  # github_testcase.cart::@tc-01 will be updated in-place
  ~ resource "github_testcase" "cart::@tc-01" {
      ~ custom_fields   = {
          ~ "automate": "not apply" -> "ready"
            "priority": "@high"
        }
    }

Plan: 1 to add, 1 to change, 0 to destroy.

Saved the plan to: plan.out
```

### `apply`
Executes the actions proposed by a `plan`. It connects to GitHub via the GraphQL API, creates/updates/closes Issues, and securely updates your `testform.state` file to reflect the new reality.

If you run `apply` without passing a saved plan file, it will implicitly run a `plan` first and prompt you for interactive approval.

**Technical Behavior:**
- **Concurrency:** Uses a worker pool to execute GitHub API mutations in parallel (controlled by `-parallelism`), significantly speeding up bulk creations.
- **State Locking:** Acquires a lock on the state backend to prevent race conditions from concurrent executions.
- **Idempotency:** Only executes API mutations for fields that drifted from the state.
- **Immutability of Defaults:** If your local configuration relies on inherited defaults (e.g. `assignees: "fromeroc9"`) and GitHub lacks them, `apply` will actively push these defaults to GitHub to force the remote state to match your local design.

**Options:**
- `[PLAN]`: Provide a path to a pre-generated plan file (from `plan -out=path`). Testform will blindly execute this plan without prompting for confirmation.
- `-auto-approve`: Skip the interactive `yes/no` confirmation prompt (useful for CI/CD).
- `-parallelism=n`: Limit the number of concurrent API requests to GitHub (Default: `10`). Lower this if you hit GitHub secondary rate limits.
- `-destroy`: Instructs the apply to destroy all tracked infrastructure instead of creating/updating.
- `-replace=resource`: Force the replacement of a specific resource instance.
- `-state=path`: Custom path to read and save state (resolved relative to `-chdir`).
- `-backup=path`: Path to backup the existing state file before modifying. Set to `-` to disable backup.
- `-var="key=value"` / `-var-file=filename`: Inject variables just like in `plan`.
- `-compact-warnings`: Shows warnings in a compact summary rather than full detailed output.

**Example Input/Output (Applying a saved plan):**
```bash
$ testform apply plan.out

Acquiring state lock. This may take a few moments...

github_testcase.cart::@tc-01: Modifying... [id=testform-demo:169]
github_testcase.cart::@tc-01: Modifications complete after 3s [id=testform-demo:169]

Apply complete! Resources: 0 added, 1 changed, 0 destroyed.
```

### `destroy`
Convenience alias for `testform apply -destroy`. Soft-deletes (closes) all GitHub Issues managed by your current Testform workspace.

---

## Advanced Commands

### `report`
Generates multi-dimensional test analytics from your local state without needing to query GitHub.
*Usage:* `testform report <type> [options]`
*(See the [Reporting & Analytics](reporting-and-analytics.md) guide for full details on types and filters).*

### `refresh`
Updates the local `testform.state` file by querying the remote system (GitHub) to fetch the latest attributes of all tracked resources. 

If someone manually modifies an Issue title, label, or custom field directly in GitHub, the `refresh` command will pull those changes and update your state file. This allows subsequent `plan` commands to detect the "drift" between your local `.feature` files and the actual state in GitHub.

**Technical Behavior:**
- **Full Synchronization:** Updates all arrays (`labels`, `assignees`) and `custom_fields` to be an exact mirror of what exists on GitHub.
- **Strict Case-Sensitivity:** Arrays are evaluated with strict case sensitivity. If GitHub has changed a label from `TestCase` to `testcase`, the local state will be overwritten with `testcase`, triggering a drift upon the next `plan`.

**Options:**
- `-parallelism=n`: Limit the number of concurrent API requests to GitHub (Default: `10`).
- `-state=path`: Custom path to read and save state (resolved relative to `-chdir`).
- `-backup=path`: Path to backup the existing state file before modifying. Set to `-` to disable backup.
- `-lock=false`: Don't hold a state lock during the operation.
- `-lock-timeout=0s`: Duration to retry acquiring a state lock.
- `-compact-warnings`: Shows warnings in a compact summary rather than full detailed output.

**Example Input/Output:**
```bash
$ testform refresh

Acquiring state lock. This may take a few moments...
github_testcase.cart::@tc-01: Refreshing state... [id=testform-demo:169]
github_testcase.cart::@tc-02: Refreshing state... [id=testform-demo:165]

Refresh complete! Resources: 2 refreshed.
```

### `import`
Associates an existing GitHub Issue with a Testform resource, downloading its state and (optionally) generating the local Gherkin code.

*Usage:* `testform import <identity> <issue_number>`
*Example:* `testform import /Magento/login.feature::@Successful_login 145`

**Technical Behavior:**
- **Pure State Synchronization:** `import` fetches the Issue via REST and GraphQL APIs to store the absolute reality of GitHub into `testform.state`. If the remote issue lacks fields that are locally defined as *defaults*, the state will faithfully record that they are missing, allowing a subsequent `plan` to propose an update.
- **Intelligent Code Reconstruction (Smart Diffing):** If the identity you are trying to import does not exist in your local `.feature` file, Testform will reconstruct the Gherkin scenario automatically. 
  - It analyzes the `Background` of your file and the defaults in `testform.json`.
  - It omits labels or custom fields that are already inherited globally (maintaining your code DRY).
  - It injects missing `tags` above the scenario (`@tag`) and missing `keywords` inside the scenario (`* field key = value`).

### `diff`
Shows the drift between your local `.feature` files and your `testform.state`. This command is useful for a quick check to see what has changed locally before running a full `plan`.

**Options:**
- `[target...]`: Provide a specific directory to check for drift instead of the default test directory.
- `-test-directory=path`: Sets the base directory to scan for `.feature` files.

**Example Input/Output:**
```bash
$ testform diff

Drift Detection Report
════════════════════════════════════════════════════════════
  ✓ /Magento/cart.feature::@tc-01: synced [id=testform-demo:169]
  + /OpenCart/account.feature::@tc-01: new (not applied)
  ~ /Magento/checkout.feature::@tc-02: modified_locally

Summary:
  ✓ 1 synced
  + 1 new (not applied)
  ~ 1 modified_locally
```

### `fmt`
Rewrites all `.feature` files to a canonical format and style. It normalizes indentation, spacing, and Gherkin keywords alignment to ensure consistency across the repository.

**Options:**
- `[target...]`: Specify a directory to format instead of the default.
- `-list=false`: Don't list the files that were formatted.
- `-write=false`: Don't actually save changes to the files (useful with `-check`).
- `-check`: Exit with status code 3 if any file needs formatting (ideal for CI/CD pipelines).
- `-recursive`: Process files in subdirectories. By default, only the target directory is processed.

**Example Input/Output:**
```bash
$ testform fmt -recursive
/Users/fromero/Desktop/terrahub-demo/OpenCart/checkout.feature
```

### `login`
Authenticates Testform with your GitHub account. It uses the OAuth device flow to securely generate and store a personal access token locally.

**Options:**
- `[hostname]`: The GitHub Enterprise hostname to authenticate against. Defaults to `github.com`.

**Example Input/Output:**
```bash
$ testform login
First, copy your one-time code: 0F42-BEEF
Then press Enter to open github.com/login/device in your browser...
✓ Authentication successful! Token saved locally.
```

### `logout`
Removes the locally-stored credentials for a remote host that were generated by the `login` command.

**Options:**
- `[hostname]`: The GitHub Enterprise hostname to log out from. Defaults to `github.com`.

### `graph`
Generates an ASCII dependency graph showing the relationship between your Test Plans, Test Runs, and Test Cases.
*Options:*
- `-draw-cycles`: Highlights dependency edges with colors.

**Technical Behavior:**
- **Accurate Topology:** El motor de grafos detecta si un caso de prueba (`testcase`) está vinculado a un plan o run de prueba (`testrun`/`testplan`) o si fue importado remotamente, renderizando flechas direccionales adecuadas y codificando los nodos con íconos e identificadores (como id, tags o ramas).

### `workspace`
Te permite manejar múltiples archivos de estado independientes dentro del mismo directorio de proyecto. Esto es increíblemente útil si quieres probar tus features de Gherkin en diferentes ambientes sin que colisionen entre sí (ej. `staging` vs `production`). Cada workspace mantiene su propio archivo `testform.state` aislado físicamente bajo la carpeta `.testform.state.d/`.

Subcomandos principales:
- **`workspace new <nombre>`**: Crea un nuevo workspace y cambia automáticamente a él. El nuevo workspace nace con un estado **completamente vacío**, listo para crear una infraestructura (issues) paralela y aislada en GitHub.
- **`workspace list`**: Imprime la lista de todos los workspaces creados. El workspace actualmente activo estará marcado con un asterisco (`*`).
- **`workspace select <nombre>`**: Cambia el apuntador al workspace especificado. El siguiente comando `plan` o `apply` que corras actuará sobre el estado y ambiente de ese workspace.
- **`workspace show`**: Imprime el nombre del workspace actualmente activo.
- **`workspace delete <nombre>`**: Elimina la carpeta de estado del workspace y lo borra permanentemente. (No puedes borrar el workspace `default` ni el workspace en el que estás actualmente activo).
### `state`
Es el comando principal para la manipulación avanzada del archivo de estado (`testform.state`). El estado es la "memoria" de Testform; aquí vincula tus archivos locales de Gherkin con los issues reales en GitHub.

Subcomandos principales:
- **`state list`**: Imprime una lista plana con las direcciones de todos los recursos actualmente rastreados.
- **`state identities -json`**: Imprime un arreglo JSON puramente con los IDs de los recursos. Esencial para integraciones con scripts o CI/CD.
- **`state show <dirección>`**: Muestra en consola todos los atributos de un recurso específico utilizando una sintaxis HCL pura, alineando los signos de igual `=` y usando bloques Heredoc `<<-EOT` para strings multilinea como Gherkin.
- **`state rm <dirección>`**: Elimina un recurso del estado (hace que Testform deje de rastrearlo) sin borrarlo de GitHub.
- **`state mv <origen> <destino>`**: Renombra un recurso en el estado. Útil si cambiaste el nombre de un feature localmente y no quieres que Testform lo destruya y lo vuelva a crear en GitHub.
- **`state pull` / `state push`**: Extraen o fuerzan una sobrescritura del estado remotamente.

*Nota técnica:* Todos los subcomandos de `state` validan que el archivo de estado exista antes de ejecutarse (usando el método `exists()` de tu backend).

### `taint` / `untaint`
Control manual sobre el ciclo de vida de los recursos en tu archivo de estado.

- **`taint <dirección>`**: Marca manualmente un recurso en el estado como "corrupto" o "no funcional" (`tainted = true`). En el siguiente `plan` o `apply`, Testform forzará la destrucción completa de este recurso y creará uno nuevo en su lugar. Es muy útil si un issue en GitHub quedó en un estado irrecuperable y necesitas recrearlo desde cero.
- **`untaint <dirección>`**: Quita la marca de "corrupto". Útil si usaste `taint` por error o si lograste arreglar el problema del issue manualmente en GitHub y ya no necesitas que Testform lo re-cree.

**Options:**
- `-allow-missing`: Si se especifica y el recurso no existe en el estado, el comando finalizará con éxito (exit code 0) en lugar de arrojar error. Ideal para automatizaciones en CI/CD donde no quieres que un script falle si el recurso ya había sido eliminado.

### `show`
A diferencia de `state show` (que muestra cómo se ve un recurso individual crudo en el archivo de estado), el comando global `show` lee y muestra todo tu archivo de estado actual de manera tabulada y amigable, o lee un archivo de plan guardado previamente y te muestra exactamente qué acciones se realizarán.

**Technical Behavior:**
- **Planes guardados:** Cuando le pasas la ruta a un archivo `.out` o `.json` generado por `plan -out=path`, `show` te desglosará todos los cambios (add, change, destroy, replace) utilizando el mismo motor de renderizado avanzado HCL (HashiCorp Configuration Language), alineando atributos a la perfección.
