import { ResourceTemplate, ParserScenario } from '@fromeroc9/testform';

export const {{RESOURCE_VAR}}Resource: ResourceTemplate = {
    // Unique resource type identifier (e.g. "provider_entity", "pokedex_register-pokemon")
    type: "{{RESOURCE_TYPE}}",

    /**
     * Canonical attributes evaluated from the Gherkin scenario.
     * These attributes map directly to the provider's resource handler payload (IProviderResourceHandler).
     */
    attributes: (scenario: ParserScenario, context?: any) => ({
        title: scenario.name,
        description: scenario.description,
        tags: scenario.tags,
        // Map custom fields declared in scenario:
        ...scenario.custom?.fields
    }),

    /**
     * Internal state attributes stored directly in the state ledger (.testform/state.json).
     */
    state: {
        status: (scenario: ParserScenario) => scenario.custom?.fields?.status || 'active',
        synced_at: () => new Date().toISOString()
    },

    /**
     * Optional lifecycle hooks to orchestrate provider actions before/after CRUD events.
     */
    lifecycle: {
        beforeCreate: async ({ attributes, scenario, context }) => {
            // Optional pre-validation logic before remote creation
        },
        afterCreate: async ({ id, attributes, provider, scenario, context }) => {
            // Runs after remote creation; receives remote ID and live provider instance
            // e.g. await provider.subirFoto?.(id, './assets/foto.png');
        },
        beforeUpdate: async ({ id, attributes, provider, scenario, context }) => {
            // Runs before remote update
        },
        afterUpdate: async ({ id, attributes, diff, provider, scenario, context }) => {
            // Runs after remote update
        },
        beforeDelete: async ({ id, provider, context }) => {
            // Runs before remote deletion
        },
        afterDelete: async ({ id, provider, context }) => {
            // Runs after remote deletion
        }
    }
};

export default {{RESOURCE_VAR}}Resource;
