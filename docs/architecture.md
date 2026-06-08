# Testform Architecture

Testform is designed following the core principles of Terraform, bringing Infrastructure-as-Code (IaC) paradigms to test management. It treats GitHub as a cloud provider, provisioning testing infrastructure seamlessly.

## High-Level Workflow

The CLI operates in three main phases for any mutating operation:

1. **Discovery (Parse)**: Reads local `.feature` files, extracting scenarios, rules, tags, and Gherkin steps using the official `@cucumber/gherkin` parser. It strictly enforces the DSL fields defined in `testform.json`.
2. **Diff (Plan)**: Compares the local declared state against the stored `testform.state` file (the truth of what was last applied).
3. **Execution (Apply)**: Reconciles the difference by calling the GitHub API to create, update, or destroy Issues and project items. Finally, the state file is updated.

---

## Core Internal Components

### 1. The Parser Layer (`src/parsers/`)
The parser layer is responsible for converting raw Gherkin syntax into structured JSON objects. It operates using a Base/Derived architecture:
- `BaseParser`: Handles tokenization, AST generation, and generic Gherkin field extraction.
- `TestcaseParser`: Specializes in `@testcase` scopes. Extracts fields directly into `custom.fields`.
- `TestrunParser`: Groups testcases belonging to the same testrun file into a single composite scenario, and tracks their local execution status.

### 2. State Management (`src/core/state.ts`)
The state is a JSON representation of remote resources tracked by Testform. It is heavily inspired by Terraform state files.
- **Idempotency**: Operations are hashed locally (`localHash`). If the local hash matches the state hash, no API call is made.
- **Concurrency**: Uses an `.lock` mechanism to prevent concurrent executions in CI environments.

### 3. Resources Core (`src/core/resources.ts`)
This acts as the translation layer between generic parser output (`ParserScenario`) and the specific remote target (`GitHubIssuePayload`).
- Uses a declarative template system (`registerResource`).
- Resolves computed fields, testrun linkages, and status comment updates dynamically based on the current context and state.

### 4. GitHub Adapter (`src/adapters/github.ts`)
Handles the actual network communication with GitHub.
- **REST API**: Used for core Issue creation (`title`, `body`, `labels` (derived from tags), `assignees`, `milestone`).
- **GraphQL API**: Used exclusively for GitHub Projects V2 integration. It links the newly created issue to a project board and updates any `custom_fields`.

---

## Extending Testform

Testform's architecture is built to be extensible. To add a new Scope (e.g., `testsuite`), you must:
1. Define the scope config in `src/const.ts`.
2. Create a specialized parser in `src/parsers/`.
3. Add a resource template in `src/core/resources.ts`.
4. Register the new scope across typing and minimist CLI options in `src/index.ts`.
