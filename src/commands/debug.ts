import { Parser } from '../core/parser';
import { VariableParser } from '../core/variables';
import { Config } from '../core/config';
import { IScope } from '../types';
import { logger } from '../logger';

interface DebugOptions {
    dir: string;
    file: string;
    format: string;
    scope: IScope;
    variables?: VariableParser;
}

export const debugCmd = async (options: DebugOptions) => {
    const { dir, file, format, scope, variables } = options;

    const parser = new Parser(dir, variables);
    const config = new Config(dir);
    const testConfig = {
        identity: config.getIdentity(scope),
        fields: config.getFields(scope),
        convention: config.getConvention(scope)
    };

    // Get original parsed scenarios
    const originalScenarios = parser.content();
    
    // Filter by the provided file name
    const fileScenarios = originalScenarios.filter(s => s.uri && s.uri.includes(file));

    if (fileScenarios.length === 0) {
        logger.error(`No scenarios found for file matching: ${file}`);
        process.exit(1);
    }

    if (format === 'gherkin') {
        console.log(JSON.stringify(fileScenarios, null, 2));
        return;
    }

    if (format === 'testform') {
        // Apply filters
        const filteredScenarios = parser.filter(fileScenarios, testConfig, scope);
        console.log(JSON.stringify(filteredScenarios, null, 2));
        return;
    }

    logger.error(`Invalid format: ${format}. Use 'gherkin' or 'testform'.`);
    process.exit(1);
};
