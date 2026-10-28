import { statSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { Config } from '../core/config';
import { Parser } from '../core/parser';
import { VariableParser } from '../core/variables';
import { policy } from '../core/policy';
import { Logger } from '../core/logger';
import { IScope } from '../core/types';
import { matchesScope, matchesTarget } from '../core/selector';
import { DependencyResolver } from '../core/dependencies';
import { FILE_CONFIG } from '../core/const';
import { resolveScopes } from '../core/cli';

interface ValidateCmdOptions {
    targetPath?: string;
    dir?: string;
    verbose?: boolean;
    scope?: IScope | 'all';
    target?: string | string[];
    variables?: VariableParser;
    isJson?: boolean;
    testDirectory?: string;
    noTests?: boolean;
    query?: string;
}

export const validateCmd = async (options: ValidateCmdOptions) => {
    const {
        targetPath = '.',
        dir = '.',
        verbose = false,
        scope,
        target,
        variables,
        isJson = false,
        testDirectory,
        noTests = false,
        query
    } = options;
    const logger = new Logger(verbose);
    if (!isJson) {
        logger.info('Validating configuration...', { bold: true });
    }

    let configDir = dir;
    let parseDir = dir;
    let effectiveTarget: string | string[] | undefined = target;

    // Check if targetPath was provided and whether it is a file or directory
    if (targetPath && targetPath !== '.') {
        try {
            if (existsSync(targetPath) && statSync(targetPath).isFile()) {
                effectiveTarget = target || targetPath;
                parseDir = dirname(targetPath);
                if (!existsSync(join(configDir, FILE_CONFIG)) && existsSync(join(parseDir, FILE_CONFIG))) {
                    configDir = parseDir;
                }
            } else {
                parseDir = targetPath;
                configDir = targetPath;
            }
        } catch {
            parseDir = targetPath;
        }
    }

    if (testDirectory) {
        parseDir = join(parseDir, testDirectory);
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
                    detail: `Module directory ${parseDir} does not exist or cannot be read.`
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
        const provName = isProviderMissing ? `a provider to be defined in ${FILE_CONFIG}` : `provider "${providerType}"`;
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

    const scopesToRun = resolveScopes(scope, effectiveTarget);
    let totalScenarios = 0;
    const scopeCounts: Record<string, number> = {};
    const allFiltered: any[] = [];

    // Filter scenarios by scope and target
    for (const sc of scopesToRun) {
        const matchPattern = config.getMatch?.(sc);
        let rawScenarios = documents.filter(s => matchesScope(s, sc, matchPattern));

        if (effectiveTarget) {
            rawScenarios = rawScenarios.filter(s => {
                const id = s.custom?.identity ? `${s.uri}.${s.custom.identity}` : s.uri;
                return matchesTarget(id, effectiveTarget!, sc) || matchesTarget(s.uri, effectiveTarget!, sc);
            });
        }

        if (rawScenarios.length === 0) {
            continue;
        }

        const data = {
            identity: config.getIdentity(sc),
            fields: config.getFields(sc),
        };

        let filtered = parser.filter(rawScenarios, data, sc);

        if (query) {
            const lowerQuery = query.toLowerCase();
            filtered = filtered.filter(s =>
                (s.name && s.name.toLowerCase().includes(lowerQuery)) ||
                (s.custom?.identity && s.custom.identity.toLowerCase().includes(lowerQuery)) ||
                (s.tags && s.tags.some((t: any) => (typeof t === 'string' ? t : t.name).toLowerCase().includes(lowerQuery))) ||
                (s.uri && s.uri.toLowerCase().includes(lowerQuery))
            );

            if (!isJson) {
                logger.info(`--- Query Results for "${query}" (${sc}) ---`, { bold: true });
                if (filtered.length === 0) {
                    logger.info(`No scenarios matched the query in scope "${sc}".`);
                } else {
                    filtered.forEach(s => {
                        logger.info(`- [${sc}] ${s.custom?.identity || s.name} (File: ${s.uri}:${s.location})`);
                    });
                }
                logger.blank();
            }
        }

        if (filtered.length > 0) {
            scopeCounts[sc] = filtered.length;
            totalScenarios += filtered.length;
            allFiltered.push(...filtered);
        }
    }

    if (allFiltered.length === 0) {
        if (!isJson) {
            if (effectiveTarget) {
                const targetStr = Array.isArray(effectiveTarget) ? effectiveTarget.join(', ') : effectiveTarget;
                logger.warn(`No scenarios found matching target "${targetStr}".`);
            } else {
                logger.warn(`No scenarios found across the configuration.`);
            }
        }
        return;
    }

    if (!isJson) {
        const activeScopeNames = Object.keys(scopeCounts);
        for (const sc of activeScopeNames) {
            logger.debug(`Found ${scopeCounts[sc]} scenarios matching scope "${sc}"`);
        }
    }

    // Validate dependencies and cycle detection
    const depResolver = new DependencyResolver(configDir);
    try {
        const getCanonicalId = (s: any): string => {
            const raw = s.custom?.identity;
            if (!raw) return `${s.uri}.${s.name}`;
            if (raw.startsWith(s.uri) || raw === s.uri) return raw;
            return `${s.uri}.${raw}`;
        };

        depResolver.sortTopologically(
            allFiltered,
            getCanonicalId,
            (s) => s.tags ? s.tags.map((t: any) => typeof t === 'string' ? t : (t as any).name) : []
        );
    } catch (err: any) {
        if (isJson) {
            console.log(JSON.stringify({
                valid: false,
                error_count: 1,
                warning_count: 0,
                diagnostics: [{
                    severity: 'error',
                    summary: 'Circular dependency detected',
                    detail: err.message
                }]
            }, null, 2));
        } else {
            logger.error(`Circular dependency detected\n\n${err.message}`);
        }
        return;
    }

    // Run policy validation (will print violations via notify or JSON)
    if (!noTests) {
        if (policy && typeof policy.loadCustomPolicies === 'function') {
            await policy.loadCustomPolicies(configDir);
        }
        const policiesConfig = (config && typeof config.getPolicies === 'function') ? config.getPolicies() : undefined;
        if (policiesConfig && policy && typeof policy.configure === 'function') {
            policy.configure(policiesConfig);
        }
        for (const sc of Object.keys(scopeCounts) as IScope[]) {
            const scFiltered = allFiltered.filter(s => matchesScope(s, sc, config.getMatch?.(sc)));
            const hasViolations = policy.scanner(scFiltered, sc, isJson);
            if (hasViolations) {
                const err = new Error("Please fix them before continuing.");
                err.name = "Policy violations found";
                throw err;
            }
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
        logger.info(`  Scenarios: ${totalScenarios}`);
        if (effectiveTarget) {
            const targetStr = Array.isArray(effectiveTarget) ? effectiveTarget.join(', ') : effectiveTarget;
            logger.info(`  Target:    ${targetStr}`);
        }
    }
};
