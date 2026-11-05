# Testform Provider Starter Template

This repository is a fully-structured starter template for building custom Testform providers (e.g. for GitLab, Jira, Zephyr, Qase, TestRail, or proprietary QA backends).

---

## Project Structure

```
.
├── README.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts        # Main Provider class implementing IProvider
│   ├── client.ts       # Typed HTTP client with token authentication
│   └── types.ts        # Interfaces and contracts
└── test/
    └── provider.test.ts # Unit tests with Vitest
```

---

## Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run tests:**
   ```bash
   npm test
   ```

3. **Build distribution package:**
   ```bash
   npm run build
   ```

---

## How to Consume in Testform

### Option A: From a Git Repository (Recommended)
Push this repository to your company's GitLab / GitHub, tag a version (e.g. `v1.0.0`), and add to `main.yml`:

```yaml
testform:
  required_providers:
    myprovider: "git::https://gitlab.mycompany.com/qa/testform-provider-myprovider.git?ref=v1.0.0"

provider:
  myprovider:
    host: "https://mytracker.mycompany.com"
    token_env: "TRACKER_API_TOKEN"
```

### Option B: As an NPM Package
Publish to your private package registry and declare:

```yaml
testform:
  required_providers:
    myprovider:
      source: "@my-org/testform-provider-myprovider"
      version: "1.0.0"
```

### Option C: Local Path
Reference the repository directory directly on disk:

```yaml
testform:
  required_providers:
    myprovider: "./path/to/testform-provider-myprovider"
```
