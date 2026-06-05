"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCmd = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("../core/config");
const parser_1 = require("../core/parser");
const policy_1 = require("../core/policy");
const logger_1 = require("../logger");
const validateCmd = async (options) => {
    const { targetPath = '.', verbose = false, scope, variables, isJson = false, testDirectory, noTests = false, query } = options;
    const logger = new logger_1.Logger(verbose);
    if (isJson) {
        // Suppress logger output when JSON is active
        // But we just won't call it for the important parts
    }
    else {
        logger.info('Validating configuration...', { bold: true });
    }
    let configDir = targetPath;
    let parseDir = testDirectory ? (0, path_1.join)(targetPath, testDirectory) : targetPath;
    try {
        if ((0, fs_1.statSync)(parseDir).isFile()) {
            configDir = (0, path_1.dirname)(parseDir);
        }
    }
    catch (e) {
        // Ignore, handled by next steps
    }
    // Parse feature files
    const parser = new parser_1.Parser(parseDir, variables);
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
        }
        else {
            logger.error(`Failed to read module directory\n\nModule directory ${parseDir} does not exist or cannot be read.`);
        }
        return;
    }
    // Load and validate config (exits on error via notify)
    const config = new config_1.Config(configDir);
    logger.debug(`Configuration loaded: v${config.getConfig().version}`);
    logger.debug(`Found ${documents.length} scenarios across feature files`);
    // Filter by scope (only process files matching the requested scope)
    const SCOPE_CONFIG = {
        testcase: { tag: '@testcase', ext: '.case.feature' },
        testrun: { tag: '@testrun', ext: '.run.feature' },
        testplan: { tag: '@testplan', ext: '.plan.feature' },
    };
    const matchesScope = (s, scopeName) => {
        if (!Object.prototype.hasOwnProperty.call(SCOPE_CONFIG, scopeName))
            return false;
        const cfg = SCOPE_CONFIG[scopeName];
        return s.feature?.tags?.includes(cfg.tag) || s.uri.endsWith(cfg.ext);
    };
    const rawScenarios = documents.filter(s => matchesScope(s, scope));
    if (rawScenarios.length === 0) {
        if (!isJson)
            logger.warn(`No scenarios found for scope "${scope}".`);
        return;
    }
    if (!isJson)
        logger.debug(`Found ${rawScenarios.length} scenarios matching scope "${scope}"`);
    // Filter with DSL
    const data = {
        identity: config.getIdentity(scope),
        fields: config.getFields(scope),
    };
    let filtered = parser.filter(rawScenarios, data, scope);
    if (query) {
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter(s => (s.name && s.name.toLowerCase().includes(lowerQuery)) ||
            (s.custom?.identity && s.custom.identity.toLowerCase().includes(lowerQuery)) ||
            (s.tags && s.tags.some(t => t.toLowerCase().includes(lowerQuery))) ||
            (s.uri && s.uri.toLowerCase().includes(lowerQuery)));
        if (!isJson) {
            logger.info(`--- Query Results for "${query}" ---`, { bold: true });
            if (filtered.length === 0) {
                logger.info(`No scenarios matched the query.`);
            }
            else {
                filtered.forEach(s => {
                    logger.info(`- [${scope}] ${s.custom?.identity || s.name} (File: ${s.uri}:${s.location})`);
                });
            }
            logger.blank();
        }
    }
    // Run policy validation (will print violations via notify or JSON)
    if (!noTests) {
        const hasViolations = policy_1.policy.scanner(filtered, scope, isJson);
        if (hasViolations) {
            const err = new Error("Please fix them before continuing.");
            err.name = "Policy violations found";
            throw err;
        }
    }
    else if (!isJson) {
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
    }
    else {
        logger.success('Success! The configuration is valid.', { bold: true });
        logger.blank();
        logger.info(`  Scenarios: ${filtered.length}`);
        logger.info(`  Scope:     ${scope}`);
    }
};
exports.validateCmd = validateCmd;
