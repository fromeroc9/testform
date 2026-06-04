# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-06-04

### Fixed
- **State Management:** Fixed an issue where resources were forcefully removed from the local state and recreated from scratch if the corresponding GitHub issue was closed. Testform will now retain the identity and propose an in-place update for closed issues when local fields are modified.

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
