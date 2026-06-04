# Writing Tests (The Testform DSL)

Testform uses **Gherkin** (`.feature` files) as its Domain Specific Language (DSL). However, it extends standard Gherkin behavior to treat scenarios as stateful infrastructure components.

## The Three Core Scopes

Testform groups your testing infrastructure into three hierarchical scopes. A file's purpose is determined by the specific "Tag" or "Extension" you assign to it, which you configure in `testform.json`.

By default, the scopes are:

1. **Test Case (`@testcase` or `*.case.feature`)**: Represents an individual test scenario. Mapped to `github_testcase`.
2. **Test Run (`@testrun` or `*.run.feature`)**: A collection of test cases being executed together (e.g., a Regression suite or Sprint testing cycle). Mapped to `github_testrun`.
3. **Test Plan (`@testplan` or `*.plan.feature`)**: A high-level collection of test runs. Mapped to `github_testplan`.

---

## 1. Defining a Test Case

A test case is mapped to a GitHub Issue. Testform uses the `Feature` and `Scenario` definitions to populate the Issue in GitHub.

```gherkin
@testcase
Feature: User Authentication

  @sprint-1
  Scenario: Successful login
    Given the user is on the login page
    When the user enters valid credentials
    Then the dashboard is displayed
```

### How it maps to GitHub:
- **Title:** The Scenario name (`Successful login`).
- **Body:** The Gherkin steps are formatted as a markdown code block inside the GitHub Issue description.
- **Labels:** Any tags applied (`@sprint-1`). The `@` is automatically stripped, so the label in GitHub will be `sprint-1`.

---

## 2. Using Fields (Native vs Custom)

Often, test cases require metadata beyond titles and descriptions (e.g., Assignees, Milestones, Priority, Jira Links). In Testform, you define this metadata using **Fields** directly inside the Scenario steps.

### The `field` Syntax

To declare a field, use the `*` bullet point followed by the word `field`, the field name, and its value:

```gherkin
  @sprint-1
  Scenario: Invalid login
    * field assignees = @octocat
    * field milestone = v1.0 Release
    * field priority = High
    
    Given the user enters an invalid password...
```

### Native Fields vs Custom Fields

Testform makes a strict distinction between Native fields and Custom fields:

#### Native Fields (GitHub Issues REST API)
These are fields that GitHub Issues support out-of-the-box. Testform recognizes two natively using the `field` syntax:
- `assignees`: Accepts a comma-separated list of GitHub usernames (e.g., `@octocat, @torvalds`).
- `milestone`: Accepts the exact text title of a GitHub Milestone (e.g., `v1.0 Release`). Testform will automatically look up the numeric ID of the milestone via the GitHub API before saving.

> [!NOTE]
> **What about `labels`?**
> Although `labels` is a native GitHub field, Testform treats it uniquely. You **do not** and **should not** declare `labels` as a keyword field in your `testform.json`. Instead, Testform automatically extracts all standard Gherkin `@tags` placed on your `Scenario` and converts them into GitHub labels. If you explicitly declare a `labels` keyword and use `* field labels = ...`, the internal parser will ignore it.

#### Custom Fields (GitHub Projects V2 GraphQL API)
Any field that is not native to GitHub Issues (like `priority`, `test-environment`, `jira-ticket`) is considered a Custom Field.

Because standard GitHub Issues don't support custom fields, **Testform uses GitHub Projects V2**.
When you use a custom field, Testform will:
1. Create the normal GitHub Issue.
2. Link the Issue to your team's GitHub Project.
3. Update the corresponding column/field in the Project Board using the GraphQL API.

> [!WARNING]
> **Strict Parsing Rule:** All fields (both native and custom) **MUST** be explicitly declared in your `testform.json` configuration file under the `fields` array. If a field is not declared in your config, the Testform parser will throw an `undeclared-field` validation error and ignore it.

---

## 3. Defining a Test Run

A Test Run aggregates multiple test cases into a single execution cycle. In Testform, a Test Run is also created as a GitHub Issue, but its description contains a checklist of all the associated test cases.

Instead of using standard fields, Testform uses the Gherkin `Rule` and `Scenario` keywords to link test cases directly from their source files.

```gherkin
@testrun
Feature: Q3 Regression Cycle
  
  Background:
    * field assignees = @qa-lead

  Rule: login.case.feature

  Scenario: @tc-01
  Scenario: @tc-02

  Rule: checkout.case.feature

  Scenario: @tc-01
```

### How it works
- **`Rule`**: Specifies the target `.feature` file where the test cases are located. You can specify just the file name (e.g., `login.case.feature`) or the relative path (e.g., `auth/login.case.feature`).
- **`Scenario`**: Contains the specific identity (e.g., `@tc-01`) of the test case you want to include in this run.

> [!WARNING]
> **Resolving Collisions:** If your project contains multiple feature files with the exact same name (e.g., `v1/login.feature` and `v2/login.feature`), and you only use `Rule: login.feature` while specifying a particular scenario, Testform will abort execution with a fatal error due to ambiguity. To fix this, you must specify the full or relative path in your Rule, for example: `Rule: v2/login.feature`. If you do not specify a scenario (meaning you want all of them), Testform will process all matching files and emit a *warning*.

When you `apply` this Test Run, Testform will automatically check the statuses of the linked test cases and update the checklist in the GitHub Issue body.

---

## 4. Special Tags

Testform uses a few reserved tags to control parsing and identification of resources.

### Scope Tags (`@testcase`, `@testrun`, `@testplan`)
These tags, typically placed at the `Feature` level, define the scope of the entire file. When you tag a Feature with `@testcase`, all Scenarios inside it are parsed and mapped to `github_testcase` resources.

### Numbering / Identity Tags (e.g., `@tc-01`, `@tc-02`)
While Testform can use the file name and Scenario title to create a unique identity (e.g. `login.case.feature::Valid Login`), it is highly recommended to use **Numbering Tags** to uniquely identify a test case. 
You can configure `testform.json` to extract this tag as the identity using `"identity": "@tc-*"`.

```gherkin
@testcase
Feature: User Authentication

  @tc-01 @sprint-1
  Scenario: Successful login
    * field assignees = @octocat
```
*If you configure `"identity": "@tc-*"`, Testform will track this issue in the state file using `tc-01` rather than its long filename.*

### Parameterized Tests (`@unique` and `<key>`)
Testform fully supports Gherkin Scenario Outlines. However, because Testform needs a unique identity for every infrastructure resource, you **must** use the `@unique` tag on your `Scenario Outline`.

Furthermore, you can use the `<key>` parameter inside your tags to dynamically generate unique identities (like `@tc-<id>`) for each row in your Examples table.

```gherkin
@testcase
Feature: User Roles

  @unique @tc-<id>
  Scenario Outline: Login with role <role>
    * field assignees = <assignee>
    Given a user logs in as "<role>"
    Then they should see the "<dashboard>"

    Examples:
      | id | role  | dashboard  | assignee |
      | 02 | admin | AdminPanel | @alice   |
      | 03 | user  | UserHome   | @bob     |
```

Testform will dynamically generate two distinct GitHub Issues tracked locally as `tc-02` and `tc-03`.

If you modify the Examples table later (e.g., removing a row), Testform's `plan` command will detect it and propose destroying the orphaned GitHub Issue!
