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

To use Testform, it is a requirement to have an existing GitHub Project properly configured with the necessary labels and status fields.

We highly recommend using our automated **[Install Testform Labels and Project](.github/workflows/install.yml)** workflow to set everything up for you. This workflow will automatically:
- Create the required repository labels (`bug`, `testcase`, `testplan`, `testreport`, `testrun`).
- Clone the [Testform Template Project](https://github.com/users/fromeroc9/projects/4) into your organization or user account and link it to your target repository.
- Configure the "Status" field with the correct options and colors (`Todo`, `Done`, `passed`, `failed`, `blocked`, `skipped`, `unexecuted`).
- Install the `close-issue.yml` workflow into your target repository to automate issue state transitions.

> **💡 Authentication Recommendation:** If you plan to use Testform within GitHub Actions, or authenticate via `testform login` (or equivalent CLI login), we strongly advise configuring a **Personal Access Token (PAT)** (with `repo` and `project` permissions). *Note: It is neither mandatory nor recommended to use a GitHub App token.*
>
> *Why?* The default `GITHUB_TOKEN` provided by Actions often lacks the necessary scopes to manipulate organization-level GitHub Projects (V2) or perform cross-repository operations. Using a dedicated PAT ensures that your automated pipelines have the robust, fine-grained access required to smoothly transition issues, manage test cases, and keep your project boards flawlessly in sync.

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
   ```

---

## 🚀 Key Features

- **Test-as-Code Engine:** Declarative management for Testcases, Testruns, and Testplans using Gherkin.
- **5-Tier Variables Precedence:** Hierarchy spanning base `main.yml`, `variable.yml`/`local.yml`, domain modules, `-var-file`, and `-var` flags with multi-pass recursive interpolation.
- **100% Offline Capability:** Full local backend (`backend: local`) and mock provider (`provider: local`) for deterministic testing without external dependencies or tokens.
- **Terraform-grade State Management:** State locking, drift detection (`diff`), manual taint/untaint lifecycle, HCL resource display (`state show`), and dependency DAG rendering (`graph`).
- **Global Flags:** `-chdir=<path>`, `-no-color`, and `-compact-warnings` supported universally across commands.

For full details, please visit our **[Documentation Portal (docs/)](docs/)**.

