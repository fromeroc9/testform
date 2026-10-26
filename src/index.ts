#!/usr/bin/env node
import { cac } from 'cac';
import { cyan } from 'chalk';
import { arch, platform } from 'node:process';
import { resolve } from 'path';

import { existsSync, readFileSync } from 'fs';
import { Config } from './core/config';
import { initCmd } from './commands/init';
import { planCmd } from './commands/plan';
import { validateCmd } from './commands/validate';
import { applyCmd } from './commands/apply';
import { destroyCmd } from './commands/destroy';
import { showCmd } from './commands/show';
import { outputCmd } from './commands/output';
import { refreshCmd } from './commands/refresh';
import { diffCmd } from './commands/diff';
import { importCmd } from './commands/import';
import { forceUnlockCmd } from './commands/force-unlock';
import { stateCmd } from './commands/state';
import { taintCmd } from './commands/taint';
import { graphCmd } from './commands/graph';
import { fmtCmd } from './commands/fmt';
import { loginCmd } from './commands/login';
import { logoutCmd } from './commands/logout';
import { workspaceCmd } from './commands/workspace';
import { reportCmd } from './commands/report';
import { suiteCmd } from './commands/suite';
import { toolCmd } from './commands/tool';
import { printCmd } from './commands/print';
import { queryCmd } from './commands/query';
import { ephemeralCmd } from './commands/ephemeral';
import { providersCmd } from './commands/providers';
import { functionsCmd } from './commands/functions';
import { IScope } from './core/types';
import { VariableParser } from './core/variables';
import chalk from 'chalk';
import { logger } from './core/logger';
import { TITLE_APP, TITLE_CLI, VERSION_CONFIG, VERSION_STATE, VERSION_CLI, FILE_CONFIG, FILE_STATE } from './core/const';
import { getCommandHelp, HELP_GLOBAL } from './core/help';
import { TestformError } from './core/errors';

import {
    resolveWorkDir as getWorkDir,
    resolveVariableParser as getVariableParser,
    normalizeScope as getScope,
    normalizeCliArgs as normalizeArgv,
    compareCliVersions as compareVersions
} from './core/cli';

async function fetchLatestNpmVersion(): Promise<string | undefined> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const res = await fetch('https://registry.npmjs.org/@fromeroc9/testform/latest', {
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
            const data: any = await res.json();
            return data.version;
        }
    } catch {
        // Silently ignore network timeouts or offline errors
    }
    return undefined;
}

async function printVersion(isJson: boolean = false, detailed: boolean = false): Promise<void> {
    const rawPlatform = platform === 'win32' ? 'windows' : platform;
    const rawArch = arch === 'x64' ? 'amd64' : arch;
    const platformArch = `${rawPlatform}_${rawArch}`;

    const latestVersion = process.env.TESTSTATE_LATEST_VERSION || await fetchLatestNpmVersion();
    const isOutdated = Boolean(latestVersion && compareVersions(VERSION_CLI, latestVersion) < 0);

    if (isJson) {
        const providerSelections: Record<string, string> = {};
        try {
            const config = new Config(process.cwd(), false);
            const pType = config.getProviderType();
            if (pType && pType !== 'local') {
                providerSelections[`registry.testform.io/fromeroc9/${pType}`] = '1.0.0';
            }
        } catch {}

        const payload = {
            testform_version: VERSION_CLI,
            platform: platformArch,
            provider_selections: providerSelections,
            testform_outdated: isOutdated
        };
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log(cyan(`${TITLE_APP} v${VERSION_CLI}`));
    console.log(`on ${platformArch}`);

    if (detailed) {
        console.log(`+ Config Version: ${VERSION_CONFIG} (${FILE_CONFIG})`);
        console.log(`+ State Version: ${VERSION_STATE} (${FILE_STATE})`);
    }

    if (isOutdated) {
        console.log('');
        console.log(`Your version of ${TITLE_APP} is out of date! The latest version`);
        console.log(`is ${latestVersion}. You can update by running:`);
        console.log(`  npm install -g @fromeroc9/testform`);
    }
}

export function createCli() {
    const cli = cac(TITLE_CLI);

    // Global options
    cli.option('-C, --chdir <dir>', 'Working directory (default: current directory)', { default: '.' });
    cli.option('-s, --scope <scope>', 'Scope filter (testcase | testrun | testplan | all)');
    cli.option('-v, --verbose', 'Show detailed debug output');
    cli.option('--no-color', 'Disable colorized console output');
    cli.option('--project-id <id>', 'Override the default project ID defined in your main.yml');
    cli.option('--projectId <id>', 'Alias for --project-id');
    cli.option('--var <var>', 'Set a variable value (key=value)');
    cli.option('--var-file <file>', 'Load variables from a YAML file');

    // ─── init ─────────────────────────────────────────────────────────────
    cli.command('init', 'Initialize a new Testform workspace')
        .option('--backend-type <type>', 'Backend type to initialize (local | github | s3 | azurerm | gcs | oci)')
        .option('--backend-config <config>', 'Backend configuration override')
        .option('--provider <type>', 'Provider type to initialize (github | local | gitlab)')
        .option('--provider-type <type>', 'Alias for --provider')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .option('--reconfigure', 'Reconfigure backend')
        .option('--migrate-state', 'Migrate state to new backend')
        .option('--backend', 'Configure backend', { default: true })
        .option('--json', 'Output results in JSON format')
        .option('--input', 'Allow interactive input', { default: true })
        .action(async (options) => {
            const workDir = getWorkDir(options);
            const resolvedBackendType = options.backendType || (typeof options.backend === 'string' ? options.backend : undefined);
            const resolvedProviderType = options.provider || options.providerType;
            const backendEnabled = options.backend !== false && options.backend !== 'false';

            await initCmd({
                dir: workDir,
                backendType: resolvedBackendType,
                providerType: resolvedProviderType,
                verbose: Boolean(options.verbose),
                backendConfigRaw: options.backendConfig,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s',
                reconfigure: options.reconfigure,
                migrateState: options.migrateState,
                backendEnabled: backendEnabled,
                isJson: options.json,
                inputEnabled: options.input ?? true
            });
        });

    // ─── validate ─────────────────────────────────────────────────────────
    cli.command('validate [targetPath]', 'Check feature files for syntax and DSL violations')
        .option('--json', 'Output diagnostics in JSON format')
        .option('--test-directory <dir>', 'Subdirectory containing test files')
        .option('--no-tests', 'Suppress test execution checks')
        .option('--query <query>', 'Filter query for validation')
        .option('--var <var>', 'Set a variable value (key=value)')
        .option('--var-file <file>', 'Load variable values from a YAML file')
        .action(async (targetPath, options) => {
            const workDir = getWorkDir(options);
            const validateDir = targetPath || workDir;
            const { singleScope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);

            await validateCmd({
                targetPath: validateDir,
                verbose: Boolean(options.verbose),
                scope: singleScope,
                variables: variableParser,
                isJson: options.json,
                testDirectory: options.testDirectory,
                noTests: options.tests === false,
                query: options.query
            });
        });

    // ─── plan ─────────────────────────────────────────────────────────────
    cli.command('plan', 'Generate and show an execution plan')
        .option('-o, --out <path>', 'Write the plan to the given file')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .option('--input', 'Allow interactive input', { default: true })
        .option('--json', 'Output results in JSON format')
        .option('--detailed-exitcode', 'Return detailed exit code on plan changes')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .option('--target <target>', 'Target a specific resource')
        .option('--destroy', 'Generate plan to destroy all resources')
        .option('--refresh', 'Refresh remote state before planning', { default: true })
        .option('--refresh-only', 'Only refresh state without planning changes')
        .option('--replace <target>', 'Force replacement of specified resource')
        .option('--parallelism <n>', 'Concurrent operation limit')
        .option('--compact-warnings', 'Show warnings in compact form')
        .option('--test-directory <dir>', 'Directory containing feature files')
        .action(async (options) => {
            const workDir = getWorkDir(options);
            const { scope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);

            await planCmd({
                dir: workDir,
                verbose: Boolean(options.verbose),
                scope,
                outPath: options.out,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s',
                input: options.input !== false && options.input !== 'false',
                variables: variableParser,
                isJson: options.json,
                detailedExitCode: options.detailedExitcode,
                statePath: options.state,
                backupPath: options.backup,
                target: options.target,
                destroyPlan: options.destroy,
                refresh: options.refresh ?? true,
                refreshOnly: options.refreshOnly,
                replaceTargets: options.replace,
                parallelism: options.parallelism,
                compactWarnings: options.compactWarnings ?? false,
                testDirectory: options.testDirectory
            });
        });

    // ─── apply ────────────────────────────────────────────────────────────
    cli.command('apply [planFile]', 'Create or update infrastructure according to configuration')
        .option('-a, --auto-approve', 'Skip interactive approval of plan')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .option('--input', 'Allow interactive input', { default: true })
        .option('--json', 'Output results in JSON format')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .option('--target <target>', 'Target a specific resource')
        .option('--refresh', 'Refresh remote state before applying', { default: true })
        .option('--refresh-only', 'Only refresh state without applying changes')
        .option('--replace <target>', 'Force replacement of specified resource')
        .option('--parallelism <n>', 'Concurrent operation limit')
        .option('--compact-warnings', 'Show warnings in compact form')
        .option('--test-directory <dir>', 'Directory containing feature files')
        .action(async (planFile, options) => {
            const workDir = getWorkDir(options);
            const { scope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);

            await applyCmd({
                dir: workDir,
                autoApprove: Boolean(options.autoApprove),
                verbose: Boolean(options.verbose),
                scope,
                planFile,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s',
                input: options.input ?? true,
                variables: variableParser,
                statePath: options.state,
                backupPath: options.backup,
                target: options.target,
                refresh: options.refresh ?? true,
                refreshOnly: options.refreshOnly,
                replaceTargets: options.replace,
                parallelism: options.parallelism,
                compactWarnings: options.compactWarnings ?? false,
                testDirectory: options.testDirectory
            });
        });

    // ─── destroy ──────────────────────────────────────────────────────────
    cli.command('destroy', 'Destroy all remote-managed test resources')
        .option('-a, --auto-approve', 'Skip interactive approval')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .option('--input', 'Allow interactive input', { default: true })
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .action(async (options) => {
            const workDir = getWorkDir(options);
            const { scope } = getScope(options);

            await destroyCmd({
                dir: workDir,
                autoApprove: Boolean(options.autoApprove),
                verbose: Boolean(options.verbose),
                scope,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s',
                input: options.input ?? true,
                statePath: options.state,
                backupPath: options.backup
            });
        });

    // ─── show ─────────────────────────────────────────────────────────────
    cli.command('show [path]', 'Inspect Testform state or a plan file')
        .option('--json', 'Output state in JSON format')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .action(async (path, options) => {
            const workDir = getWorkDir(options);
            await showCmd({
                path,
                isJson: options.json,
                verbose: Boolean(options.verbose),
                dir: workDir,
                statePath: options.state,
                backupPath: options.backup
            });
        });

    // ─── output ───────────────────────────────────────────────────────────
    cli.command('output [name]', 'Read an output from a state file')
        .option('--state <path>', 'Path to the state file')
        .option('--json', 'Produce output in a machine-readable JSON format')
        .option('--raw', 'Print raw string value without formatting')
        .action(async (name, options) => {
            const workDir = getWorkDir(options);
            const variableParser = getVariableParser(options, workDir);

            await outputCmd({
                dir: workDir,
                name,
                statePath: options.state,
                isJson: Boolean(options.json),
                raw: Boolean(options.raw),
                variables: variableParser
            });
        });

    // ─── refresh ──────────────────────────────────────────────────────────
    cli.command('refresh', 'Update the state file against remote target platform')
        .option('--target <target>', 'Resource to target (can be specified multiple times)')
        .option('--var <var>', 'Set a variable value')
        .option('--var-file <file>', 'Load variable values from file')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .option('--parallelism <n>', 'Concurrent operation limit')
        .option('--compact-warnings', 'Show warnings in compact form')
        .action(async (options) => {
            const workDir = getWorkDir(options);
            const { scope } = getScope(options);

            await refreshCmd({
                dir: workDir,
                verbose: Boolean(options.verbose),
                scope,
                target: options.target,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s',
                statePath: options.state,
                backupPath: options.backup,
                parallelismRaw: options.parallelism,
                compactWarnings: options.compactWarnings ?? false
            });
        });

    // ─── diff ─────────────────────────────────────────────────────────────
    cli.command('diff', 'Display human-readable difference between local and state')
        .option('--remote', 'Detect and compare against remote target platform')
        .option('-i, --interactive', 'Interactively resolve detected drift (pull / overwrite / skip)')
        .option('--test-directory <dir>', 'Subdirectory containing test files')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .action(async (options) => {
            const workDir = getWorkDir(options);
            const { scope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);

            await diffCmd({
                dir: workDir,
                testDirectory: options.testDirectory,
                verbose: Boolean(options.verbose),
                scope,
                remote: Boolean(options.remote),
                interactive: Boolean(options.interactive),
                statePath: options.state,
                backupPath: options.backup,
                variables: variableParser
            });
        });

    // ─── import ───────────────────────────────────────────────────────────
    cli.command('import <address> <issueNumber>', 'Associate an existing remote Issue with a local scenario')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .action(async (address, issueNumber, options) => {
            const workDir = getWorkDir(options);
            const { singleScope } = getScope(options);

            await importCmd({
                dir: workDir,
                scope: singleScope,
                identityArg: address,
                issueNumber,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s',
                statePath: options.state,
                backupPath: options.backup
            });
        });

    // ─── state ────────────────────────────────────────────────────────────
    cli.command('state [subcommand] [...args]', 'Advanced state management (clean, list, show, rm, mv, pull, push)')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .option('--json', 'Output in JSON format')
        .option('--id <id>', 'Filter by ID')
        .option('--dry-run', 'Preview state modifications without writing')
        .option('--force', 'Bypass safety checks')
        .action(async (subcommand, args, options) => {
            const workDir = getWorkDir(options);
            if (!subcommand) {
                console.log(getCommandHelp('state') || HELP_GLOBAL);
                return;
            }
            await stateCmd({
                dir: workDir,
                action: subcommand,
                args: args || [],
                statePath: options.state,
                backupPath: options.backup,
                isJson: options.json,
                id: options.id,
                dryRun: options.dryRun,
                force: options.force
            });
        });

    // ─── taint / untaint ──────────────────────────────────────────────────
    cli.command('taint <address>', 'Mark a resource instance as degraded or corrupted')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .option('--allow-missing', 'Do not error if resource is missing from state')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .action(async (address, options) => {
            const workDir = getWorkDir(options);
            await taintCmd({
                dir: workDir,
                action: 'taint',
                identityRaw: address,
                statePath: options.state,
                backupPath: options.backup,
                allowMissing: options.allowMissing,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s'
            });
        });

    cli.command('untaint <address>', 'Remove degraded status mark from a resource instance')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .option('--allow-missing', 'Do not error if resource is missing from state')
        .option('--lock', 'Lock state during operation', { default: true })
        .option('--lock-timeout <timeout>', 'Timeout for state lock', { default: '0s' })
        .action(async (address, options) => {
            const workDir = getWorkDir(options);
            await taintCmd({
                dir: workDir,
                action: 'untaint',
                identityRaw: address,
                statePath: options.state,
                backupPath: options.backup,
                allowMissing: options.allowMissing,
                lock: options.lock ?? true,
                lockTimeout: options.lockTimeout ?? '0s'
            });
        });

    // ─── workspace ────────────────────────────────────────────────────────
    cli.command('workspace [subcommand] [name]', 'Workspace management (list, select, new, delete, show)')
        .action(async (subcommand, name, options) => {
            const workDir = getWorkDir(options);
            const args = [subcommand, name].filter(Boolean);
            await workspaceCmd({ dir: workDir, verbose: Boolean(options.verbose), args });
        });

    // ─── ephemeral ────────────────────────────────────────────────────────
    cli.command('ephemeral [subcommand] [id]', 'Manage temporary CI/CD QA sandboxes (up, down, list, show)')
        .option('-a, --auto-approve', 'Skip interactive approval')
        .option('--force', 'Force destruction even if state is missing')
        .option('--test-directory <dir>', 'Subdirectory containing test files')
        .option('--json', 'Output results formatted as JSON')
        .action(async (subcommand, id, options) => {
            const workDir = getWorkDir(options);
            const { scope } = getScope(options);

            await ephemeralCmd({
                subcommand,
                id,
                dir: workDir,
                testDirectory: options.testDirectory,
                scope,
                autoApprove: Boolean(options.autoApprove),
                force: Boolean(options.force),
                json: Boolean(options.json),
                verbose: Boolean(options.verbose)
            });
        });

    // ─── force-unlock ─────────────────────────────────────────────────────
    cli.command('force-unlock <lockId>', 'Release a stuck state lock')
        .option('--force', 'Do not ask for confirmation')
        .option('--state <path>', 'Path to state file')
        .action(async (lockId, options) => {
            const workDir = getWorkDir(options);
            await forceUnlockCmd({
                dir: workDir,
                lockId,
                force: options.force,
                statePath: options.state
            });
        });

    // ─── report ───────────────────────────────────────────────────────────
    cli.command('report [type]', 'Generate test metrics and matrices (raw, matrix, summary)')
        .option('--format <format>', 'Report output format (md, json, html)', { default: 'md' })
        .option('--filter <filter>', 'Filter report items')
        .option('--apply', 'Automatically apply execution reports to platform')
        .option('-o, --out <path>', 'Write report to destination file')
        .option('--state <path>', 'Path to state file')
        .action(async (type, options) => {
            const workDir = getWorkDir(options);
            const variableParser = getVariableParser(options, workDir);
            const filterArr = options.filter ? (Array.isArray(options.filter) ? options.filter : [options.filter]) : [];

            await reportCmd({
                dir: workDir,
                type: type || 'raw',
                format: options.format || 'md',
                filter: filterArr,
                variables: variableParser,
                apply: options.apply,
                out: options.out,
                statePath: options.state
            });
        });

    // ─── suite ───────────────────────────────────────────────────────────
    cli.command('suite [subcommand] [...args]', 'Manage test suites and execution files (init, fill, link, mark, tags)')
        .option('--fill', 'Autocomplete empty testrun rules with their testcases')
        .option('--link <id_status>', 'Link a testcase or testrun into a suite')
        .option('--mark <id_status>', 'Record execution status in a testrun')
        .option('--tags <tags>', 'Filter testcase scenarios by bracketed tag expression to generate testrun (e.g. "[@smoke]" or "file.case.feature.[@smoke]")')
        .option('--title <title>', 'Suite title')
        .option('--rule <rule>', 'Rule definitions')
        .option('--target <target>', 'Target feature file (identity tag @tr-N/@tp-N, canonical address, or file path)')
        .option('--test-directory <dir>', 'Directory containing test files')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .action(async (subcommand, subArgs, options) => {
            const workDir = getWorkDir(options);
            const { singleScope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);
            const ruleArr = options.rule ? (Array.isArray(options.rule) ? options.rule : [options.rule]) : [];

            await suiteCmd({
                dir: workDir,
                subCommand: subcommand,
                subArgs: subArgs || [],
                scope: singleScope,
                title: options.title,
                rules: ruleArr,
                target: options.target,
                tags: options.tags,
                fill: Boolean(options.fill),
                link: typeof options.link === 'string' ? options.link : undefined,
                mark: typeof options.mark === 'string' ? options.mark : undefined,
                testDirectory: options.testDirectory,
                statePath: options.state,
                backupPath: options.backup,
                variables: variableParser,
                verbose: Boolean(options.verbose)
            });
        });

    // ─── tool ─────────────────────────────────────────────────────────────
    cli.command('tool <subcommand> [...args]', 'QA utilities (feature, autocomplete, state)')
        .option('--title <title>', 'Feature title')
        .option('--rule <rule>', 'Rule definitions')
        .option('--target <target>', 'Target feature file')
        .option('--test-directory <dir>', 'Directory containing test files')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .action(async (subcommand, subArgs, options) => {
            const workDir = getWorkDir(options);
            const { singleScope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);
            const ruleArr = options.rule ? (Array.isArray(options.rule) ? options.rule : [options.rule]) : [];

            await toolCmd({
                dir: workDir,
                subCommand: subcommand,
                subArgs: subArgs || [],
                scope: singleScope,
                title: options.title,
                rules: ruleArr,
                target: options.target,
                testDirectory: options.testDirectory,
                statePath: options.state,
                backupPath: options.backup,
                variables: variableParser,
                verbose: Boolean(options.verbose)
            });
        });

    // ─── fmt ──────────────────────────────────────────────────────────────
    cli.command('fmt [targetDir]', 'Rewrites Gherkin configuration files to canonical format')
        .option('--check', 'Check if files are formatted without rewriting')
        .option('--diff', 'Display diffs instead of rewriting files')
        .option('--list', 'List unformatted files', { default: true })
        .option('--write', 'Write reformatted files to disk', { default: true })
        .option('--recursive', 'Recursively format subdirectories')
        .option('--test-directory <dir>', 'Test directory')
        .action(async (targetDir, options) => {
            const workDir = getWorkDir(options);
            const testDir = options.testDirectory ? resolve(workDir, options.testDirectory) : workDir;
            const destDir = targetDir ? resolve(workDir, targetDir) : testDir;

            await fmtCmd({
                dir: destDir,
                check: options.check,
                diff: options.diff,
                list: options.list ?? true,
                write: options.write ?? true,
                recursive: options.recursive
            });
        });

    // ─── query ───────────────────────────────────────────────────────────
    cli.command('query', 'Query and filter managed test resources in state')
        .option('--custom <custom>', 'Filter by custom field (key=value)')
        .option('--search <text>', 'Free-text search in title or labels')
        .option('--generate-config-out <path>', 'Generate import configuration blocks at PATH')
        .option('--var <var>', 'Set a variable value')
        .option('--var-file <file>', 'Load variable values from file')
        .option('--json', 'Output results formatted as JSON')
        .option('--state <path>', 'Path to state file')
        .option('--backup <path>', 'Path to backup file')
        .action(async (options) => {
            const workDir = getWorkDir(options);
            const { scope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);

            await queryCmd({
                dir: workDir,
                testDirectory: options.testDirectory,
                scope,
                custom: options.custom,
                search: options.search,
                generateConfigOut: options.generateConfigOut,
                variables: variableParser,
                json: Boolean(options.json),
                verbose: Boolean(options.verbose),
                statePath: options.state,
                backupPath: options.backup
            });
        });

    // ─── print ────────────────────────────────────────────────────────────
    cli.command('print <file>', 'Print parsed representation of a feature file')
        .option('--format <format>', 'Print format', { default: 'testform' })
        .action(async (file, options) => {
            const workDir = getWorkDir(options);
            const { singleScope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);

            await printCmd({
                dir: workDir,
                file,
                format: options.format || 'testform',
                scope: singleScope,
                variables: variableParser
            });
        });

    // ─── graph ────────────────────────────────────────────────────────────
    cli.command('graph', 'Generate a visual dependency graph of resources')
        .option('--draw-cycles', 'Highlight cycles in dependency graph')
        .option('--format <format>', 'Output format for the graph (dot, mermaid, console, string, tree) (default: dot)')
        .option('--type <type>', 'Type of operation graph to output (plan, plan-refresh-only, plan-destroy, apply)')
        .option('--plan <plan>', 'Render graph using the specified plan file')
        .option('--module-depth <n>', '(deprecated) Depth of modules to show in output')
        .action(async (options) => {
            const workDir = getWorkDir(options);
            const { singleScope } = getScope(options);
            const variableParser = getVariableParser(options, workDir);

            await graphCmd({
                dir: workDir,
                scope: singleScope,
                drawCycles: options.drawCycles,
                variables: variableParser,
                format: options.format || 'dot',
                type: options.type,
                plan: options.plan,
                moduleDepth: options.moduleDepth ? Number(options.moduleDepth) : undefined
            });
        });

    // ─── login / logout ───────────────────────────────────────────────────
    cli.command('login [hostname]', 'Authenticate with a remote provider')
        .action(async (hostname) => {
            await loginCmd({ hostname: hostname || 'github.com' });
        });

    cli.command('logout [hostname]', 'Remove stored credentials')
        .action(async (hostname) => {
            await logoutCmd({ hostname: hostname || 'github.com' });
        });

    // ─── providers ────────────────────────────────────────────────────────
    cli.command('providers [action] [...args]', 'Prints a tree of providers and schemas')
        .option('--test-directory <dir>', 'Directory containing test files')
        .option('--var <var>', 'Set a variable value')
        .option('--var-file <file>', 'Load variable values from file')
        .action(async (action, args, options) => {
            const workDir = getWorkDir(options);
            const variableParser = getVariableParser(options, workDir);

            await providersCmd({
                dir: workDir,
                action,
                args: Array.isArray(args) ? args : (args ? [args] : []),
                testDirectory: options.testDirectory,
                variables: variableParser
            });
        });

    // ─── functions ────────────────────────────────────────────────────────
    cli.command('functions [name]', 'Inspect and evaluate built-in expression functions')
        .option('--eval <expr>', 'Evaluate expression live in terminal')
        .action(async (name, options) => {
            await functionsCmd({
                name,
                evalExpr: options.eval
            });
        });

    // ─── version ──────────────────────────────────────────────────────────
    cli.command('version', 'Show detailed version information')
        .option('--json', 'Output the version information as a JSON object.')
        .action(async (options) => {
            await printVersion(Boolean(options?.json), true);
        });

    cli.help();
    cli.version(`${TITLE_APP} v${VERSION_CLI}`);

    return cli;
}

export const main = async () => {
    const rawArgs = process.argv.slice(2);

    // Early no-color check
    if (rawArgs.some(a => a === '--no-color' || a === '-no-color')) {
        chalk.level = 0;
        process.env.NO_COLOR = '1';
    }

    // If no args or just help
    if (rawArgs.length === 0) {
        console.log(HELP_GLOBAL);
        process.exit(0);
    }

    // Version flag
    if (rawArgs.includes('--version') || rawArgs.includes('-version') || (rawArgs.includes('-v') && rawArgs.length === 1)) {
        const isJson = rawArgs.includes('--json') || rawArgs.includes('-json');
        await printVersion(isJson, false);
        process.exit(0);
    }

    // Help flag check with specific command
    if (rawArgs.includes('--help') || rawArgs.includes('-help') || rawArgs.includes('-h')) {
        const nonFlagArgs = rawArgs.filter(a => !a.startsWith('-'));
        if (nonFlagArgs.length === 0) {
            console.log(HELP_GLOBAL);
            process.exit(0);
        }
        const subCmdName = nonFlagArgs.slice(0, 2).join(' ');
        const cmdName = nonFlagArgs[0];
        if (subCmdName) {
            const subHelp = getCommandHelp(subCmdName);
            if (subHelp) {
                console.log(subHelp);
                process.exit(0);
            }
        }
        if (cmdName) {
            const helpText = getCommandHelp(cmdName);
            if (helpText) {
                console.log(helpText);
                process.exit(0);
            }
        }
    }

    const normalized = normalizeArgv(rawArgs);
    const cli = createCli();

    try {
        cli.parse([process.argv[0], process.argv[1], ...normalized], { run: false });
        await cli.runMatchedCommand();
    } catch (err: any) {
        if (err instanceof TestformError) {
            if (err.message) console.error(err.message);
            process.exit(err.exitCode);
        }
        if (err.name === 'CACError') {
            console.error(chalk.red(`\nError: ${err.message}\n`));
            console.log(`Run '${TITLE_CLI} --help' for usage instructions.`);
            process.exit(1);
        }
        try {
            logger.error(err.message || String(err));
        } catch {
            // TestformError thrown by logger.error
        }
        process.exit(1);
    }
};

export { resource, registerResource } from './core/resources';
export { evaluateExpression, interpolateExpressions } from './core/expressions/evaluator';
export { VariableParser } from './core/variables';
export { Config } from './core/config';

if (require.main === module || !module.parent) {
    main().catch((err: any) => {
        if (err instanceof TestformError) {
            process.exit(err.exitCode);
        }
        try {
            logger.error(err.message || String(err));
        } catch {
            // TestformError thrown by logger.error
        }
        process.exit(1);
    });
}
