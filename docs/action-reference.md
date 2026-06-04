# TestForm GitHub Action Reference

The official GitHub action for TestForm enables seamless execution of plan, apply, and sync workflows in your CI/CD pipelines.

## Usage

```yaml
name: TestForm Sync
on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  testform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Testform
        uses: testform/testform-action@v1
        with:
          version: 'latest'

      - name: TestForm Plan (Testcases)
        if: github.event_name == 'pull_request'
        run: testform plan -scope testcase -out tfplan.json

      - name: TestForm Apply (Testcases)
        if: github.event_name == 'push'
        run: testform apply -auto-approve -scope testcase
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Available Inputs (for the Action)

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `version` | The version of the CLI to install (e.g., `1.0.0`, `latest`) | No | `latest` |

## Authentication

TestForm reads the `GITHUB_TOKEN` environment variable automatically, or you can configure a custom environment variable name in your `testform.json`.

```json
{
  "github": {
    "owner": "MyOrg",
    "repository": "MyRepo",
    "tokenEnv": "GITHUB_TOKEN"
  }
}
```

## Automated PR Comments

When run in a Pull Request context, it is common to output the TestForm Plan as JSON (`-json` flag) and use a secondary step to parse the JSON and post a PR comment showing the exact issues that will be created or modified.
