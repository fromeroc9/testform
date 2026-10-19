# Configuration Guide (`testform.yml`)

At the root of every Testform workspace lies the configuration file: **`testform.yml`** (or `testform.json`). Testform natively supports clean YAML formatting with comments and human-readable indentation. This file controls how Testform connects to external systems (like GitHub), how it stores its state, and most importantly, how it parses your Gherkin DSL.

## Example Configuration (`testform.yml`)

```yaml
# Testform Project Configuration
version: "1.0"

provider:
  type: github
  config:
    owner: hashicorp
    repository: testform
    project_id: 12
    token_env: GITHUB_TOKEN

backend:
  type: local
  config: {}

scopes:
  global:
    fields:
      priority:
        source: tag
        required: true
        enum:
          - "@low"
          - "@medium"
          - "@high"
      assignees:
        source: step

  testcase:
    match: "*.case.feature::*"
    scaffold:
      directory: "testcase"
      filename: "{slug}_{YYYYMMDD}.case.feature"
    fields:
      milestone:
        source: step
      priority:
        source: tag
        required: false
        enum:
          - "@low"
          - "@medium"
          - "@high"

  testrun:
    match: "*.run.feature::*"
    scaffold:
      directory: "testrun"
      filename: "{slug}_{YYYYMMDD}.run.feature"
    fields:
      testcases:
        source: step
```

> [!NOTE]
> Testform supports both `testform.yml` (recommended for clean syntax and comments) and legacy `testform.json` with 100% backward compatibility.

---

## The `provider` Block

Configures the issue tracker adapter. Currently supports `"github"` and `"local"`.

For GitHub (`type: "github"`):
Inside `config`:

- **`owner`** (string): The GitHub organization or username that owns the repository.
- **`repository`** (string): The repository name where Issues will be created.
- **`projectId`** (number, optional): The ID of your GitHub Projects V2 board. If provided, Testform will attempt to link all created issues to this project board, enabling the use of Custom Fields. *(Note: For monorepos or dynamic environments, this can be provided dynamically via the CLI using the `--projectId=<id>` flag).*
- **`tokenEnv`** (string): The name of the environment variable containing your GitHub token. Defaults to `GITHUB_TOKEN`.

---

## The `backend` Block

Defines where Testform stores its `testform.state` file. The state file maps your local `.feature` scenarios to their corresponding GitHub Issue IDs.

- **`type`** (string): Determines the storage mechanism. Supported values are `"local"` and `"s3"`.
- **`config`** (object): The specific configuration for the chosen backend type.

### S3 Backend (`"type": "s3"`)

Stores the state as a file in an Amazon S3 bucket.

```json
  "backend": {
    "type": "s3",
    "config": {
      "bucket": "my-testform-state",
      "key": "testform.tfstate",
      "region": "us-east-1",
      "profile": "default"
    }
  }
```

- **`bucket`** (string): Name of the S3 bucket.
- **`key`** (string, optional): The path/name of the state file inside the bucket. Defaults to `testform.state` if omitted.
- **`region`** (string, optional): AWS region. If omitted, it will use `AWS_REGION` from the environment or default to `us-east-1`.
- **`profile`** (string, optional): The AWS profile to use from your local `~/.aws/credentials` or AWS SSO configuration.
- **`dynamodb_table`** (string, optional): Name of a DynamoDB table used for state locking to prevent concurrent modifications.

> **💡 Local Emulators Tip (MiniStack / Floci):** 
> To connect to a local emulator without polluting your config with custom fields, set `"profile": "local"`. When this profile is active, Testform automatically enables path-style URLs and reads the `"region"` field as your local endpoint! 
> Example: `"profile": "local", "region": "http://localhost:4566"`.

> **Note on Security:** Notice that access keys and secrets are NOT placed directly in this configuration file. Testform utilizes the official AWS SDK, which automatically fetches your credentials from your environment (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), your SSO login session (`aws sso login`), or your local `~/.aws/credentials` using the specified `profile`.

---

### AzureRM Backend (`"type": "azurerm"`)

Stores the state as a file in an Azure Blob Storage container.

```json
  "backend": {
    "type": "azurerm",
    "config": {
      "resource_group_name": "my-resource-group",
      "storage_account_name": "mystorageaccount",
      "container_name": "demo-bucket",
      "key": "testform.state"
    }
  }
```

- **`resource_group_name`** (string): The name of the Azure resource group.
- **`storage_account_name`** (string): The name of the Azure Storage Account.
- **`container_name`** (string): The name of the Blob Storage container.
- **`key`** (string, optional): The name of the state file inside the container. Defaults to `testform.state` if omitted.
- **`connection_string`** (string, optional): The connection string to authenticate with Azure. If omitted, Testform will use the `AZURE_STORAGE_CONNECTION_STRING` environment variable.

> **💡 Local Emulators Tip (Azurite / Floci):** 
> To connect to a local emulator like Azurite or Floci, provide the default emulator connection string containing your local endpoint directly in the configuration (or export it to your environment).
> Example: `"connection_string": "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=...;BlobEndpoint=http://localhost:4577/devstoreaccount1;"`.

---

### GCS Backend (`"type": "gcs"`)

Stores the state as a file in a Google Cloud Storage bucket.

```json
  "backend": {
    "type": "gcs",
    "config": {
      "bucket": "my-testform-state-bucket",
      "prefix": "testform/state"
    }
  }
```

- **`bucket`** (string): The name of the GCS bucket.
- **`prefix`** (string, optional): GCS prefix inside the bucket. State will be stored as `<prefix>/testform.state`. If omitted, state will be stored at the root of the bucket.
- **`credentials`** (string, optional): Local path to a Google Cloud service account JSON key file.

> **Note on Security:** If `credentials` is omitted, Testform will automatically use Google Application Default Credentials (ADC) from your environment or `gcloud auth application-default login`.

---

## The `scopes` Block

This is the core configuration block. It tells the Testform AST parser how to interpret your local filesystem, match features, auto-scaffold files, and map your custom fields to Testform resources.

You can configure up to four scopes: `global`, `testcase`, `testrun`, and `testplan`. Both `scopes:` (recommended) and `scope:` (legacy) are supported.

### `global` (Cross-Scope Baseline)
To adhere to DRY (Don't Repeat Yourself) principles, you can define shared fields and scaffolding rules inside a `global` block. Everything defined here is automatically inherited across all specific scopes (`testcase`, `testrun`, `testplan`).
* **Hierarchy & Overrides:** If a field is defined in both `global` and a specific scope (e.g., `testcase`), the definition inside the specific scope takes precedence. For instance, you can define a global `priority` field with `required: true`, but override it as `required: false` for `testcase`.

### `match` (File & Scenario Matching)
The `match` pattern (also aliased to legacy `identity`) tells Testform which files or scenarios belong to each scope:
- **File-extension based:** `"*.case.feature::*"` (Any scenario inside a file ending with `.case.feature`).
- **Tag-based:** `"@testcase"` or `"@tc-*"` (Any scenario with matching tags).

### `scaffold` (File Generation Convention)
Testform includes the generator command `testform generate` to auto-create test files with standardized naming and directory structure.
Configure `scaffold:` (or legacy `convention:`) in `global` or per-scope:
```yaml
scopes:
  global:
    scaffold:
      filename: "{YYYYMMDD}_{HHmmss}.{scope}.feature"

  testcase:
    scaffold:
      directory: "testcase"
      filename: "{slug}_{YYYYMMDD}.case.feature"

  testrun:
    scaffold:
      directory: "testrun"
      filename: "{slug}_{YYYYMMDD}.run.feature"
```
*Supported dynamic variables in `filename` (or `pattern`): `{YYYYMMDD}`, `{HHmmss}`, `{timestamp}`, `{slug}` (a sanitized, hyphenated version of your Feature title).*

### `fields` (Schema Definition)
Fields can be declared directly under each scope or at the top level (`fields.global`, `fields.testcase`, etc.).
Testform supports a clean **object dictionary format** where the field name is the map key:

```yaml
scopes:
  testcase:
    match: "*.case.feature::*"
    fields:
      # Step keyword field (default source)
      assignees:
        source: step
        required: true

      # Tag-extracted field with allowed enum list
      priority:
        source: tag
        required: false
        enum:
          - "@low"
          - "@medium"
          - "@high"
          - "@critical"
        default: "@medium"
```

Each field definition accepts:
- **`source`** (string, optional):
  - `"step"` *(default)*: Extracted from step syntax (`* field <name> = <value>`).
  - `"tag"`: Extracted from Gherkin tags (e.g. `@high`, `@critical`).
- **`enum`** (array of strings, optional): Used with `source: tag` (or legacy `type: tags`). Only tags matching this list will be mapped to the field.
- **`required`** (boolean, optional): If `true`, the parser will fail if the scenario does not include this field.
- **`default`** (string or array of strings, optional): Fallback value inherited if the scenario does not declare the field.

### Field Usage in Gherkin DSL:

**1. Step Source (`source: step`):**
```yaml
fields:
  assignees:
    source: step
```
*In `.feature` file:*
```gherkin
* field assignees = @octocat
```

**2. Tag Source (`source: tag`):**
```yaml
fields:
  severity:
    source: tag
    enum: ["@critical", "@high", "@low"]
```
*In `.feature` file:*
```gherkin
@critical
Scenario: Server crashes on login
```
*Testform automatically extracts `@critical` and maps it to the `severity` custom field in your issue tracker.*

> [!NOTE]
> **Backward Compatibility:** Legacy array format (`- name: severity, type: tags, values: [...]`) and legacy properties (`identity:`, `convention:`, `type: keywords`) remain 100% supported.
