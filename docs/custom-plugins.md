# Custom Plugins & Extensions

Testform is designed to be highly extensible. You can register your own custom resources and validation policies by injecting them into the CLI at runtime.

This allows you to enforce organization-specific linting rules for your Gherkin files or connect Testform to custom internal systems alongside GitHub.

## 1. Custom Validation Policies

You can write custom rules to validate your `.feature` files before a `plan` or `apply` is executed. Custom policies will be evaluated during the `testform validate` command.

Use the `registerPolicy` function to add your rule:

```javascript
// my-testform-plugin.js
const { registerPolicy } = require('@fromeroc9/testform/core/policy');

/**
 * registerPolicy(id, scope, description, runner)
 */
registerPolicy(
  'P-CUSTOM-001', 
  'testcase', 
  'All testcases must have a @priority tag',
  (scenario, isGlobal) => {
    const violations = [];
    
    // Check if the scenario has any tag starting with @priority
    const hasPriority = scenario.tags.some(tag => tag.toLowerCase().startsWith('@priority'));
    
    if (!hasPriority) {
        violations.push({
            id: 'P-CUSTOM-001',
            level: 'error', // or 'warning'
            message: `Scenario '${scenario.name}' is missing a @priority tag.`,
            location: scenario.location
        });
    }

    return violations;
  }
);
```

## 2. Custom Resources

Testform uses an adapter pattern to map Gherkin scenarios to external APIs (like `github_testcase`). You can register your own `ResourceTemplate` to map scenarios to Jira, Azure DevOps, or your own internal API.

Use the `registerResource` function:

```javascript
// my-testform-plugin.js
const { registerResource } = require('@fromeroc9/testform/adapters/resources');

registerResource({
    type: 'jira_testcase',
    evaluate: (scenario, context) => {
        // Map the Gherkin scenario to a Jira API payload
        return {
            fields: {
                project: { key: "TEST" },
                summary: scenario.name,
                description: scenario.description,
                issuetype: { name: "Test Case" }
            }
        };
    }
});
```

## How to Load Plugins

To ensure Testform loads your custom policies and resources, you must execute the CLI by requiring your plugin file first via Node.js:

```bash
node --require ./my-testform-plugin.js ./node_modules/.bin/testform plan
```
