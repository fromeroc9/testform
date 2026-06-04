# Testform Documentation

Welcome to the official documentation for **Testform**. Testform brings the **Test-as-Code** paradigm to your version control platforms. It transforms standard issue trackers (like GitHub) into full-fledged Test Management ecosystems. By treating your QA processes as code, it codifies issue APIs into declarative Gherkin (`.feature`) configurations that can be shared amongst team members, edited, reviewed in Pull Requests, and strictly versioned.

## Why Testform?

Test management tools today are often completely decoupled from the developer's workflow. QA engineers write test cases in external web portals (like Jira, Xray, or QMetry), while developers write code in their IDEs. This separation leads to "drift": the test cases drift out of sync with reality, traceability becomes a chore, and managing test execution across environments is a manual nightmare.

Testform solves this by treating your test cases as infrastructure. Inspired by HashiCorp's Terraform, Testform allows you to define your Test Cases, Test Runs, and Test Plans locally using the ubiquitous Gherkin (`.feature`) syntax. It then intelligently plans and applies those changes directly to GitHub Issues and GitHub Projects.

### Key Benefits

1. **Git-ops for QA:** Your test cases live in Git alongside your application code. Pull requests naturally review test changes along with application code changes.
2. **Declarative State:** You declare the desired state in Gherkin. Testform figures out how to make GitHub match that state, without you having to manually click around web UIs.
3. **Idempotency & Drift Detection:** Testform remembers what it applied using a `testform.state` file. If someone manually changes a test case in GitHub, Testform detects the "drift" and can reconcile it.
4. **Native GitHub Integration:** Test cases are GitHub Issues. Bugs are GitHub Issues. Developers don't need to learn a new tool—it all lives where they already work.
5. **Multi-dimensional Reporting:** Generate coverage, execution, and traceability reports directly from your local state, bridging the gap between technical execution and management visibility.

---

## Table of Contents

Follow this guide to master Testform from installation to advanced analytics.

### 1. Getting Started
* [Getting Started](getting-started.md)
  * Installation
  * GitHub Credentials Setup
  * Your First `plan` and `apply`

### 2. Core Concepts & DSL
* [Writing Tests (DSL)](writing-tests-dsl.md)
  * Gherkin Syntax (`.feature` files)
  * Scopes (Test Cases, Test Runs, Test Plans)
  * Tags vs Fields
  * Native Fields (`assignees`, `milestone`) vs Custom Fields

### 3. Configuration
* [Configuration Guide](configuration.md)
  * The `testform.json` file
  * Backend configuration (Local, S3, Azure)
  * GitHub Adapter setup
  * Field mapping rules

### 4. Command Line Interface
* [CLI Reference](cli-reference.md)
  * Overview of commands (`init`, `plan`, `apply`, `destroy`)
  * Workspaces (`workspace`)
  * State Management (`state`, `import`, `refresh`, `taint`)
  * Formatting & Graphing (`fmt`, `graph`)

### 5. Reporting & Analytics
* [Reporting & Analytics](reporting-and-analytics.md)
  * Using the `report` command
  * Available reports (Summary, Traceability, Coverage, 2D-Matrix)
  * Filtering data
  * Exporting to JSON and CSV

### 6. Architecture & Internals
* [Architecture Overview](architecture.md)
  * How the AST parser works
  * State management mechanics
  * REST API vs GraphQL (Projects V2) integration
* [State Management Deep Dive](state.md)
* [Terraform Model Comparison](terraform-model.md)

### 7. Advanced Reference
* [Resources Reference](resources.md)
* [GitHub Actions Integration](action-reference.md)
