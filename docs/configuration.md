# Configuration Guide (`testform.json`)

At the root of every Testform workspace lies the `testform.json` file. This file controls how Testform connects to external systems (like GitHub), how it stores its state, and most importantly, how it parses your Gherkin DSL.

## Example Configuration

```json
{
  "version": "1.0",
  "github": {
    "owner": "hashicorp",
    "repository": "testform",
    "projectId": 12,
    "tokenEnv": "GITHUB_TOKEN",
    "appId": "123456",
    "privateKey": "-----BEGIN PRIVATE KEY-----\\n...",
    "installationId": "987654"
  },
  "backend": {
    "type": "local",
    "config": {}
  },
  "scope": {
    "global": {
      "fields": [
        { "name": "priority", "type": "tags", "required": true, "values": ["@low", "@medium", "@high"] },
        { "name": "assignees", "type": "keywords" }
      ]
    },
    "testcase": {
      "identity": "*.case.feature::*",
      "fields": [
        { "name": "milestone", "type": "keywords" },
        { "name": "priority", "type": "tags", "required": false, "values": ["@low", "@medium", "@high"] }
      ]
    },
    "testrun": {
      "identity": "*.run.feature::*",
      "fields": [
        { "name": "testcases", "type": "keywords" }
      ]
    }
  }
}
```

---

## The `github` Block

Configures the connection to your GitHub repository and GitHub Projects V2 board.

- **`owner`** (string): The GitHub organization or username that owns the repository.
- **`repository`** (string): The repository name where Issues will be created.
- **`projectId`** (number, optional): The ID of your GitHub Projects V2 board. If provided, Testform will attempt to link all created issues to this project board, enabling the use of Custom Fields. *(Note: For monorepos or dynamic environments, this can be provided dynamically via the CLI using the `--projectId=<id>` flag).*
- **`tokenEnv`** (string): The name of the environment variable containing your GitHub token. Defaults to `GITHUB_TOKEN`.
- **`appId`** (string, optional): Your GitHub App ID (or configure via `GITHUB_APP_ID` environment variable).
- **`privateKey`** (string, optional): Your GitHub App Private Key (or configure via `GITHUB_PRIVATE_KEY` environment variable).
- **`installationId`** (string, optional): Your GitHub App Installation ID (or configure via `GITHUB_INSTALLATION_ID` environment variable).

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

## The `scope` Block

This is the most critical section. It tells the Testform AST parser how to interpret your local filesystem and map it to Testform resources.

You can configure up to four scopes: `global`, `testcase`, `testrun`, and `testplan`.

### `global` (Cross-Scope Fields)
To adhere to DRY (Don't Repeat Yourself) principles, you can define shared fields inside a `global` block. Fields defined here are automatically merged into all other scopes (`testcase`, `testrun`, `testplan`).
* **Hierarchy & Overrides:** If a field is defined in both `global` and a specific scope (e.g., `testcase`), the definition inside the specific scope takes precedence. This allows you to set a global baseline while tweaking specific properties (like making a field `required: false`) for individual scopes.

### `identity`
The identity pattern tells Testform which files belong to which scope.
- **Tag-based:** `"@testcase"` (Any scenario with this tag will be parsed as a testcase).
- **File-extension based:** `"*.case.feature::*"` (Any scenario inside a file ending with `.case.feature` will be parsed as a testcase).

### 🥚 `convention` (Easter Egg)
If you hate creating test files manually with the correct boilerplate, Testform has a hidden command `testform generate` to auto-write them for you.
To make it work to your liking, you can add a `convention` block inside the `global` scope (to apply to everything) or inside specific scopes (`testcase`, `testrun`, `testplan`) to override them:
```json
"global": {
  "convention": {
    "filename": "{YYYYMMDD}_{HHmmss}.{scope}.feature"
  }
},
"testrun": {
  "convention": {
    "directory": "testrun",
    "filename": "{slug}_{YYYYMMDD}_{HHmmss}.run.feature"
  }
}
```
*Supported dynamic variables in `filename`: `{YYYYMMDD}`, `{HHmmss}`, `{timestamp}`, `{slug}` (a sanitized, hyphenated version of your Feature title).*

### `fields`
This array is your **Strict Schema Definition**. As explained in the [DSL Guide](writing-tests-dsl.md), any field you use in your `.feature` files MUST be declared here. If a user writes `* field browser = chrome` in their test, but `browser` is not declared in `fields`, Testform will throw an error.

Each field object takes:
- **`name`** (string): The exact name of the field (case-insensitive).
- **`type`** (string):
  - `"keywords"`: The field is expected to be declared using the step syntax (`* field name = value`).
  - `"tags"`: The field is mapped to a standard Gherkin tag (e.g., `@high-priority`).
- **`required`** (boolean, optional): If `true`, the parser will fail if the scenario does not include this field.
- **`default`** (string or array of strings, optional): If provided, establishes a default value that is inherited if the scenario does not explicitly declare the field.
- **`values`** (array of strings, optional): Used exclusively for `"tags"` type. If provided, only tags matching these values will be mapped to the field.

### Field Type Examples:

**1. Keywords Type:**
```json
{ "name": "assignees", "type": "keywords" }
```
*How to use in DSL:*
```gherkin
* field assignees = @octocat
```

**2. Tags Type (Mapped to a specific tag pool):**
```json
{ 
  "name": "severity", 
  "type": "tags",
  "values": ["@critical", "@high", "@low"]
}
```
*How to use in DSL:*
```gherkin
@critical
Scenario: Server crashes on login
```
*Testform will automatically extract `@critical` and map it to the `severity` custom field in your GitHub Project board!*
