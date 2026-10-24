import { statSync } from 'fs';
import { dirname, join } from 'path';
import { Config } from '../core/config';
import { Parser } from '../core/parser';
import { VariableParser } from '../core/variables';
import { policy } from '../core/policy';
import { Logger } from '../core/logger';
import { IScope } from '../core/types';
import { matchesScope } from '../core/selector';

interface ValidateCmdOptions {
    targetPath?: string;
    verbose?: boolean;
    scope: IScope;
    variables?: VariableParser;
    isJson?: boolean;
    testDirectory?: string;
    noTests?: boolean;
    query?: string;
}

export const validateCmd = async (options: ValidateCmdOptions) => {
    const {
        targetPath = '.',
        verbose = false,
        scope,
        variables,
        isJson = false,
        testDirectory,
        noTests = false,
        query
    } = options;
    const logger = new Logger(verbose);
    if (isJson) {
        // Suppress logger output when JSON is active
        // But we just won't call it for the important parts
    } else {
        logger.info('Validating configuration...', { bold: true });
    }

    let configDir = targetPath;
    let parseDir = testDirectory ? join(targetPath, testDirectory) : targetPath;
    try {
        if (statSync(parseDir).isFile()) {
            configDir = dirname(parseDir);
        }
    } catch (e) {
        // Ignore, handled by next steps
    }

    // Parse feature files
    const parser = new Parser(parseDir, variables);
    const documents = parser.content();

    if (documents.length === 0) {
        if (isJson) {
            console.log(JSON.stringify({
                valid: false,
                error_count: 1,
                warning_count: 0,
                diagnostics: [{
                    severity: 'error',
                    summary: 'Failed to read module directory',
                    detail: `Module directory ${targetPath} does not exist or cannot be read.`
                }]
            }, null, 2));
        } else {
            logger.error(`Failed to read module directory\n\nModule directory ${parseDir} does not exist or cannot be read.`);
        }
        return;
    }

    // Load and validate config (exits on error via notify)
    const config = new Config(configDir);
    logger.debug(`Configuration loaded: v${config.getConfig().version}`);

    // Validate provider configuration
    const rawProvider = (config.getConfig() as any).provider;
    const providerType = config.getProviderType();
    const KNOWN_PROVIDERS = ['github', 'gitlab', 'local', 'custom'];

    const isProviderMissing = !rawProvider ||
        (typeof rawProvider === 'string' && rawProvider.trim() === '') ||
        (typeof rawProvider === 'object' && Object.keys(rawProvider).length === 0);

    if (isProviderMissing || !KNOWN_PROVIDERS.includes(providerType)) {
        const provName = isProviderMissing ? 'a provider to be defined in testform.yml' : `provider "${providerType}"`;
        if (isJson) {
            console.log(JSON.stringify({
                valid: false,
                error_count: 1,
                warning_count: 0,
                diagnostics: [{
                    severity: 'error',
                    summary: 'Missing required provider',
                    detail: `This configuration requires ${provName}, but that provider isn't available. Run "testform init" to configure it.`
                }]
            }, null, 2));
        } else {
            logger.push({
                type: 'error',
                title: 'Missing required provider',
                detail: [
                    `This configuration requires ${provName}, but that provider isn't available. You may be able`,
                    `to install or configure it automatically by running:`,
                    `  testform init`
                ],
                close: true
            });
        }
        return;
    }

    logger.debug(`Found ${documents.length} scenarios across feature files`);

    // Filter by scope (only process files matching the requested scope)
    const rawScenarios = documents.filter(s => matchesScope(s, scope));

    if (rawScenarios.length === 0) {
        if (!isJson) logger.warn(`No scenarios found for scope "${scope}".`);
        return;
    }

    if (!isJson) logger.debug(`Found ${rawScenarios.length} scenarios matching scope "${scope}"`);

    // Filter with DSL
    const data = {
        identity: config.getIdentity(scope),
        fields: config.getFields(scope),
    };

    let filtered = parser.filter(rawScenarios, data, scope);

    if (query) {
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter(s =>
            (s.name && s.name.toLowerCase().includes(lowerQuery)) ||
            (s.custom?.identity && s.custom.identity.toLowerCase().includes(lowerQuery)) ||
            (s.tags && s.tags.some(t => t.toLowerCase().includes(lowerQuery))) ||
            (s.uri && s.uri.toLowerCase().includes(lowerQuery))
        );

        if (!isJson) {
            logger.info(`--- Query Results for "${query}" ---`, { bold: true });
            if (filtered.length === 0) {
                logger.info(`No scenarios matched the query.`);
            } else {
                filtered.forEach(s => {
                    logger.info(`- [${scope}] ${s.custom?.identity || s.name} (File: ${s.uri}:${s.location})`);
                });
            }
            logger.blank();
        }
    }

    // Run policy validation (will print violations via notify or JSON)
    if (!noTests) {
        const hasViolations = policy.scanner(filtered, scope, isJson);
        if (hasViolations) {
            const err = new Error("Please fix them before continuing.");
            err.name = "Policy violations found";
            throw err;
        }
    } else if (!isJson) {
        logger.info(`Skipping policy validation (-no-tests).`);
    }

    // If we reach here, all validations passed
    if (isJson) {
        console.log(JSON.stringify({
            valid: true,
            error_count: 0,
            warning_count: 0,
            diagnostics: []
        }, null, 2));
    } else {
        logger.success('Success! The configuration is valid.', { bold: true });
        logger.blank();
        logger.info(`  Scenarios: ${filtered.length}`);
        logger.info(`  Scope:     ${scope}`);
    }
}
