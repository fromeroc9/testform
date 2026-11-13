# 📜 Testform AI Agent Rules & Directives

> **Universal AI Guidelines for Cursor (`.cursorrules`), Claude Code (`CLAUDE.md`), and Antigravity/Copilot (`agent.md`).**  
> Copy this file into your workspace root or configure your AI assistant with it to guarantee 100% compliant Test-as-Code authoring.

---

## 🏛️ Core Philosophy: Test-as-Code (T-a-C)

Testform is a declarative Test-as-Code orchestration engine modeled after Terraform:
* **Declarative Specifications**: QA assets live in Git as Gherkin `.feature` files.
* **State Ledger (`testform.state`)**: Tracks recorded tests, executions, plans, and defects.
* **Deterministic Workflow**:
  1. `testform validate` -> Syntax and policy compliance.
  2. `testform plan` -> Diffs evaluated against `testform.state` (`+ to add`, `~ to change`, `- to destroy`).
  3. `testform apply` -> Atomic reconciliation to the state ledger and remote providers.

---

## 📐 The 4 Declarative Resource Primitives

| Resource | Scope Tag | File Extension | Identity Tag Level | Required Structure |
|---|---|---|---|---|
| **`testcase`** | `@testcase` | `*.case.feature` | **Scenario** (`@tc-01`, `@tc-02`) | `Given`, `When`, `Then` steps mandatory in every scenario. |
| **`testrun`** | `@testrun` | `*.run.feature` | **Feature** (`@tr-01`, `@tr-02`) | `* set status = <status>` per scenario/step. |
| **`testplan`** | `@testplan` | `*.plan.feature` | **Feature** (`@tp-01`, `@tp-02`) | Structured with `Rule:` blocks grouping suites. |
| **`bug`** | `@bug` | `*.bug.feature` | **Scenario** (`@bg-01`, `@bg-02`) | `* set target = <testcase.id>` and reproduction steps. |

---

## 🔒 Strict Syntax & Placement Contracts

### 1. Test Cases (`*.case.feature`)
* **Feature Header**: MUST start with `@testcase`.
* **Feature Tags Restriction**: Arbitrary tags are **strictly forbidden** on the `Feature:` line. Only `@testcase` and `@ns(namespace)` are permitted at the feature level. All functional tags (e.g. `@smoke`, `@regression`, `@auth`) MUST be placed on individual `Scenario:` lines.
* **Identity Tags**: Every scenario MUST have a sequential identity tag matching `@tc-*` (e.g. `@tc-01`, `@tc-02`).
* **Steps**: Every scenario MUST contain at least one `Given`, `When`, and `Then` step.

```gherkin
@testcase
Feature: User Authentication

  Background:
    * set attach = "attachments/wireframe_login.png"

  @tc-01 @smoke
  Scenario: Successful login with valid credentials
    Given the user navigates to the login page
    When the user submits valid username and password
    Then the user is redirected to the dashboard

  @tc-02 @regression
  Scenario: Error on invalid password
    Given the user is on the login page
    When the user submits an invalid password
    Then an alert displaying "Invalid credentials" is shown
```

---

### 2. Test Runs (`*.run.feature`)
* **Feature Header**: MUST declare `@testrun` and its identity tag `@tr-*` together at the Feature level:
  `@testrun @tr-01`
* **Execution Statuses**: Aligned with Cucumber Gherkin statuses:
  `passed`, `failed`, `pending`, `blocked`, `skipped`, `undefined`, `ambiguous`
* **Statements**: Use `* set status = ...` (or `* mark status = ...`) and `* set duration = "X.Xs"`.

```gherkin
@testrun @tr-01
Feature: Regression Sprint 24

  Background:
    * set environment = "staging"
    * set runner = "playwright"

  Rule: tests/auth.case.feature
    Scenario: @tc-01 Successful login
      * set status = passed
      * set duration = "1.2s"

    Scenario: @tc-02 Error on invalid password
      * set status = failed
      * set duration = "2.1s"
      * set attach = "attachments/failures/err_tc02.png"
```

---

### 3. Test Plans (`*.plan.feature`)
* **Feature Header**: MUST declare `@testplan` and its identity tag `@tp-*` at the Feature level:
  `@testplan @tp-01`
* **Suite Orchestration**: Group testruns using `Rule:` blocks.
* **Integrity Rule**: A testrun cannot be assigned to multiple test plans.

```gherkin
@testplan @tp-01
Feature: Release 1.4.0 Test Plan

  Background:
    * set release = "1.4.0"
    * set targetDate = "2026-12-01"
    * set attach = "attachments/release_criteria.pdf"

  Rule: Smoke & Critical Path
    Scenario: Core Authentication Suite
      * reference = testruns/auth-smoke.run.feature

  Rule: End-to-End Regressions
    Scenario: E-Commerce Checkout Suite
      * reference = testruns/checkout-regression.run.feature
```

---

### 4. Bugs & Defects (`*.bug.feature`)
* **Feature Header**: MUST start with `@bug`.
* **Scenario Level**: Every defect scenario MUST have an identity tag `@bg-*` (e.g. `@bg-01`).
* **Traceability Binding**: MUST specify the target test case or run using `* set target = <path.identity>`.
* **Defect Statuses**:
  `open`, `in_progress`, `resolved`, `reopened`, `discarded`, `duplicate`
* **Severity**: `critical`, `high`, `medium`, `low`.

```gherkin
@bug
Feature: Authentication Failures

  @bg-01
  Scenario: 504 Gateway Timeout during password recovery
    * set target = tests/auth.case.feature.@tc-02
    * set severity = high
    * set status = open
    * set attach = "attachments/bugs/timeout_trace.log"
    Given the user requests a password reset token
    When the backend identity provider stalls for 30s
    Then the application displays a 504 error instead of fallback
```

---

## 📎 Attachment & Evidence Governance Matrix

Follow these strict placement rules for `* set attach = "..."` / `* set evidence = "..."`:

| Resource Scope | `Background:` Allowed? | `Scenario:` Allowed? | Governance Notes |
|---|:---:|:---:|---|
| **`testcase`** | ✅ **YES** | ✅ **YES** | Background for story wireframes/PRDs; Scenario for case mockups. |
| **`testrun`** | ✅ **YES** | ✅ **YES** | Background for environment logs; Scenario for execution screenshots. |
| **`testplan`** | ✅ **YES** | ❌ **FORBIDDEN** | **Only permitted in Background**. Emits warning diagnostic if placed in Scenario. |
| **`bug`** | ❌ **FORBIDDEN** | ✅ **YES** | **Strictly forbidden in Background**. Defect evidence must be tied to specific bug scenarios. |

---

## 🛠️ Essential Testform CLI Commands

When suggesting or executing commands, use these exact patterns:

```bash
# 1. Project Initialization & Providers
testform init
testform init -backend-config="bucket=my-s3-bucket"

# 2. Syntax & Governance Validation
testform validate
testform validate --json

# 3. Execution Diff & Drift Detection
testform plan
testform plan --target tests/auth.case.feature
testform plan -detailed-exitcode

# 4. State Ledger Reconciliation
testform apply -auto-approve
testform apply --target tests/auth.case.feature

# 5. Resource Queries
testform query testcase "priority=high"
testform query bug "status=open"

# 6. Report Generation
testform report testrun-summary --format md
testform report defects --format xlsx --out reports/bugs.xlsx
```

---

## ⚠️ Anti-Patterns to Avoid

1. ❌ **Do NOT use Cucumber step bindings inside `@testrun` or `@testplan`**: Testruns and testplans are orchestration suites; they use `* set status`, `* set duration`, or references, NOT Given/When/Then steps.
2. ❌ **Do NOT place tags on `Feature:` lines in `*.case.feature`** (except `@testcase` and `@ns(...)`). All functional labels belong on scenarios.
3. ❌ **Do NOT omit Given/When/Then in `*.case.feature`**. Every test case scenario requires all three phases.
4. ❌ **Do NOT put `* set attach` in `Background:` of `@bug` files**.
5. ❌ **Do NOT skip sequential numbering**. Always inspect existing numbers (`@tc-01`, `@tc-02`) and use the next consecutive integer.
