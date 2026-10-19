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

Defines where Testform stores its `testform.state` file. Just like in Terraform, the backend in Testform is **strictly single and unique**: your state is stored in exactly one source of truth.

Because the backend is unique, Testform uses an **optimized, compact syntax** directly naming the backend type without redundant `type:` and `config:` nesting levels.

### Scaffolding Backends with `testform init`

You can initialize your workspace with a pre-configured template for any backend using the `-backend-type` option:

```bash
# Default (local filesystem state)
testform init

# GitHub branch backend (Zero-dependency cloud state)
testform init -backend-type=github

# AWS S3
testform init -backend-type=s3

# Oracle Cloud Infrastructure (OCI Object Storage)
testform init -backend-type=oci

# Azure Blob Storage
testform init -backend-type=azurerm

# Google Cloud Storage
testform init -backend-type=gcs
```

> **Automated Driver Installation:** When running `testform init` with a cloud backend, Testform automatically checks if the required driver package is installed. If missing, it downloads it on the fly (just like `terraform init` downloads provider plugins).

### Backend Overview & Required Libraries

| Backend Type | Target Storage | Required Packages | State Locking Mechanism |
|---|---|---|---|
| **`local`** | Local filesystem (`testform.state`) | **None** (Built-in) | File-based lock (`.lock`) |
| **`github`** | GitHub repository branch | **None** (Built-in, uses GitHub API) | Git SHA / Commit lock |
| **`s3`** | AWS S3 | `@aws-sdk/client-s3`<br>`@aws-sdk/client-dynamodb` | DynamoDB Table lock (`dynamodb_table`) |
| **`oci`** | Oracle Cloud Object Storage | `@aws-sdk/client-s3` | Native S3-compatible path-style |
| **`azurerm`** | Azure Blob Storage | `@azure/storage-blob` | Native Blob Lease |
| **`gcs`** | Google Cloud Storage | `@google-cloud/storage` | GCS generation / `.tflock` |

---

### 1. GitHub Backend (`github:`)

Stores your state directly in a GitHub repository branch. Ideal for GitOps workflows, CI/CD pipelines, and teams that want cloud-backed shared state **without configuring AWS, Azure, or GCP accounts**.

```yaml
backend:
  github:
    branch: testform-state        # Dedicated branch for state (default: testform-state)
    path: state/testform.state    # Path inside branch (default: state/testform.state)
    token_env: GITHUB_TOKEN       # Token env var (default: inherits provider GITHUB_TOKEN)
```

- **Inherits Provider Configuration:** If `owner` and `repository` are omitted, it automatically inherits the same repository and credentials configured in your `provider.config`.
- **Private State Repository:** You can also point to a separate private repository (e.g. `owner: my-org`, `repository: testform-states`) to keep state isolated from application code.
- **Atomic Locking & Audit Trail:** Uses GitHub's optimistic concurrency control (Git SHA). Every `apply` creates an audited commit, and concurrent writes automatically trigger conflict protection without needing DynamoDB.
- **Zero Dependencies:** Uses Node.js native `fetch`—no additional packages required.

---

### 2. S3 Backend (`s3:`)

Stores the state as a file in an Amazon S3 bucket.

```yaml
backend:
  s3:
    bucket: my-testform-state
    key: testform.state
    region: us-east-1
    profile: default
    dynamodb_table: testform-locks
```

- **Auto-installed Package:** `@aws-sdk/client-s3` (and `@aws-sdk/client-dynamodb` if `dynamodb_table` is configured).
- **`bucket`** (string): Name of the S3 bucket.
- **`key`** (string, optional): State file key. Defaults to `testform.state`.
- **`region`** (string, optional): AWS region. Defaults to `us-east-1` or `AWS_REGION`.
- **`profile`** (string, optional): AWS profile from `~/.aws/credentials`.
- **`dynamodb_table`** (string, optional): Name of a DynamoDB table used for state locking to prevent concurrent modifications.

---

### 3. Oracle Cloud Infrastructure (OCI) Backend (`oci:`)

Stores state in an OCI Object Storage bucket using OCI's S3-compatible API.

```yaml
backend:
  oci:
    bucket: my-oci-bucket
    namespace: my-tenancy-namespace
    region: us-ashburn-1
    key: testform.state
```

- **Option A (Recommended):** Provide `namespace` and `region`. Testform automatically constructs the endpoint:
  `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`
- **Option B (Custom Endpoint):** Provide an explicit `endpoint: "https://..."`.
- **Automatic Path-Style Addressing:** Testform automatically configures `forcePathStyle: true`, required for OCI compatibility.
- **Authentication:** Provide OCI Customer Secret Keys via standard environment variables `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` or `~/.aws/credentials`.

#### 💡 Local Emulators (MiniStack / LocalStack / Floci):
To connect to a local emulator, set `profile: "local"`. Testform enables path-style URLs automatically:
```yaml
backend:
  s3:
    bucket: test-bucket
    profile: local
    region: "http://localhost:4566"
```

---

### 4. AzureRM Backend (`azurerm:`)

Stores the state in an Azure Blob Storage container.

```yaml
backend:
  azurerm:
    resource_group_name: my-resource-group
    storage_account_name: mystorageaccount
    container_name: tfstate
    key: testform.state
    connection_string: "DefaultEndpointsProtocol=https;..."
```

- **Auto-installed Package:** `@azure/storage-blob`
- **`resource_group_name`** (string): Azure resource group.
- **`storage_account_name`** (string): Azure Storage Account.
- **`container_name`** (string): Blob Storage container.
- **`key`** (string, optional): State file name. Defaults to `testform.state`.
- **`connection_string`** (string, optional): Azure connection string. If omitted, uses `AZURE_STORAGE_CONNECTION_STRING` env variable.
- **Native Locking:** AzureRM uses native blob leases—no external database needed.

---

### 5. GCS Backend (`gcs:`)

Stores the state in a Google Cloud Storage bucket.

```yaml
backend:
  gcs:
    bucket: my-testform-state-bucket
    prefix: testform/state
    credentials: /path/to/service-account.json
```

- **Auto-installed Package:** `@google-cloud/storage`
- **`bucket`** (string): GCS bucket name.
- **`prefix`** (string, optional): Prefix inside bucket. Defaults to root.
- **`credentials`** (string, optional): Local path to service account JSON. If omitted, uses Google Application Default Credentials (ADC).

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
