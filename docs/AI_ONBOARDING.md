# Testform Architecture & AI Onboarding Guide

Welcome! If you are an AI assistant tasked with maintaining, debugging, or extending **Testform**, this document is your rapid onboarding guide. It contains highly technical details about the architecture, execution flows, and critical design paradigms used across the codebase.

## 1. High-Level Concept
**Testform** is a "Test-as-Code" CLI tool heavily inspired by Terraform. It allows QA/Dev teams to define Test Cases, Test Runs, and Test Plans using Gherkin (`.feature` files), and synchronizes them bi-directionally with remote issue trackers (primarily GitHub Issues and GitHub Projects V2).

Instead of cloud infrastructure (AWS/GCP), Testform manages "Issue Tracker Infrastructure".

## 2. Directory Structure & Entry Points
- `src/index.ts`: The main CLI entry point. Parses raw arguments using `arg` and routes to specific commands.
- `src/commands/`: Contains the implementation of CLI verbs (`plan`, `apply`, `destroy`, `refresh`, `diff`, `taint`, etc.).
- `src/core/`: The core engine.
  - `state.ts`: The state manager.
  - `parser.ts`: Facade for reading and parsing `.feature` files.
  - `parsers/`: Contains scope-specific Gherkin AST parsers (`testcase-parser.ts`, `testrun-parser.ts`, `testplan-parser.ts`).
  - `config.ts`: Parses the `testform.json` configuration file.
- `src/adapters/`: Network/API adapters (e.g., `github.ts`).
- `src/const.ts`: Project-wide constants and mappings.
- `src/types.ts`: Core interfaces (`IState`, `IScope`, `ParserScenario`, etc.).

## 3. Core Terminology & Concepts
- **Scope (`IScope`)**: Represents the type of test resource. Values: `testcase`, `testrun`, `testplan`.
  - By default, if `-scope` is not provided, commands loop over all 3 scopes.
- **Identity (`identity`)**: The unique primary key of a resource in the local state. 
  - **Rule**: Identities are ALWAYS constructed as `PhysicalPath::Tag` (e.g., `tests/login.feature::@tc-01`).
  - *Never* use the Scenario Title or Feature Title as part of the identity.
- **Resource Types**: Mapped internally via `SCOPE_RESOURCE_MAP`.
  - `testcase` -> `github_testcase`
  - `testrun` -> `github_testrun`
  - `testplan` -> `github_testplan`
- **localHash**: A SHA-256 hash of the deterministic parts of a parsed Gherkin AST. If the `localHash` changes between runs, the resource has drifted and requires an update.
- **remoteId**: The ID on the remote provider (e.g., GitHub Issue Number).

## 4. State Management (`src/core/state.ts`)
Testform uses a JSON state file (`.testform.state` by default) to map local `.feature` files to remote GitHub Issues.
- **Locking**: Before performing operations, `acquireLock()` creates a `.lock` file to prevent concurrent access. If `-lock=false` is used, the system tracks this via a `lockAcquired` boolean to ensure `releaseLock()` doesn't accidentally delete someone else's lock file.
- **State File Anatomy**:
  - `version`: State format version.
  - `resources`: Array of `StateResource` objects. Each contains:
    - `type` (e.g., `github_testcase`)
    - `identity` (e.g., `tests/login.feature::@tc-1`)
    - `attributes` (contains remote mapping data like `issueNumber`, `remoteId`, `nodeId`)
    - `tainted` (boolean, if true, forces recreation)

## 5. Execution Flow Pipeline
The standard lifecycle (`plan` -> `apply`) follows this exact pipeline:

### A. Discovery (`src/core/parser.ts`)
1. The CLI reads the target directory for `.feature` files.
2. AST Parsers parse the Gherkin files.
3. Elements with tags (e.g., `@tc-1`) are extracted.
4. An `identity` and `localHash` are generated for each element.

### B. Plan (`src/commands/plan.ts`)
1. Iterates over discovered resources and compares them against the loaded `State`.
2. Categorizes them into actions:
   - **Create (+)**: Present locally, missing in state.
   - **Update (~)**: Present locally and in state, but `localHash` differs.
   - **Destroy (-)**: Missing locally, present in state.
3. Outputs the execution plan to the console.

### C. Apply (`src/commands/apply.ts`)
1. Reads the plan (or generates it on the fly if no plan file is passed).
2. Requires interactive user approval unless `-auto-approve` is passed.
3. Dispatches API calls to the remote adapter (`github.ts`).
   - Creates issues, updates bodies, manages custom fields (Projects V2).
4. Persists the remote metadata (`issueNumber`) back into `State`.

## 6. Known Architectural Constraints & Quirks
- **Wildcards (`*`)**: Sometimes scenarios are implicitly generated during `apply -expand`. Dummy scenarios denoted by `*` are expanded into physical scenarios.
- **CLI Argument Parser**: We use `arg` library. Be careful with short flags using equals signs (e.g., `-C="."`); they must be explicitly mapped in the aliases.
- **Authentication**: Supports both Personal Access Tokens and GitHub App Credentials (using `@octokit/auth-app`).
- **Resource Extensibility**: `apply.ts` delegates HTML string-building to resource registries via the `comments(scenario, context)` callback when generating the GitHub Issue body.
- **Looping Scopes**: For global commands (no `-scope` flag), the command level (e.g., `plan.ts`, `destroy.ts`) handles the `for` loop over `['testcase', 'testrun', 'testplan']`.

## 7. Useful AI Prompts/Commands
If you need to make changes, keep these rules in mind:
- **Do not parse files manually**: Use `view_file` to read the AST parsers if you are changing how Gherkin is interpreted.
- **Always preserve `identity` logic**: `PhysicalPath + Tag`. If you alter `hashScenario`, ensure you strip out volatile fields like Scenario Names (`scenario.name = ''`) before hashing.
- **Global Error Handling**: Throw errors cleanly or use `logger.error` to terminate CLI flows.

Good luck! You now have the context needed to contribute effectively to Testform.
