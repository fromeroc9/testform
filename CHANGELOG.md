# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **Comments Status:** Fixed an issue where the testcase status fallback logic accidentally used the global testrun `Status` field rather than its independent execution status, causing Github comment tables to incorrectly show "Todo".
- **Gherkin Parser:** Fixed an issue where `* link status` could be incorrectly ignored when placed in the description of a Rule instead of a Background or Scenario block.
- **CLI Commands:** Fixed a bug causing `-expand` flag to fail with `Nothing to repeat` due to improper regular expression escaping when dealing with dummy `*` scenarios.
- **Scenario Expansion:** Corrected `apply -expand` logic to expand all explicit testcases belonging to a Rule instead of generating a dummy `*` scenario. It also properly removes the wildcard placeholder from local `.feature` files during expansion.

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
