# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Generate Command:** Changed the default directory for generated feature files to be the root folder when no directory convention is specified, instead of defaulting to the scope name (e.g. `testrun`).

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
