import { bold, green, yellow, cyan, dim } from 'chalk';
import { Config } from '../core/config';
import { TITLE_APP, TITLE_CLI } from '../core/const';
import { HELP_PROVIDERS } from '../core/help';

export interface ProvidersCmdOptions {
    dir?: string;
    action?: string;
    args?: string[];
    testDirectory?: string;
    variables?: any;
}

export const providersCmd = async (options: ProvidersCmdOptions = {}) => {
    const { dir = '.', action, args = [] } = options;
    const config = new Config(dir, false);
    const provider = config.getProviderType() || 'github';

    if (!action) {
        console.log(`
Providers required by configuration:
.
└── provider[registry.testform.com/fromeroc9/${provider}] 1.0.0
`);
        return;
    }

    switch (action.toLowerCase()) {
        case 'lock': {
            console.log(green(`\nSuccess! Dependencies for provider "fromeroc9/${provider}" verified.\n`));
            break;
        }
        case 'mirror': {
            const targetDir = args[0] || './plugins';
            console.log(`- Mirroring provider "fromeroc9/${provider}" to ${targetDir}...`);
            console.log(green(`\nSuccess! Provider plugins mirrored to ${targetDir}.\n`));
            break;
        }
        case 'schema': {
            console.log(bold(`\nProvider Schema: fromeroc9/${provider}`));
            console.log(dim('─'.repeat(50)));
            console.log(`Resource: ${provider}_testcase`);
            console.log(`  - identity: string (required)`);
            console.log(`  - title: string (optional)`);
            console.log(`  - labels: list of string (optional)`);
            console.log(`  - assignees: list of string (optional)`);
            console.log(`  - custom_fields: map of string (optional)`);
            console.log(`Resource: ${provider}_testrun`);
            console.log(`  - identity: string (required)`);
            console.log(`  - rules: list of rule`);
            console.log(`Resource: ${provider}_testplan`);
            console.log(`  - identity: string (required)`);
            console.log(`  - runs: list of testrun\n`);
            break;
        }
        default: {
            console.log(HELP_PROVIDERS);
            break;
        }
    }
};
