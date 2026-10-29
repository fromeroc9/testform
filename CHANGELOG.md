# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0-beta.2.2] - 2026-10-29

### Added

#### ⚖️ Rollup Verdict Engine (`calculateRollupVerdict`)
- **Automated Execution Status Resolution:** Built-in verdict aggregation for `testrun` and `testplan` resources based on strict QA priority rules:
  1. `failed`: If any child execution is failed, the run/plan evaluates to `failed`.
  2. `pending`: If any child is pending, blocked, skipped, or unexecuted (and none failed), evaluates to `pending`.
  3. `passed`: Evaluates to `passed` strictly when 100% of child executions have passed.
- **Dynamic Plan Verdict Rollup:** `testplan` evaluates linked `testruns` in the active state to compute consolidated plan verdicts.

#### 🗜️ Compact Provider-Agnostic State Linkage
- **Lightweight State Maps:** Replaced verbose duplicate arrays with direct key-value maps:
  - `testcases: Record<string, string>` on `testrun` (e.g. `{"Magento/cart.case.feature.@tc-01": "passed"}`).
  - `testruns: Record<string, string>` on `testplan` (e.g. `{"testruns/Magento-xxx.run.feature": "failed"}`).
- **Universal Provider `metadata` Container:** Introduced generic `metadata: Record<string, any>` attribute across execution resources for adapter-specific data, omitting empty objects to keep state size minimal.

### Changed & Refactored

#### 🧹 Eradication of Legacy Status Comments
- **Removed Issue Comment Sync:** Deprecated GitHub issue comment creation during `apply`; testcase execution tracking is now centralized directly within the testrun issue body and state attributes.
- **Cross-Platform Path Normalization:** Unified Windows (`\`) and POSIX (`/`) separator handling across `resources.ts`, `templates.ts`, and `selector.ts`.
- **Target Selector Refinement:** Updated `matchesTarget()` to automatically strip scenario/identity tags (`.@tc-X`, `.@tr-X`) during feature-level target matching.

- **Terraform-Compliant Resource Addressing (provider.resource.shortidentity):** Standardized plan, apply, and refresh logs to display addresses as provider.resource.shortidentity (e.g. github.testcase.customer.case.feature.@tc-01). Eradicated non-standard feature title brackets (# [Feature Name].) and stripped directory path clutter from resource blocks and drift warnings.

### Removed
- **Deprecated `testcaseCommentIds`:** Removed comment ID tracking from testrun state schema while preserving transparent backward compatibility for legacy state reads.

## [1.1.0-beta.2] - 2026-10-27

### Added

#### 🎯 Comprehensive `-target` CLI Standard & Scope Eradication
- **Universal Target Selector:** Standardized `-target` flag across all core workflow and inspection commands (`validate`, `plan`, `apply`, `diff`, `destroy`, `refresh`), replacing legacy scope-based targeting.
- **Hierarchical Target Resolution:**
  - **Resource Scope:** `-target=testcase`, `-target=testrun`, `-target=testplan` isolates execution exclusively to that resource type across the workspace.
  - **Specification File:** Direct file targeting (e.g. `-target=tests/testrun/smoke.run.feature` or `-target=modules/auth/login.case.feature`).
  - **Identity Tags:** Direct tag targeting (e.g. `-target=@tc-1`, `-target=@tr-smoke`, `-target=@tp-release1`).
  - **Terraform Canonical Addresses:** Full support for Terraform-style addresses (e.g. `-target=testcase.modules/auth/login.case.feature.@tc-1` or `-target=github_testcase.modules/auth/login.case.feature.@tc-1`).
- **Cross-Platform Path Normalization:** Standardized `matchesTarget()` to seamlessly resolve both Windows backslashes (`\`) and POSIX forward slashes (`/`).
- **Target Scope Auto-Inference:** Introduced `detectScopeFromTarget()` to automatically infer target scope from file naming conventions (`.case.feature`, `.run.feature`, `.plan.feature`), identity prefixes (`@tc-`, `@tr-`, `@tp-`), or explicit resource keywords.

#### 📜 Official Terraform Parity for `testform validate` Help
- **HashiCorp Parity Documentation:** Updated `HELP_VALIDATE` to mirror HashiCorp Terraform's official `validate` command help structure and option catalog.
- **Explicit Target Documentation:** Added `-target=resource` flag description, highlighting both resource scope (`-target=testcase`) and specific file examples.
- **Updated `diff` Help:** Added `-target=resource` to `HELP_DIFF`.

#### 🔗 Multi-Dependency Gherkin Directives (`@depends_on`)
- **Array & Comma-Separated Directives:** Added full support for multi-dependency expressions in Gherkin `@depends_on` tags (e.g. `@depends_on("auth/login.case.feature.@tc-1", "inventory/catalog.case.feature.@tc-4")`).
- **Robust DAG Graph Construction:** Clean dependency parsing supporting both array bracket notation and comma separation for execution graphs and dependency sorting.

#### 🔒 Local Backend Lock Introspection (`getLockInfo`)
- **State Lock Introspection:** Implemented `getLockInfo()` in `LocalBackend` to inspect lock metadata (`lockId`, `timestamp`, `holder`) during lock contention and automated timeouts.

#### 🗄️ Backend Cache Relocation (`.testform/cache/backend.json`)
- **Relocated Cache State:** Moved `backend.json` into `.testform/cache/backend.json` alongside `lock.json` and `data.json`.
- **Seamless Backwards-Compatible Migration:** Added automatic fallback to read legacy `.testform/backend.json` if present and safely remove it upon writing the updated cache file.

### Changed & Refactored

#### 🧹 Eradication of Global `-scope` and Scope Retrocompatibility
- **Removed Global `-scope`:** Eliminated `-s, --scope <scope>` from the CLI root command and global options.
- **Purged Legacy `getScope()`:** Completely removed `getScope()` calls from `src/index.ts` across `plan`, `apply`, `refresh`, `diff`, `destroy`, `query`, `ephemeral`, `import`, `print`, and `graph`.
- **Optional Scope in Command Signatures:** Made `scope?: IScope | 'all'` optional across `PlanCmdOptions`, `ApplyCmdOptions`, `RefreshCmdOptions`, `DestroyCmdOptions`, and `DiffCmdOptions`. Commands resolve their execution scopes dynamically via `resolveScopes(scope, target)`.
- **Preserved Only Where Subcommand-Local:** Kept `--scope` strictly where documented as local subcommand options (`testform policy --scope <scope>` and `testform suite init --scope <scope>`).

#### 📐 Module & Lifecycle Terraform Parity
- **Canonical `variable:` in Modules:** Replaced legacy `vars` with canonical `variable` in Gherkin `@module(...)` tags and YAML manifests.
- **Elimination of `vars` Retrocompatibility:** Removed obsolete `vars` fallback in Gherkin parser to enforce clean Terraform syntax standards.
- **Resource Lifecycle Meta-Arguments (`lifecycle:`):** Standardized lifecycle meta-arguments (`prevent_destroy`, `ignore_changes`, `create_before_destroy`) under `resource: <type>: lifecycle:` in YAML manifests.

#### 📊 State Ledger Versioning & Metadata Streamlining
- **Canonical State Format:** Aligned state structure with `version: "1.0"`, `lineage`, `lastSync`, and `provider` metadata.
- **Cleaned State Attributes:** Stripped redundant execution summaries from the state ledger for exact Terraform state parity.

#### 🛡️ Diagnostic & Logger Polish
- **Duplicate Error Logging Suppression:** Added tracking to prevent duplicate error diagnostic logs across execution catch blocks.
- **State Lock Failure Messages:** Enhanced error output for lock acquisition failures with clear, actionable resolution commands (`testform force-unlock`).

#### 🌐 Declarative Data Sources Engine (`data:` Block & Terraform Parity)
- **First-Class HTTP Data Source (`data.http`):** Declarative REST API integration in `data:` supporting both `GET` and `POST` methods without requiring external curl/fetch steps.
- **Compact Inline Auto-Detection (Zero Boilerplate):**
  - Scalar URLs starting with `http://` or `https://` are auto-classified as `http` data sources (`github_user: "https://api.github.com/users/octocat"`).
  - Scalar paths ending in `.json`, `.yaml`, `.yml`, or `.csv` are auto-classified as `local_file` fixtures (`users: "fixtures/users.json"`).
  - Feature file paths and tags (`auth/login.case.feature.@tc-1` or `@tc-smoke`) are auto-classified into `testcase`, `testrun`, or `testplan`.
- **Advanced HTTP Request Customization:** Native support for `headers` / `request_headers`, `body` / `request_body` (auto-serialized to JSON), and `timeout`.
- **Auto-Parsed JSON & Terraform Attributes:** Parsed JSON properties are blended directly into the root object (`${data.user.login}`), alongside standard Terraform attributes (`status_code`, `response_body`, `response_headers`, `url`, `id`).
- **In-Memory Lifecycle Caching:** Automatic memoization of HTTP queries during command execution.

#### 🔀 Multi-Scenario Matching & Terraform Splat Expressions (`.*` / `[*]`)
- **Array Resolution on Multi-Matches:** When a data source address or tag matches multiple scenarios (e.g. `suites/smoke.run.feature.@tr-smoke` or `@smoke`), it returns a native array of scenario objects; single matches return the single scenario object directly.
- **Terraform Splat Expressions:** Added support for extracting attributes across all matched elements via `${data.<source>.*.<field>}` and `${data.<source>[*].<field>}` (e.g. `${data.smoke_suite.*.title}` returns an array of all matched titles).
- **Collection Functions Integration:** Full compatibility of splat arrays with collection functions such as `join(", ", data.smoke_suite.*.title)` and `length(data.smoke_suite)`.

#### 🧩 CLI Parity: Providers & Modules Commands
- **`testform providers` Tree & Subcommands:**
  - `testform providers`: Prints a tree of provider requirements across modules.
  - `testform providers lock`: Updates lock files based on origin registries, supporting `-fs-mirror`, `-net-mirror`, `-platform`, `-enable-plugin-cache`, `-test-directory`, `-var`, and `-var-file`.
  - `testform providers mirror`: Generates local mirrors of provider packages and JSON indices.
  - `testform providers schema`: Displays provider schemas in human-readable or machine-readable JSON format.
- **`testform modules` Command:** Added `testform modules` with `-json`, `-var`, and `-var-file` flags to list declared modules and their resolved versions.

#### 🔍 `testform show` Command Parity
- **Execution Plan & State Inspection:** Standardized `testform show [options] [path]` to inspect either saved execution plan files (`testform show tfplan`) or the current state ledger (`testform show`).
- **Machine-Readable JSON Output:** Added full support for `-json` flag across both plan inspection and state dumps.

#### 🗄️ Isolated Cache Architecture (`.testform/cache/`)
- **Generated File Segregation:** Centralized all generated temporary state and dependency locks (`lock.json`, `data.json`) inside `.testform/cache/`, safeguarding user-authored scripts in `.testform/policies/`, `.testform/resources/`, and `.testform/reports/` from accidental modification or erasure.

### Changed & Refactored

#### 📐 Configuration Schema Canonicalization (`main.yml`)
- **Block Name Alignment with Terraform Conventions:**
  - `locals:` (plural, matching Terraform `locals { ... }`): Canonical property inside `main.yml`, referenced via `${local.<name>}` and loaded from `locals.yml` or `local.yml`.
  - `output:` (singular, matching Terraform `output "name" { ... }`): Canonical property inside `main.yml` and child modules, eliminating legacy plural `outputs:`.
  - `module:` (singular, matching Terraform `module "name" { ... }`): Canonical property inside `main.yml` and domain YAML files, eliminating legacy `modules:`. Modules accept native direct arguments directly in YAML (e.g. `user: "admin"`), support explicit `variable:` blocks, and `@module` tags use `@module(..., variable={...})`.
  - `variable:` (singular, matching Terraform `variable "name" { ... }`): Canonical property inside `main.yml`, `variables.yml`, and domain files.
  - `resource:` (singular, replacing legacy `scopes:`, `scope:`, `fields:`, and `conventions:`).
  - `policy:` (singular, replacing legacy `policies:`).
  - `backend:` (object map style: `backend: local: {}`).
- **No Artificial Dedicated Files:** Eliminated mandatory special-case handling for `module.yml`; Testform automatically discovers `module:`, `data:`, `output:`, `locals:`, `variable:`, and `resource:` blocks across `main.yml` and any modular domain YAML files (`findDomainConfigFiles`), mirroring Terraform's multi-file discovery model.
- **CLI Policy Sync:** `testform policy enable <id>` and `testform policy disable <id>` now directly update the `policy: disabled: [...]` array inside `main.yml`.
- **Command Engine Refactoring:** Updated all core CLI commands (`apply`, `destroy`, `diff`, `import`, `plan`, `policy`, `query`, `refresh`, `show`, `suite`, `output`) to consume the standardized `resource:`, `policy:`, `locals:`, `module:`, `output:`, and `backend:` schema without legacy pollution.

#### 🧹 Resource Boundary Cleanliness
- **Strict Canonical Resource Boundary:** Resources are strictly limited to the 3 BDD testing artifacts: `testcase`, `testrun`, and `testplan`.
- **Eradication of `commit` Resource & `extendResource`:** Completely removed obsolete `commit` resource and `extendResource` API. Declarative field additions are managed cleanly via `resource: <type>: fields:` in YAML, and custom provider templates via `registerResource()`.

---

## [1.1.0-beta.1] - 2026-10-26

### Added

#### 🎯 Target Scoping for Reports (`testform report -target`)
- **Granular Scoping:** Added `-target` option across the reporting engine to restrict outputs to a specific testrun (`-target=@tr-1` or `-target=sprint1.run.feature`) or an entire testplan (`-target=@tp-1`).
- **Automated Testplan Expansion:** When targeting a test plan (`testplan`), `StateQuery.filterByTarget` inspects `attributes.testruns`, recursively discovers all linked runs, and scopes the report to include all associated test cases and execution outcomes.

#### 📄 Dynamic Binary Reports: Word (`.docx`) & Excel (`.xlsx`)
- **Native Document Generation:** First-class support for compiling report metrics and tabular data into `.docx` and `.xlsx` files via the `--format` flag.
- **Dynamic Variable Syntax Parity (`${...}`):**
  - **Word (`.docx`):** Standardized dynamic placeholder replacement supporting `${report.title}`, `${title}`, `${date}`, `${total}`, `${passed}`, `${failed}`, `${var.<name>}`, `${report.<metric>}`, and `${table}` (with styled tables, borders, and alternating cell padding).
  - **Excel (`.xlsx`):** Dynamic cell interpolation for `${var.<name>}`, `${report.<metric>}`, and `${date}`, alongside automated `${table}` block anchoring with dynamic row and column generation.
- **On-Demand Driver Loading & Bundle Optimization:** Moved heavy binary packages (`docx` and `exceljs`) to optional peer dependencies dynamically resolved via `loadDriver()`, maintaining a lightweight binary footprint (~1.00 MB).
- **Official Testform Branded Word Template:** Built an official default Word template (`templates/report.docx`) featuring the Testform brand identity, vector-aligned logo, executive KPI metric summary cards, and clean table placeholders with zero external corporate data.

#### 🛡️ Terraform Diagnostic Standard for Reports & Formats
- **Standardized Error Diagnostics:** Replaced generic error text and raw exceptions across `formats.ts`, `loader.ts`, and `report.ts` with canonical HashiCorp Terraform diagnostic blocks (`logger.push` with `╷ ... │ Error: ... ╵`).
- **Actionable Diagnostic Guidance:** Detailed diagnostic boxes for missing optional dependencies (`npm install -g docx` / `npm install -g exceljs`), unrecognized report types (listing all available catalog options), unsupported formats, and missing custom template files.

#### 🌐 Provider URL Decoupling & English Catalog Descriptions
- **Dynamic Provider Link Resolution:** Replaced hardcoded GitHub issue URLs in `raw` and `defects` reports with dynamic `resolveItemUrl()`. Inspects `attributes.html_url` and `attributes.url`, safely returning `undefined` for `local` providers to prevent artificial URLs (e.g. `https://github.com/issues/0`).
- **Standardized English Catalog Descriptions:** All 10 core report descriptions in `src/reports/catalog.ts` translated to standard English for consistency with Testform CLI guidelines.

### Changed
- **CLI Reports Catch Block:** Integrated typed `TestformError` handling in `src/commands/report.ts` to prevent redundant error banners when diagnostics have already been pushed.
- **Raw Export Schema:** In `raw` report metadata, `url` and `issueUrl` are omitted/undefined for local provider resources, while maintaining backwards compatibility for remote providers.

### Fixed
- **Uncaught ENOENT on Missing Template:** Added explicit filesystem existence checks with Terraform diagnostic output when user supplies a nonexistent path via `-template`.
- **Casing Normalization in Metrics:** Preserved original key casing when generating markdown and text-based reports with custom KPI metrics.
- **Git History Privacy Purge:** Expunged confidential corporate templates from past commit history and rebuilt with official open-source brand assets.

---

## [1.1.0] - 2026-10-26

### Added

#### 📊 Modular Reporting & Multi-Format Analytics Engine (`testform report`)
- **Full Architecture Modularization:** Completely eradicated monolithic reporting code into an extensible, decoupled engine (`src/reports/`) separating data extraction (`collect`), formatting (`render`), and dynamic template patching.
- **Core Analytics Catalog (9 Reports + Raw):**
  - Scope Test Case: `testcase-summary`, `test-case-activity`.
  - Scope Test Run: `testrun-summary` (with passRate), `testrun-detailed`.
  - Scope Test Plan: `testplan-summary`.
  - Multi-Dimensional & Quality: `defects`, `traceability`, `coverage`, `two-dimensional`, and `raw`.
- **First-Class Core Formats:**
  - Native generation of Markdown (`md`), JSON (`json`), CSV (`csv`), Word (`docx`), and Excel (`xlsx`).
- **Standardized Dynamic Template Engine (`${...}`):**
  - Standardized Word (`.docx`) and Excel (`.xlsx`) template interpolation with native `${var.*}`, `${report.title}`, `${date}`, and `${table}` dynamic anchors, matching Testform variable conventions without disruption.
- **Unified Filtering & Grouping (`StateQuery`):**
  - Unified `-filter` flag across `query` and `report` supporting attribute pairs (`status=failed`, `label=@smoke`), custom fields from `main.yml` (`priority=high`), and inferred free-text search.
  - Added dynamic grouping via `-groupBy=<field>`.
- **Zero-Pollution Autoloading:**
  - Full Terraform parity with no config pollution in `main.yml`: automatically discovers and loads custom reports (`.testform/reports/*.ts`), custom formats (`.testform/reports/*.format.ts`), and project templates (`.testform/reports/report.docx`, `.testform/reports/report.xlsx`).
- **Comprehensive Documentation & Test Suite:** Added `docs/reports.md`, `docs/index.md`, and 9 end-to-end unit tests (`test/modular-reports.test.ts`).

#### 🏛️ CLI Core & Terraform Parity
- **Terraform Diagnostic Formatting:** Standardized all CLI error and warning outputs—including command-line syntax errors, unknown options, and missing arguments from the CAC parser—into HashiCorp Terraform diagnostic boxes (`╷ ... │ ... ╵`).
- **Global Flag `-no-color`:** Implemented consistent color suppression across all output streams in every CLI command (`init`, `plan`, `apply`, `validate`, `refresh`, `graph`, `state`, etc.).
- **Global Project Option Refactor:** Standardized the project identifier flag to `-project-id` across all commands (deprecating legacy `-projectId`).
- **Canonical Address Syntax:** Refactored resource address resolution across the engine, replacing legacy `::` syntax with canonical dot/tag identifiers (`auth/login.case.feature.@tc-1`).
- **Machine-Readable Version Inspection (`testform version -json`):** Enhanced the `version` command with a `-json` flag returning structured JSON containing `testform_version`, `platform`, `provider_selections`, and `testform_outdated` status.
- **Provider Dependency Lock Recording:** Automatically generates `.testform.lock.hcl` during `testform init` to record and lock provider selections and versions.

#### ⚙️ Configuration, Variables & Locals Engine
- **First-Class Variables (`vars.yml` & CLI Flags):**
  - Native loading of `vars.yml` and automatic discovery of `*.auto.vars.yml` / `*.vars.yml`.
  - Supported `-var 'key=value'` and `-var-file=filename` flags across `validate`, `plan`, `apply`, `refresh`, `query`, and `taint`.
  - Variable type enforcement, `enum` restriction validation, and custom declarative validations with `validation { condition = ..., error_message = ... }` blocks.
- **Locals Management (`local.yml` & `locals:`):**
  - Added support for reusable local values defined in `local.yml` or inline within `main.yml`.
  - Implemented recursive and cascading resolution for local expressions (`${local.<name>}`).
- **Interactive Variable Prompting (`-input=true`):**
  - Added the `-input=true` flag to `testform plan` and `testform apply` to interactively prompt for missing required variables.
  - Added `-detailed-exitcode` flag to return code `0` on no changes, `2` when changes are present, and `1` on error.

#### 🪣 Multi-Cloud Backends & Dictionary Mode
- **Zero-Type Dictionary Configuration:** Removed the mandatory `type:` field requirement in `main.yml`. Backends are now declared cleanly as dictionary keys: `backend.http:`, `backend.rest:`, `backend.custom:`, `backend.s3:`, `backend.azurerm:`, `backend.gcs:`, `backend.oci:`, `backend.github:`, `backend.local:`.
- **Native HTTP/REST Backend (`HTTPBackend`):**
  - Added native HTTP/REST remote state backend implementing distributed locking, health checks, dynamic `{workspace}` interpolation, and custom header authorization.
- **Dynamic Custom Backend (`CustomBackend`):**
  - Added dynamic backend loader capable of loading custom JavaScript/TypeScript classes from local files or npm packages via `source:`, passing free-form configuration options directly to the constructor.
- **Backend CLI Overrides (`-backend-config`):**
  - Added support for overriding backend settings via `-backend-config="key=value"` flags or external override files during `init`.
- **Cloud Storage Credential Diagnostics:** Added informative error diagnostics when AWS S3, Azure Blob Storage, GCS, or OCI credentials fail to resolve.

#### 🛡️ Quality Policy Governance (`testform policy`)
- **Policy Management CLI:** Added dedicated `testform policy` command without mandatory subcommands to list, audit, enable, and disable quality policies in a formatted table.
- **In-Place Configuration Persistence:** Flags `--enable <id>` and `--disable <id>` update `main.yml` in-place while preserving existing comments, indentation, and structure via AST document manipulation.
- **Policy Inspection & Filtering:** Added `--show <id>` for detailed policy introspection, `-s, --scope <scope>` for filtering by `testcase`, `testrun`, or `testplan`, and `--json` for CI/CD automation pipelines.
- **7 Built-in System Policies:**
  - `identity-required`: Enforces identity tags (`@tc-*`, `@tr-*`, `@tp-*`).
  - `identity-unique`: Verifies identity tag uniqueness within scope.
  - `no-feature-tags`: Restricts non-standard tags at the Feature level.
  - `required-fields`: Ensures required fields defined in configuration are present.
  - `required-gherkin`: Validates required Gherkin structure and keywords (`Given`, `When`, `Then`).
  - `undeclared-fields`: Warns about scenario fields not declared in configuration.
  - `duplicate-testruns-in-testplan`: Validates against duplicate testruns inside the same or across testplans.
- **Policy Auto-Discovery:** Automatically scans `.testform/policies/*.js` and shared modules `.testform/modules/**/policies/*.js`. Supports direct object exports, array exports, and factory functions (`({ registerPolicy }) => ...`).

#### 🧩 Custom Resources & Enterprise Module Governance
- **Enterprise Governance (200+ Projects):** Standardized cross-project sharing of policies, custom resource templates, and backends across hundreds of microservices using native `modules:` definitions, eliminating the need for custom `extends` syntax.
- **Custom Resource Templates (`registerResource`):**
  - Programmatic resource registration via `registerResource` and automatic discovery from `.testform/resources/*.js` and `.testform/modules/**/resources/*.js`.
  - Extensible scenario-to-field mapping (`fields`), computed attributes (`knownAfterApply`), and execution report comment hooks (`comments`).

#### 🗄️ State Management Suite (`testform state`, `taint`, `untaint`)
- **Advanced State Management (`testform state`):**
  - `identities`: Lists the identities of resources tracked in the state.
  - `list`: Lists resources recorded in the state.
  - `show <address>`: Displays detailed attributes of an instance in state.
  - `rm <address>`: Removes resource instances from state without destroying remote items.
  - `mv <src> <dst>`: Renames or moves a resource in state.
  - `pull`: Streams the active state to stdout.
  - `push`: Updates the remote state from a local file.
  - `replace-provider`: Replaces provider bindings across resources in state.
  - Automated timestamped backup generation before any state-modifying action.
  - Output formatted for Unix utilities (`grep`, `awk`).
- **Resource Tainting (`testform taint` & `testform untaint`):**
  - Manually marks or unmarks resources for recreation during subsequent execution plans.
  - Flags: `-allow-missing`, `-lock`, `-lock-timeout`, `-ignore-remote-version`, `-var`, `-var-file`.
- **Force Unlock (`testform force-unlock`):**
  - Safely breaks stuck distributed concurrency locks by lock ID.

#### 🛠️ Developer Tools & Subcommands
- **Graph Visualizer (`testform graph`):**
  - Multiple output formats: Graphviz DOT (`-format=dot`), Mermaid (`-format=mermaid`), ASCII Tree (`-format=tree`), with readable aliases `-format=console` and `-format=string`.
  - Added `-draw-cycles` flag for visual cycle detection in dependency DAGs.
- **Functions Inspection & Evaluator (`testform functions`):**
  - CLI documentation manual for built-in functions (`testform functions <name>`).
  - Added single-line expression evaluator flag `--eval "<expr>"`.
- **Code Formatter (`testform fmt`):**
  - Added `-diff` flag displaying formatting diffs in unified diff format.
- **Remote Infrastructure Querying (`testform query`):**
  - Overhauled command options: added `-var`, `-var-file`, `-generate-config-out=path`, `-json`, and `-no-color`. Removed legacy scope and filtering flags.
- **Provider Inspection (`testform providers`):**
  - Added command displaying provider requirement trees across configuration and modules.
  - Added subcommands: `lock`, `mirror`, and `schema`.
- **Multi-Provider Authentication (`testform login` / `testform logout`):**
  - Supported token acquisition and local secure credential storage for GitHub, GitLab, and custom providers.
- **Ephemeral QA Sandboxes (`testform ephemeral`):**
  - Ephemeral workspace lifecycle management: `up`, `down`, `list`, `show`.
- **Targeted Refresh (`testform refresh`):**
  - Added `-target=resource` flag for scoping refresh operations to specific resources and their dependencies.
- **Interactive Diffing (`testform diff`):**
  - Interactive prompt mode matching Terraform input queries; removed redundant `-scope` option.

#### 🧮 HCL-Style Expression Engine & Built-in Functions
- **Expression AST Evaluator:** Lexer, parser, and evaluator supporting `${...}` syntax, comparison operators, and ternary conditionals (`${cond ? a : b}`).
- **Standard Function Catalog:**
  - Strings: `lower`, `upper`, `trim`, `replace`, `split`, `join`.
  - Collections: `length`, `contains`, `keys`, `values`.
  - Encoding: `jsonencode`, `jsondecode`, `base64encode`, `base64decode`.
  - System: `uuid`, `timestamp`, `try`, `coalesce`, `file`.

#### 📦 Programmatic SDK (`@fromeroc9/testform`)
- Exported core SDK functions, classes, and types for Node.js/TypeScript developers:
  - Functions: `registerPolicy`, `registerResource`, `evaluateExpression`, `interpolateExpressions`.
  - Classes: `Config`, `State`, `VariableParser`.
  - Singletons: `policy`, `resource`.
  - Interfaces: `IBackend`, `IProvider`, `PolicyDefinition`, `PolicyRule`, `ResourceTemplate`, `ResourceField`, `EvaluationContext`, `ParserScenario`.

---

### Changed
- **CLI Error Handling:** Replaced uncaught exception dumps with structured, colored diagnostic boxes across all commands.
- **State Serialization Optimization:** Removed redundant body attributes and empty fields prior to persisting state, reducing file size and bandwidth consumption.
- **Concurrency Rate-Limiting:** Optimized batching and parallelism defaults for cloud providers to avoid secondary rate limits.

---

### Fixed
- **Policy Mock Compatibility:** Added defensive guards in `validate` and `plan` commands to prevent crashes when mock or partial policy objects are injected during testing.
- **Scenario Scope Matching:** Resolved path resolution and normalization issues when executing commands across nested subdirectories or with `-chdir`.
- **Provider Lock Resolution:** Fixed dependency recording during initialization to ensure lock files capture correct provider sources and version constraints.

## [1.0.17] - 2026-06-12

### Added
- **Testplan Duplicate Testruns Policy:** Added a policy rule `duplicate-testruns-in-testplan` that validates both local duplicate testruns inside the same testplan file and global duplicate testruns declared across different testplan files.

### Changed
- **Testrun Link Clean Up:** Removed the redundant title suffix from testrun checklist items in the generated testplan issue body (keeping only the clean `#<issue_number>` reference).

### Fixed
- **Testrun State Lookup:** Fixed a bug in `github_testplan` body generation where testrun matching failed due to comparing identities with rule tag suffixes (e.g. `::@tr-X`).

## [1.0.15] - 2026-06-10

### Added
- **GitHub API Resiliency:** Implemented automatic rate limit retries (handling `403` and `429` secondary rate limits) in the request pipeline. Reads the `retry-after` header to pause execution and retry up to 5 times. Added a custom `User-Agent: testform/<version>` to identify API requests.

### Changed
- **CLI Parallelism:** Reduced default parallelism limit from `10` to `3` for apply and refresh batches to prevent hitting GitHub secondary rate limits under concurrent operations. Updated help text and CLI documentation to match.

### Fixed
- **Custom Fields Mapping:** Excluded the internal `status` field (extracted from Gherkin `* link status` steps used for test case status tracking) from being sent to GitHub Projects V2 `custom_fields`, keeping it strictly internal and preventing conflicts with the project board's native `Status` field.
- **CLI Prefix Path Resolution:** Fixed folder path resolution issues when running the CLI tool from other directories using `npm run dev --prefix` or `-chdir`.

## [1.0.14] - 2026-06-08

### Changed
- **CLI Tools:** Refactored the `testform tool` command to leverage the native Testform `Parser` and `Config` engines instead of manual file discovery. This ensures target resolution respects existing configurations and prevents duplicate logic.

### Fixed
- **Gherkin Parser:** Fixed an issue where AST `Rule` nodes were being parsed as strings or `undefined` instead of objects, causing the `tool autocomplete` command to fail during scenario expansion.
- **Scope Matching:** Added safety checks to `matchesScope` to prevent crashes when scenarios lack a defined `uri` property.

## [1.0.13] - 2026-06-07

### Changed
- **CLI Architecture:** Migrated the CLI parsing logic to a custom `arg`-based implementation, restoring exact Terraform-style option parsing (e.g., `-scope testcase`, `testcase plan`) and detailed `-version` outputs.
- **Help Output:** Overhauled the help text formatting to strictly follow Terraform's CLI visual style, including proper indentation, alignment, and bold headers.

### Fixed
- **Security:** Resolved vulnerabilities in transitive dependencies (`undici` and `uuid`) by explicitly overriding their versions.
- **Node Types:** Fixed missing `@types/node` definition resolution during compilation.

## [1.0.12] - 2026-06-07

### Added
- **Gherkin Editor:** Added a Gherkin editor command and internal dependency support.

### Fixed
- **GitHub Projects:** Fixed concurrency and rate limit issues that caused project custom fields to be populated incompletely. Custom field mutations are now serialized and batched via GraphQL aliases. Added warnings for invalid 'Single Select' or 'Iteration' field mappings.
- **Generate Command:** Changed the default directory for generated feature files to be the root folder when no directory convention is specified, instead of defaulting to the scope name (e.g. `testrun`).
- **HTTP Client:** Handled `204 No Content` HTTP status code in the internal `teenyRequest` logic to prevent crashing on empty API responses.

## [1.0.11] - 2026-06-07

### Fixed
- **Generate Command:** Changed the default directory for generated feature files to be the root folder when no directory convention is specified, instead of defaulting to the scope name (e.g. `testrun`).
- **GitHub Projects:** Fixed concurrency and rate limit issues that caused project custom fields to be populated incompletely. Custom field mutations are now serialized and batched via GraphQL aliases. Added warnings for invalid 'Single Select' or 'Iteration' field mappings.

## [1.0.10] - 2026-06-06

### Fixed
- **Debug Command:** Fixed an issue where executing `testform debug` with an absolute file path inside the project directory would fail to match the scenario file. It now normalizes paths accurately.

## [1.0.9] - 2026-06-06

### Added
- **Debug Command:** Added a new dedicated \`debug\` command to assist developers in troubleshooting parsing logic. It accepts a specific feature file and a \`-format\` flag (either \`gherkin\` or \`testform\`) to output its JSON AST before or after Testform's internal filtering.
- **Generate Rule Support:** Enhanced the documentation for the \`generate\` command to properly describe the \`-rule\` flag, which injects Business Rule blocks (\`Rule: <name>\`) into newly generated feature files and validates their existence in the workspace.

## [1.0.8] - 2026-06-06

### Fixed
- **Project Fields:** Added support for reading Date and Number custom field types from GitHub Project V2 to prevent continuous drift detection on date and numeric fields.

## [1.0.7] - 2026-06-05

### Changed
- **Global Scope Discovery:** CLI commands (`plan`, `apply`, `refresh`, `destroy`, `diff`) now inherently scan all supported scopes (`testcase`, `testrun`, `testplan`) when the `-scope` argument is omitted, instead of defaulting solely to `testcase`. A warning is emitted when this global fallback is triggered.

### Fixed
- **State Locking:** Fixed a critical race condition where executing a command with `-lock=false` would incorrectly trigger `releaseLock()` and forcefully delete the `.lock` file held by another concurrent process.
- **Drift Detection:** Hardened `localHash` generation to ensure that resource identities rely strictly on the `Physical Path` and `Tag`. Volatile fields such as `Scenario Title` (for testcases) and `Feature Title` (for testruns/plans) are now stripped prior to computing hashes to prevent false drift detection.
- **Resource Targeting:** Refactored the `taint` and `untaint` commands to dynamically resolve targets across all resource types, removing the hardcoded limitation that only allowed targeting `github_testcase` resources.

## [1.0.6] - 2026-06-05

### Added
- **Authentication:** Native GitHub App Authentication. Supports configuring `appId`, `privateKey`, and `installationId` directly in `testform.json` or through local credentials for autonomous background authentication using `@octokit/auth-app`.

### Changed
- **CLI Commands:** `testform login` now features an interactive assistant to intuitively configure different GitHub authentication strategies (Tokens vs GitHub App credentials).

## [1.0.5] - 2026-06-05

### Added
- **Test Runs:** Added default test run description and implemented locale-aware sorting for test cases and resources.
- **Resource Adapters:** Updated resource adapter configuration and dependencies.

### Changed
- **CLI Commands:** Removed experimental `-expand` command and enforced implicit scenarios in testplans. Updated `apply` command to handle resource application logic.
- **Network Stack:** Upgraded underlying proxy agent and request libraries for improved network handling.
- **Reporting:** Formatted issue status comments using HTML tables.
- **Execution:** Updated resource handling and test case parsing logic for improved CLI execution.
- **Core Engine:** Updated target matching logic to normalize test case identifiers by handling path delimiters and alias formats.
- **Sync Logic:** Updated main issue body to reflect status changes during local file sync.

## [1.0.4] - 2026-06-05

### Fixed
- **Comments Status:** Fixed an issue where the testcase status fallback logic accidentally used the global testrun `Status` field rather than its independent execution status, causing Github comment tables to incorrectly show "Todo".
- **Gherkin Parser:** Fixed an issue where `* link status` could be incorrectly ignored when placed in the description of a Rule instead of a Background or Scenario block.
- **CLI Commands:** Fixed a bug causing `-expand` flag to fail with `Nothing to repeat` due to improper regular expression escaping when dealing with dummy `*` scenarios. It also has been removed from the `apply -h` help menu as it is an internal process.
- **Scenario Expansion:** Corrected `apply -expand` logic to expand all explicit testcases belonging to a Rule instead of generating a dummy `*` scenario. It also properly removes the wildcard placeholder from local `.feature` files during expansion.
- **CLI Options:** Fixed a critical bug in the arguments parser where short flags containing the equals sign (e.g. `-C="."`) were not properly mapped to their long flag equivalents (`--chdir="."`), causing arguments parsing to crash.
- **Documentation:** Clarified the help text for the `-var-file` option to correctly indicate it accepts `.json` and `key=value` formats rather than Terraform-specific `.tfvars`.
- **TestRun Formatting:** Refactored the core TestRun rendering pipeline to process and display all testcase comments and checklist bodies in strict alphanumeric order (e.g., `tc-1`, `tc-2`, `tc-3`), regardless of how they are defined in `.feature` files.
- **TestRun UI:** Updated the default markdown body generated for TestRuns to include professional tracker instructions indicating that statuses are updated dynamically via issue comments.
- **Resource Extensibility:** Exposed an optional `comments(scenario, context)` callback in the `ResourceTemplate` interface to formally delegate custom status-comment generation to resource registries rather than keeping the HTML string-building logic hardcoded in `apply.ts`.

## [1.0.3] - 2026-06-05

### Added
- **Generate Command:** Implemented the `testform generate` command to generate test scenarios automatically.
- **Reporting:** Implemented reporting logic for test cases and test runs.
- **Status Updates & Autocompletion:** `apply -set-status` now supports updating testcase statuses directly in your local `.feature` files (using the `* link status = <status>` syntax). It inherently autocompletes the target scenario locally if it was previously implicit, ensuring the file remains the single source of truth without manual intervention.
- **Mass Expansion:** Introduced the `-expand` flag to the `apply` command to explicitly inject all implicit scenarios into local `.run.feature` or `.plan.feature` files.
- **Project Mapping:** Added support for `number`, `date`, and `iteration` custom fields in GitHub Projects V2 mapping.
- **Documentation:** Added `docs/custom-plugins.md` to document how to use `registerResource` and `registerPolicy`.

### Changed
- **CLI Documentation:** Comprehensive update to `docs/cli-reference.md` adding detailed usage examples, variations, and combinations for all commands.
- **Build & Dependencies:** Updated build artifacts to include the latest dependency and proxy-agent logic.

### Fixed
- **State Migration:** Fixed duplicated and broken prompt text in `askMigrationApproval`.
- **CLI Output:** Replaced hardcoded "Acquiring state lock..." messages with standard constants.
- **CLI Help:** Fixed an issue where `testform graph -h` would not display the help text.
- **Input Validation:** The `apply` command now correctly throws `ERR_NO_INPUT_ALLOWED` when interactive input is disabled and `-auto-approve` is missing.
- **Codebase:** Cleaned up unused and orphaned exports across `src/commands` to improve module encapsulation.
- **Custom Fields:** Fixed an issue where `testform apply` would fail to send default `custom_fields` from `testform.json` to GitHub Projects V2 items during creation (`add`) and modification (`change`). It now correctly applies all computed fields to the GitHub project board instead of leaving them empty.


## [1.0.2] - 2026-06-04

### Fixed
- **State Management:** Fixed an issue where resources were forcefully removed from the local state and recreated from scratch if the corresponding GitHub issue was closed. Testform will now retain the identity and propose an in-place update for closed issues when local fields are modified.

## [1.0.1] - 2026-06-04

### Changed
- **Repository:** Updated repository URL and keyword from `testfrom` to `testform`.
- **Internal:** Removed legacy install script and updated `package-lock.json` dependencies.

## [1.0.0] - 2026-06-04

### Added
- **Initial Release:** First stable release of the CLI.
- **Test-as-Code Paradigm:** Introduced the ability to define Test Cases, Test Runs, and Test Plans using Gherkin (`.feature`) files.
- **Native GitHub Integration:** Full support for creating, updating, and syncing test cases as GitHub Issues and GitHub Projects V2 items.
- **State Management:** Implementation of `testform.state` to persistently track drift and link local features to remote GitHub issues.
- **CLI Commands:**
  - `init`: Bootstrap workspace configuration (`testform.json`).
  - `plan`: Preview dry-run changes before committing them to GitHub.
  - `apply`: Synchronize the local Gherkin state to the remote repository.
  - `report`: Generate execution, coverage, and traceability matrices.
- **Custom Mapping Engine:** Flexible configuration via `testform.json` to map tags (`@high`) and keywords (`* field assignees = @octocat`) to native GitHub fields.
- **Documentation:** Complete documentation portal in the `docs/` folder covering architecture, DSL, and quickstarts.
