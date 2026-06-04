# The Terraform Model in TestForm

TestForm bridges the gap between local Gherkin `.feature` files and GitHub Issues by applying the standard Terraform declarative resource model.

## 1. Local Configuration (Desired State)
Your `.feature` files define what should exist in GitHub. They act identically to `.tf` files.

Instead of writing:
```hcl
resource "github_testcase" "login_valid" {
    title = "Login Valid"
    body  = "Given the user navigates to..."
    labels = ["login", "e2e"]
}
```

You write idiomatic Gherkin:
```gherkin
@login @e2e
Feature: User Login

  @testcase
  Scenario: Login Valid
    Given the user navigates to the login page
    When the user enters valid credentials
```

TestForm parses this and dynamically transforms it into a `github_testcase` resource.

## 2. Remote Infrastructure (Actual State)
The remote target is a GitHub Issue (and optionally, a GitHub Project V2 Item).

## 3. The State File (`testform.state`)
Similar to `terraform.tfstate`, this file tracks the mapping between your local scenarios and their remote GitHub Issue IDs. 
- **Tracking Identity**: Resources are tracked by an identity string that is persistent. For `testcase`, the identity is `[Filename]::[Tag ID]` (e.g. `login.case.feature::@[1]`). For `testrun` and `testplan`, the identity is simply the `[Filename]`.
- **Idempotency**: TestForm calculates a `localHash` of your Gherkin scenario. If the local hash hasn't changed since the last apply, TestForm skips updating the Issue, saving API calls.
- **Tainting**: You can forcefully mark a resource as `tainted` using the CLI. The next apply will delete the existing Issue and recreate it from scratch.

## 4. Workflows

### Plan
`testform plan` compares your `.feature` files against `testform.state`. It tells you exactly what will happen without actually talking to the GitHub API to perform changes.

### Apply
`testform apply` executes the planned changes, updating GitHub Issues sequentially, and updates `testform.state` upon completion.

### Destroy
`testform destroy` looks at everything currently recorded in `testform.state` and destroys (closes) the corresponding GitHub Issues.

## Custom Fields and Resource Mapping

The parser extracts variables from the Gherkin steps via DSL extraction and assigns them to the internal attributes of the resource.

Example mapping flow:
1. Local: `* milestone = "Sprint 1"`
2. TestForm extracts to `custom.fields.milestone`
3. The internal adapter templates it to `payload.milestone`
4. `apply` translates "Sprint 1" into the internal GitHub Milestone ID.
5. A GitHub Issue is created with the exact Milestone configured.
