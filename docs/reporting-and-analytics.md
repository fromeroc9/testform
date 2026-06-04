# Reporting & Analytics

Testform isn't just about provisioning test infrastructure; it's also a powerful engine for extracting metrics. Because Testform stores the exact execution status and metadata of all your tests in the local `testform.state` file, you can generate multi-dimensional reports instantly without needing to make slow API queries to GitHub.

## The `report` Command

You generate reports using the `testform report` CLI command:

```bash
testform report <type> [options]
```

### Report Types & Scopes

Testform groups reports strictly by their analytical Scope. This ensures reports only analyze the right type of data:

#### 📦 Scope: Test Case
Reports focusing on static test inventory and repository health.
1. **`testcase-summary`**: A comprehensive inventory of all your test cases, displaying their latest execution status, labels, and assignees.
2. **`test-case-activity`**: Dashboard of test cases with automation coverage, top creators, and growth trends.

#### 🏃 Scope: Test Run
Reports focusing on the execution and stability of tests at a point in time.
3. **`testrun-summary`**: Groups data by **Test Run**. Shows pass/fail metrics for each execution cycle (e.g., Sprint 1 Regression).
4. **`testrun-detailed`**: In-depth view of a specific Test Run, including trends, linked requirements, and test case status breakdown.

#### 📋 Scope: Test Plan
Reports summarizing one or multiple Test Plans and all their underlying executions.
5. **`testplan-summary`**: High-level progress dashboard tracking total test cases linked to a test plan across multiple test runs.

#### 🌐 Cross-Scope (Multi-dimensional)
Reports that cross-reference data between requirements, test cases, and test runs.
4. **`defects`**: An exclusive list of failed or blocked tests, complete with direct clickable links to the corresponding GitHub Issue.
5. **`traceability`**: Maps requirements to tests and their latest execution results.
6. **`coverage`**: Percentage-based aggregation grouped by tags.
7. **`two-dimensional`**: A dual-axis matrix distributing statuses across components.
8. **`raw`**: Extracts raw JSON/CSV data of the entire state for custom BI tools.

## Dynamic Field Mapping (JSONPath)

Testform Report Engine is 100% agnostic. Because different teams name their custom fields differently (e.g., `priority` vs `prioridad`), you must map the semantic concepts to your custom fields using JSONPath "dot-notation" in `testform.json`.

```json
{
  "report_mapping": {
    "automation": "attributes.custom_fields.automate",
    "priority": "attributes.custom_fields.priority",
    "type": "attributes.custom_fields.testCaseType",
    "creator": "attributes.assignees[0]"
  }
}
```

### Supported Mapping Keys by Report

Here is the exact list of semantic keys that Testform reports look for. If you don't map them, the reports will gracefully fall back to default logic or display "N/A".

| Mapping Key | Used In Report | Description | Default Fallback if missing |
| :--- | :--- | :--- | :--- |
| `automation` | `test-case-activity` | Determines if a test is Automated, Not Required, etc. | Looks for `automate` or `automation` in `custom_fields`. |
| `priority` | `test-case-activity`, `testrun-detailed`, `testplan-summary` | Priority of the test case (e.g. High, Medium, Low). | Looks for `priority` or `Priority` in `custom_fields`. |
| `type` | `test-case-activity`, `testplan-summary` | Type of test (e.g. Regression, Smoke, UI). | Looks for `type`, `Type`, or `testCaseType` in `custom_fields`. |
| `creator` | `test-case-activity` | The user who authored or owns the test case. | The first GitHub user in the `assignees` list. |

When Testform generates a report, it safely evaluates these paths against the unified `StateResource` schema to extract the correct values. If a path doesn't exist, it elegantly falls back to default values.

### Output Formats

You can export your reports into three different formats using the `--format` flag:

- **Markdown (`--format md`)**: The default format. Perfect for pasting into GitHub PR comments, Wikis, or Slack. Uses visual emojis (✅, ❌, ⚠️) for quick scanning.
- **CSV (`--format csv`)**: Comma-separated values. Ideal for downloading raw data and opening it in Microsoft Excel or Google Sheets to build your own pivot tables.
- **JSON (`--format json`)**: A hierarchical, machine-readable format. Perfect if you want to pipe the output into another tool or a custom dashboard.

*(Tip: Use the `--out <path>` flag to save the report directly to a file, e.g., `--out my-report.csv`).*

## Advanced Filtering

You can slice and dice your data using the `--filter` flag. Testform supports filtering by *any* state attribute, including native fields (`status`, `milestone`, `assignees`) and your `custom_fields`.

You can pass the `--filter` flag multiple times to apply "AND" logic.

### Filtering Examples

**1. Show defects only for a specific milestone:**
```bash
testform report defects --filter milestone=v1.0
```

**2. See execution metrics for tests assigned to a specific user:**
```bash
testform report testrun-summary --filter assignees=@alice
```

**3. Filter by a Custom Field (e.g., Priority):**
*(Assuming you defined `priority` in your `testform.json`)*
```bash
testform report testcase-summary --filter priority=high
```

**4. Export a highly filtered matrix to CSV for Excel:**
```bash
testform report two-dimensional --filter status=passed --filter labels=@sprint-2 --format csv --out sprint2_passed.csv
```

With Testform Reporting, you bring the analytical power of enterprise test management tools straight to your terminal, completely decoupled from vendor lock-in.
