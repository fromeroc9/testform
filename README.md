<p align="center">
  <img src="assets/logo.svg" alt="Testform Logo" width="80" height="80" />
</p>

<h1 align="center">Testform</h1>

<p align="center">
  <strong>Declarative Test-as-Code Framework for Git & Testing Platforms</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fromeroc9/testform"><img src="https://img.shields.io/npm/v/@fromeroc9/testform/beta?style=flat-square&color=4F46E5&label=npm%20beta" alt="NPM Beta Version" /></a>
  <a href="https://fromeroc9.github.io/testform-docs/"><img src="https://img.shields.io/badge/docs-online-4F46E5?style=flat-square&logo=gitbook&logoColor=white" alt="Docs Online" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D%2018.0.0-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js Version" /></a>
  <img src="https://img.shields.io/badge/tests-43%20passed%20%7C%20356%20units-brightgreen?style=flat-square&logo=vitest&logoColor=white" alt="Test Status" />
  <a href="https://github.com/fromeroc9/testform-docs"><img src="https://img.shields.io/badge/portal-testform--docs-0284C7?style=flat-square&logo=astro&logoColor=white" alt="Docs Portal" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License" /></a>
</p>

---

**Testform** is a **declarative test orchestration engine** built on the **Test-as-Code (TaC)** paradigm with **zero mandatory SaaS servers and zero Test Drift**. It transforms your Git repository into an immutable, cryptographic QA ledger. Manage your entire testing lifecycle, declare test specifications as versioned Gherkin (`.feature`) code, plan speculative diffs, reconcile execution states across platforms, and review quality gates directly in Pull Requests.

---

## 📚 Documentation

Comprehensive guides, API specifications, and interactive references are hosted at our documentation portal:

👉 **[Official Testform Documentation Portal](https://fromeroc9.github.io/testform-docs/)**
- **Repository:** [fromeroc9/testform-docs](https://github.com/fromeroc9/testform-docs)
- **Quickstart & Guides:** Architecture, Providers, Multi-Cloud State, Target Scoping, and Modular Reporting.

---

## Prerequisites

Testform supports two operational modes depending on your team's workflow:

### 1. Local / Offline Mode (Zero Configuration)
If you configure `provider: local` and `backend: local`, **no external services, tokens, or credentials are required**. Testform works 100% offline out-of-the-box, storing your test management state locally in `testform.state` or committing it directly to Git.

### 2. GitHub Provider Mode (`provider: github`)
When synchronizing your test specifications with GitHub Issues and GitHub Projects, your repository and organization must meet the following prerequisites:

1. **GitHub Project (Projects V2):**
   - An active GitHub Project (organization or user level) linked to your target repository.
   - A single-select field named strictly **`Status`** containing the following exact option values:
     - `Todo`
     - `Done`
     - `passed`
     - `failed`
     - `blocked`
     - `skipped`
     - `unexecuted`

2. **Repository Labels:**
   - The repository requires the following 5 labels to categorize issues:
     - `bug`
     - `testcase`
     - `testplan`
     - `testreport`
     - `testrun`

3. **Authentication & Token Permissions:**
   - A **Personal Access Token (PAT)** with:
     - **Classic PAT:** `repo` (Full control of private repositories) and `project` (Read and write projects) scopes.
     - **Fine-Grained PAT:** Repository permissions (`Issues: Read and write`) and Organization permissions (`Projects: Read and write`).
   - Exported as an environment variable (e.g. `export GITHUB_TOKEN="ghp_..."`) or provided via `testform login`.
   - > **💡 GitHub Actions Note:** The default `GITHUB_TOKEN` provided by Actions lacks the necessary scopes to manipulate organization-level GitHub Projects (V2). Always configure a repository secret with a dedicated PAT (e.g., `secrets.TESTFORM_GITHUB_TOKEN`) so automated CI/CD pipelines can transition issues and sync project boards.

4. **🚀 Automated Setup Workflow (Recommended):**
   To automate the entire GitHub Project and label setup in seconds, we recommend using our automated **[Install Testform Labels and Project](.github/workflows/install.yml)** workflow. It will automatically:
   - Create the required repository labels (`bug`, `testcase`, `testplan`, `testreport`, `testrun`).
   - Clone the [Testform Template Project](https://github.com/users/fromeroc9/projects/4) into your organization or user account and link it to your target repository.
   - Configure the "Status" field with the correct options and standard QA colors.
   - Install the `close-issue.yml` workflow into your target repository to automate issue state transitions.

### 3. Optional Binary Drivers (Word & Excel)
For minimal CLI footprint (~1 MB), the binary document generators (`docx` and `exceljs`) are decoupled as optional peer dependencies. If you plan to generate Word (`.docx`) or Excel (`.xlsx`) reports, install them on demand:

```bash
npm install -g docx exceljs
# or locally in your project:
npm install --save-dev docx exceljs
```

---

## Installation

Testform is distributed as a global CLI tool via npm:

```bash
npm install -g @fromeroc9/testform@beta
```

Verify your installation:

```bash
testform -version
```

> **Note:** Testform requires **Node.js v18.0.0** or higher.

---

## Quickstart (TL;DR)

1. Initialize your workspace (generates the `main.yml` manifest and backend ledger):
   ```bash
   testform init
   ```

   This produces the root `main.yml` configuration:
   ```yaml
   testform:
     required_version: ">= 1.0.0"
     backend:
       local:
         path: "testform.state"

   provider:
     local: {}

   variable:
     app_url:
       type: string
       default: "https://www.saucedemo.com"
     environment:
       type: string
       default: "dev"

   local:
     base_url: "${var.app_url}"
     login_url: "${local.base_url}"

   scopes:
     testcase:
       match: "*.case.feature"
     testrun:
       match: "*.run.feature"
     testplan:
       match: "*.plan.feature"
   ```

2. Write declarative BDD tests with variables and locals (e.g., `login.case.feature`):
   ```gherkin
   @testcase
   Feature: User Login
     
     @tc-1 @smoke @auth
     Scenario: Valid Standard Login
       Given the user navigates to "${local.login_url}"
       When the user enters credentials "standard_user" / "secret_sauce"
       Then the system redirects to "${var.app_url}/inventory.html"
   ```

3. Validate, preview, apply, and report:
   ```bash
   # Validate syntax and configuration
   testform validate

   # Plan execution with variable overrides (optional)
   testform plan -var-file=staging.yml

   # Apply to local state or remote provider
   testform apply -auto-approve

   # Inspect state resources using dot notation
   testform state list
   testform state show local_testcase.login.case.feature.@tc-1

   # Generate multi-format execution reports (Markdown, Word, Excel, JSON, CSV)
   testform report testrun-summary -format=md
   testform report testcase-summary -format=docx -out=report.docx

   # Scope reports by target (individual test run or entire test plan)
   testform report testrun-summary -target=@tr-1
   testform report testplan-summary -target=@tp-1
   ```

---

## 🚀 Key Features

- **Test-as-Code Engine:** Declarative management for Testcases, Testruns, and Testplans using Gherkin.
- **Modular Reporting & Multi-Format Analytics (`testform report`):** Generates 9 multidimensional reports natively exported to Markdown, JSON, CSV, Word (`.docx`), and Excel (`.xlsx`) with `${...}` dynamic template markers, unified `-filter` queries, and zero-pollution autoloading from `.testform/reports/`.
- **Target Scoping (`-target`):** Granular scoping to single test runs or test plans with automated discovery of all linked runs and execution cases.
- **Terraform Diagnostic Standards:** All warnings and errors rendered in structured, colored HashiCorp Terraform diagnostic blocks (`╷ ... │ Error: ... ╵`).
- **5-Tier Variables Precedence:** Hierarchy spanning base `main.yml`, `variable.yml`/`local.yml`, domain modules, `-var-file`, and `-var` flags with multi-pass recursive interpolation.
- **100% Offline Capability:** Full local backend (`backend: local`) and mock provider (`provider: local`) for deterministic testing without external dependencies or tokens.
- **Terraform-grade State Management:** State locking, drift detection (`diff`), manual taint/untaint lifecycle, HCL resource display (`state show`), and dependency DAG rendering (`graph`).
- **Global Flags:** `-chdir=<path>`, `-no-color`, and `-compact-warnings` supported universally across commands.

---

For full documentation and API specifications, visit our **[Official Documentation Portal](https://fromeroc9.github.io/testform-docs/)**.
