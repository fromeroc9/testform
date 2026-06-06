# Testform

**Testform** brings the **Test-as-Code** paradigm to your version control platforms. It transforms standard issue trackers (like GitHub) into full-fledged Test Management ecosystems. By treating your QA processes as code, it codifies issue APIs into declarative Gherkin (`.feature`) configurations that can be shared amongst team members, edited, reviewed in Pull Requests, and strictly versioned.

---

## 📚 Documentation

We have completely overhauled our documentation to be as intuitive and comprehensive as possible. 

**Start here:** 👉 **[Testform Documentation Portal (docs/index.md)](docs/index.md)** 👈

### Quick Links
- **[Getting Started](docs/getting-started.md)**: Installation, authentication, and your first `apply`.
- **[Writing Tests (The DSL)](docs/writing-tests-dsl.md)**: Master the Gherkin syntax, tags, and custom fields (like `assignees` and `milestone`).
- **[Configuration Guide](docs/configuration.md)**: Deep dive into the `testform.json` rules.
- **[CLI Reference](docs/cli-reference.md)**: Cheat sheet for all commands (`plan`, `apply`, `import`, etc.).
- **[Reporting & Analytics](docs/reporting-and-analytics.md)**: Generate execution matrices and coverage reports locally.
- **[Architecture](docs/architecture.md)**: How the AST parser, state management, and GraphQL adapters work.

---

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

1. Create a `testform.json` configuration file at the root of your project:
   ```json
   {
       "github": {
           "owner": "MyOrg",
           "repository": "MyRepo",
           "tokenEnv": "GITHUB_TOKEN"
       },
       "scope": {
           "testcase": {
               "fields": [
                   { "name": "assignees", "type": "keywords" },
                   { "name": "priority", "type": "tags", "values": ["@high", "@medium", "@low"] }
               ]
           }
       }
   }
   ```

2. Initialize your workspace:
   ```bash
   testform init
   ```

3. Write a Gherkin file (e.g., `login.case.feature`):
   ```gherkin
   @testcase
   Feature: User Login
     
     @high
     Scenario: Valid Login
       * field assignees = @octocat
       Given the user is on the login page
   ```

4. Preview the changes and apply them to GitHub:
   ```bash
   testform plan
   testform apply
   ```

For full details, please visit our **[Documentation Portal](docs/index.md)**.
