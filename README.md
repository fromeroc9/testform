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
