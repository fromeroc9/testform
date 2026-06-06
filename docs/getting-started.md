# Getting Started with Testform

This guide will walk you through the process of setting up Testform, connecting it to your GitHub repository, and running your first test management infrastructure deployment.

## Prerequisites

- **Node.js** (v16 or higher)
- A **GitHub Account** and an existing **GitHub Project** properly configured with labels and status fields. We highly recommend using our **[Install Testform Labels and Project](../.github/workflows/install.yml)** workflow to automatically set this up.
- Basic knowledge of Gherkin (`.feature`) syntax.

## 1. Installation

Testform is distributed as an NPM package. To install it globally on your system, run the following command in your terminal:

```bash
npm install -g testform
```

Verify the installation by checking the version:

```bash
testform version
```

## 2. Authentication

Testform needs to authenticate with GitHub to create and manage your test issues. You can use the built-in login command to securely store your token:

```bash
testform login
```
*You will be prompted to paste your GitHub Personal Access Token.*

Alternatively, if you are running Testform in a CI/CD environment (like GitHub Actions), you can skip the login command and expose the token as an environment variable (e.g., `export GITHUB_TOKEN=ghp_...`).

> **💡 Authentication Recommendation:** Whether using the CLI (`testform login`) or GitHub Actions, we strongly advise configuring a **Personal Access Token (PAT)** (with `repo` and `project` permissions).
>
> *Why?* The default `GITHUB_TOKEN` provided by Actions often lacks the necessary scopes to manipulate organization-level GitHub Projects (V2) or perform cross-repository operations. Using a dedicated PAT ensures that your automated pipelines have the robust, fine-grained access required to smoothly transition issues, manage test cases, and keep your project boards flawlessly in sync.

## 3. Initialize a Workspace

Navigate to an empty directory (or your existing testing repository) and initialize Testform:

```bash
mkdir my-tests && cd my-tests
testform init
```

This command creates a `testform.json` configuration file. Open it and update the GitHub section with your repository details:

```json
{
  "github": {
    "owner": "your-github-username",
    "repository": "your-repo-name",
    "tokenEnv": "GITHUB_TOKEN"
  }
}
```

## 4. Write Your First Test Case

Create a new file named `login.case.feature`:

```gherkin
@testcase
Feature: User Login
  As a registered user, I want to log in to access my dashboard.

  @login @sprint-1
  Scenario: Successful login with valid credentials
    * field assignees = @your-github-username
    Given the user is on the login page
    When the user enters valid credentials
    Then the user should be redirected to the dashboard
```

*Note: The `@testcase` tag tells Testform that this scenario is an independent test case.*

## 5. Plan and Apply

Now it's time to see what Testform will do. Run the `plan` command:

```bash
testform plan
```

You should see an output similar to this:
```text
+ create resource "github_testcase" "login.case.feature::Successful login with valid credentials" {
      + title = "User Login"
      + body  = (known after apply)
      + labels = ["login", "sprint-1"]
  }

Plan: 1 to add, 0 to change, 0 to destroy.
```

If the plan looks correct, apply the changes to GitHub:

```bash
testform apply
```

Testform will create a new Issue in your GitHub repository representing this test case. A local `testform.state` file will be created to track the mapping between your local file and the remote GitHub Issue ID.

## 6. Modifying Tests

Open `login.case.feature` and add a new scenario:

```gherkin
  Scenario: Invalid password
    Given the user is on the login page
    When the user enters an invalid password
    Then an error message should be displayed
```

Run `testform apply` again. Testform will detect that the first scenario is unchanged, and will only create the new one:

```text
Plan: 1 to add, 0 to change, 0 to destroy.
```

Congratulations! You have successfully managed your test cases as infrastructure. Next, check out the [Writing Tests (DSL)](writing-tests-dsl.md) guide to learn about assigning milestones, custom fields, and organizing test runs.
