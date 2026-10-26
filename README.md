<p align="center">
  <img src="docs/public/testform-logo.svg" alt="Testform Logo" width="80" height="80" />
</p>

<h1 align="center">Testform</h1>

<p align="center">
  <strong>Declarative Test-as-Code Framework for Git & Testing Platforms</strong>
</p>

---

**Testform** brings the **Test-as-Code** paradigm to your version control platforms. It transforms standard issue trackers (like GitHub) into full-fledged Test Management ecosystems. By treating your QA processes as code, it codifies issue APIs into declarative Gherkin (`.feature`) configurations that can be shared amongst team members, edited, reviewed in Pull Requests, and strictly versioned.

---

## 📚 Documentation

We have completely overhauled our documentation to be as intuitive and comprehensive as possible. 

**Start here:** 👉 **[Testform Documentation Portal (docs/index.md)](docs/index.md)** 👈

## Prerequisites

Testform supports two operational modes depending on your team's workflow:

### 1. Local / Offline Mode (Zero Configuration)
If you configure `provider: local` and `backend: local`, **no external services, tokens, or credentials are required**. Testform works 100% offline out-of-the-box, storing your test management state locally or committing it directly to Git.

### 2. GitHub Provider Mode (`provider: github`)
When synchronizing your test specifications with GitHub Issues and GitHub Projects, your repository and organization must meet the following prerequisites:

1. **GitHub Project (Projects V2):**
   - An active GitHub Project (organization or user level) linked to your target repository.
   - A single-select field named **`Status`** containing the following exact option values:
     - `Todo`
     - `Done`
     - `passed`
     - `failed`
     - `blocked`
     - `skipped`
     - `unexecuted`

2. **Repository Labels:**
   - The repository requires the following labels to categorize issues:
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
   - > **💡 GitHub Actions Note:** The default `GITHUB_TOKEN` provided by Actions lacks the necessary scopes to manipulate organization-level GitHub Projects (V2). Always configure a repository secret with a dedicated PAT so automated CI/CD pipelines can transition issues and sync project boards.

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

## Installation

You can install Testform directly onto your system using npm. It is distributed as a global Node.js package:

```bash
npm install -g testform
```

> **Note:** Testform requires Node.js v16 or higher to be installed on your system.

## Quickstart (TL;DR)

1. Create a `testform.yml` configuration file at the root of your project:
   ```yaml
   version: "1.0"
   provider: local
   backend: local

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
   ```

2. Initialize your workspace (backend ledger and providers):
   ```bash
   testform init
   ```

3. Write your Gherkin tests with variables and locals (e.g., `login.case.feature`):
   ```gherkin
   @testcase
   Feature: User Login
     
     @tc-1 @smoke @auth
     Scenario: Valid Standard Login
       Given the user navigates to "${local.login_url}"
       When the user enters credentials "standard_user" / "secret_sauce"
       Then the system redirects to "${var.app_url}/inventory.html"
   ```

4. Validate, preview, and apply your test infrastructure:
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

For full details, please visit our **[Documentation Portal (docs/)](docs/)**.

