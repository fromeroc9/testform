# testform-provider-starter

Custom Testform provider plugin for platform integration.

## Development

```bash
npm install
npm test
npm run build
```

## Consumption in Testform

Declare this provider in your `main.yml`:

```yaml
testform:
  required_providers:
    starter-provider: "git::https://github.com/my-org/testform-provider-starter.git?ref=v1.0.0"

provider:
  starter-provider:
    token_env: "PROVIDER_TOKEN"
```
