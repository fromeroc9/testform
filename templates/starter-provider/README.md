# Testform Provider: Starter

Custom provider template implementing the agnostic Testform `IProvider` specification.

## Usage in Testform Projects

Add this provider to your project's `main.yml`:

```yaml
testform:
  required_providers:
    starter-provider: "git::https://github.com/my-org/testform-provider-starter.git?ref=v1.0.0"

provider:
  starter-provider:
    baseUrl: "https://api.myplatform.com"
    tokenEnv: "STARTER_API_TOKEN"
```

## Development

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Build distribution bundle
npm run build
```
