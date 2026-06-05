#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const arg_1 = __importDefault(require("arg"));
const chalk_1 = require("chalk");
const node_process_1 = require("node:process");
const path_1 = require("path");
// Import commands
const init_1 = require("./commands/init");
const plan_1 = require("./commands/plan");
const validate_1 = require("./commands/validate");
const apply_1 = require("./commands/apply");
const destroy_1 = require("./commands/destroy");
const show_1 = require("./commands/show");
const refresh_1 = require("./commands/refresh");
const diff_1 = require("./commands/diff");
const import_1 = require("./commands/import");
const force_unlock_1 = require("./commands/force-unlock");
const state_1 = require("./commands/state");
const taint_1 = require("./commands/taint");
const graph_1 = require("./commands/graph");
const fmt_1 = require("./commands/fmt");
const login_1 = require("./commands/login");
const logout_1 = require("./commands/logout");
const workspace_1 = require("./commands/workspace");
const report_1 = require("./commands/report");
const generate_1 = require("./commands/generate");
const variables_1 = require("./core/variables");
const notify_1 = require("./notify");
const chalk_2 = __importDefault(require("chalk"));
const logger_1 = require("./logger");
const const_1 = require("./const");
const help_1 = require("./help");
function compareVersions(a, b) {
    const pa = a.split('.').map((v) => Number(v));
    const pb = b.split('.').map((v) => Number(v));
    const size = Math.max(pa.length, pb.length);
    for (let i = 0; i < size; i++) {
        const av = pa.at(i) ?? 0;
        const bv = pb.at(i) ?? 0;
        if (av > bv)
            return 1;
        if (av < bv)
            return -1;
    }
    return 0;
}
function printVersion(detailed = false) {
    const latestVersion = process.env.TESTSTATE_LATEST_VERSION;
    const platformArch = `${node_process_1.platform}_${node_process_1.arch}`;
    console.log((0, chalk_1.cyan)(`${const_1.TITLE_APP} v${const_1.VERSION_CLI}`));
    console.log(`on ${platformArch}`);
    if (detailed) {
        console.log(`+ Config Version: ${const_1.VERSION_CONFIG} (${const_1.FILE_CONFIG})`);
        console.log(`+ State Version: ${const_1.VERSION_STATE} (${const_1.FILE_STATE})`);
    }
    if (latestVersion && compareVersions(const_1.VERSION_CLI, latestVersion) < 0) {
        console.log('');
        console.log(`Your version of ${const_1.TITLE_APP} is out of date! The latest version`);
        console.log(`is ${latestVersion}. You can update from your release source.`);
    }
}
function printTooManyArgsForInit() {
    logger_1.logger.error('Too many command line arguments. Did you mean to use -chdir?');
}
function ensureNoPositionalArgs(command, args) {
    if (args.length > 0) {
        logger_1.logger.error(`Too many command line arguments\n\nTo specify a working directory for the ${command}, use the global -chdir flag.`);
    }
}
function isScopeToken(value) {
    if (!value)
        return false;
    return [
        'testcase',
        'testrun',
        'testplan',
    ].includes(value.toLowerCase());
}
function normalizeLongFlags(rawArgs) {
    const longFlags = new Set([
        'chdir',
        'scope',
        'help',
        'verbose',
        'version',
        'auto-approve',
        'out',
        'lock',
        'lock-timeout',
        'input',
        'var',
        'var-file',
        'no-color',
        'json',
        'detailed-exitcode',
        'state',
        'backup',
        'target',
        'destroy',
        'refresh',
        'refresh-only',
        'force',
        'check',
        'list',
        'write',
        'diff',
        'recursive',
        'plan',
        'draw-cycles',
        'type',
        'module-depth',
        'allow-missing',
        'ignore-remote-version',
        'backend',
        'backend-config',
        'force-copy',
        'from-module',
        'get',
        'plugin-dir',
        'reconfigure',
        'lockfile',
        'test-directory',
        'set-status',
        'set-state',
        'replace',
        'compact-warnings',
        'generate-config-out',
        'parallelism',
        'no-tests',
        'query',
        'state-out',
        'config',
        'taint',
        'untaint',
        'workspace',
        'report',
        'format',
        'filter',
        'id',
        'dry-run',
        'apply',
        'field',
        'rule'
    ]);
    return rawArgs.map((arg) => {
        const match = arg.match(/^-([a-z][a-z-]*)(=.*)?$/i);
        if (!match)
            return arg;
        const flag = match[1].toLowerCase();
        const suffix = match[2] || '';
        if (!longFlags.has(flag))
            return arg;
        return `--${flag}${suffix}`;
    });
}
const booleanFlags = new Set([
    '--help',
    '--verbose',
    '--version',
    '--auto-approve',
    '--lock',
    '--input',
    '--no-color',
    '--json',
    '--detailed-exitcode',
    '--destroy',
    '--refresh',
    '--refresh-only',
    '--force',
    '--check',
    '--list',
    '--write',
    '--diff',
    '--recursive',
    '--draw-cycles',
    '--allow-missing',
    '--ignore-remote-version',
    '--backend',
    '--reconfigure',
    '--migrate-state',
    '--compact-warnings',
    '--no-tests',
    '--dry-run',
    '--apply'
]);
const main = async () => {
    let argv;
    try {
        const rawArgs = normalizeLongFlags(process.argv.slice(2));
        const booleanOverrides = new Map();
        const filteredArgs = [];
        for (const argOption of rawArgs) {
            const match = argOption.match(/^(--[a-z][a-z-]*)=(true|false)$/i);
            if (match && booleanFlags.has(match[1])) {
                booleanOverrides.set(match[1], match[2].toLowerCase() === 'true');
            }
            else {
                filteredArgs.push(argOption);
            }
        }
        argv = (0, arg_1.default)({
            '--chdir': String,
            '--projectId': String,
            '--scope': String,
            '--out': String,
            '--lock-timeout': String,
            '--var': [String],
            '--var-file': [String],
            '--state': String,
            '--backup': String,
            '--target': [String],
            '--plan': String,
            '--type': String,
            '--module-depth': String,
            '--backend-config': [String],
            '--test-directory': String,
            '--set-status': [String],
            '--set-state': [String],
            '--replace': [String],
            '--parallelism': String,
            '--state-out': String,
            '--config': String,
            '--taint': [String],
            '--untaint': [String],
            '--workspace': String,
            '--report': String,
            '--format': String,
            '--filter': [String],
            '--id': String,
            '--field': [String],
            '--rule': [String],
            '--help': Boolean,
            '--verbose': Boolean,
            '--version': Boolean,
            '--auto-approve': Boolean,
            '--lock': Boolean,
            '--input': Boolean,
            '--no-color': Boolean,
            '--json': Boolean,
            '--detailed-exitcode': Boolean,
            '--destroy': Boolean,
            '--refresh': Boolean,
            '--refresh-only': Boolean,
            '--force': Boolean,
            '--check': Boolean,
            '--list': Boolean,
            '--write': Boolean,
            '--diff': Boolean,
            '--apply': Boolean,
            '--recursive': Boolean,
            '--draw-cycles': Boolean,
            '--allow-missing': Boolean,
            '--ignore-remote-version': Boolean,
            '--backend': Boolean,
            '--reconfigure': Boolean,
            '--migrate-state': Boolean,
            '--compact-warnings': Boolean,
            '--no-tests': Boolean,
            '--dry-run': Boolean,
            '-C': '--chdir',
            '-s': '--scope',
            '-h': '--help',
            '-v': '--verbose',
            '-a': '--auto-approve',
            '-o': '--out',
        }, { argv: filteredArgs });
        Object.assign(argv, Object.fromEntries(booleanOverrides));
    }
    catch (err) {
        if (err.code === 'ARG_UNKNOWN_OPTION') {
            console.error(`\x1b[31mError: ${err.message}\x1b[0m\n`);
            console.log(`Usage: ${const_1.TITLE_CLI} [global options] <subcommand> [args]\nRun '${const_1.TITLE_CLI} --help' for more information.`);
            process.exit(1);
        }
        throw err;
    }
    const args = argv._.map(String);
    if (argv['--version']) {
        printVersion(false);
        process.exit(0);
    }
    const rawArgs = argv._;
    const commandRaw = rawArgs[0];
    const commandArgsRaw = rawArgs.slice(1);
    if (argv['--help']) {
        if (commandRaw) {
            let helpKey = commandRaw;
            if (commandRaw === 'state' && commandArgsRaw.length > 0) {
                helpKey = `state ${commandArgsRaw[0]}`;
            }
            const cmdHelp = (0, help_1.getCommandHelp)(helpKey);
            if (cmdHelp) {
                console.log(cmdHelp);
            }
            else {
                console.log(`Unknown command: ${helpKey}\n\n${help_1.HELP_GLOBAL}`);
            }
        }
        else {
            console.log(help_1.HELP_GLOBAL);
        }
        process.exit(0);
    }
    if (!commandRaw) {
        console.log(help_1.HELP_GLOBAL);
        process.exit(0);
    }
    let command = commandRaw.toLowerCase();
    let commandArgs = commandArgsRaw;
    let scopeArg = String((argv['--scope'] ?? 'testcase') || 'testcase');
    const workDir = String(argv['--chdir'] || '.');
    const variableParser = new variables_1.VariableParser(argv['--var'], argv['--var-file'], workDir);
    if (argv['--no-color']) {
        chalk_2.default.level = 0;
    }
    // Supports: testcase plan ... (scope-first style)
    if (isScopeToken(command) && args[1]) {
        scopeArg = command;
        command = args[1].toLowerCase();
        commandArgs = args.slice(2);
    }
    if (!workDir) {
        printTooManyArgsForInit();
        process.exit(1);
    }
    const verbose = Boolean(argv['--verbose'] || argv['--verbose']);
    const scope = scopeArg;
    if (command === 'version') {
        printVersion(true);
        process.exit(process.exitCode || 0);
    }
    if (command === 'init') {
        if (commandArgs.length > 0) {
            printTooManyArgsForInit();
        }
        await (0, init_1.initCmd)({
            dir: workDir,
            verbose,
            backendConfigRaw: argv['--backend-config'],
            lock: argv['--lock'] ?? true,
            lockTimeout: argv['--lock-timeout'] ?? '0s',
            reconfigure: argv['--reconfigure'],
            migrateState: argv['--migrate-state'],
            backendEnabled: argv['--backend'] ?? true,
            isJson: argv['--json'],
            inputEnabled: argv['--input'] ?? true
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'validate') {
        const validateDir = commandArgs.length > 0 ? commandArgs[0] : workDir;
        if (commandArgs.length > 1) {
            logger_1.logger.error(`Too many command line arguments\n\nExpected at most one positional argument.`);
        }
        await (0, validate_1.validateCmd)({
            targetPath: validateDir,
            verbose,
            scope,
            variables: variableParser,
            isJson: argv['--json'],
            testDirectory: argv['--test-directory'],
            noTests: argv['--no-tests'],
            query: argv['--query']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'plan') {
        ensureNoPositionalArgs(command, commandArgs);
        await (0, plan_1.planCmd)({
            dir: workDir,
            verbose,
            scope,
            outPath: argv['--out'],
            lock: argv['--lock'] ?? true,
            lockTimeout: argv['--lock-timeout'] ?? '0s',
            variables: variableParser,
            isJson: argv['--json'],
            detailedExitCode: argv['--detailed-exitcode'],
            statePath: argv['--state'],
            backupPath: argv['--backup'],
            target: argv['--target'],
            destroyPlan: argv['--destroy'],
            refresh: argv['--refresh'] ?? true,
            refreshOnly: argv['--refresh-only'],
            replaceTargets: argv['--replace'],
            parallelism: argv['--parallelism'],
            compactWarnings: argv['--compact-warnings'] ?? false,
            testDirectory: argv['--test-directory']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'apply') {
        let planFile = undefined;
        if (commandArgs.length === 1) {
            planFile = commandArgs[0];
        }
        else if (commandArgs.length > 1) {
            logger_1.logger.error(`Too many command line arguments\n\nExpected at most one positional argument.`);
        }
        await (0, apply_1.applyCmd)({
            dir: workDir,
            autoApprove: Boolean(argv['--auto-approve'] || argv['--auto-approve']), // (Keeping the original logic from index.ts, though redundant)
            verbose,
            scope,
            planFile,
            lock: argv['--lock'] ?? true,
            lockTimeout: argv['--lock-timeout'] ?? '0s',
            input: argv['--input'] ?? true,
            variables: variableParser,
            statePath: argv['--state'],
            backupPath: argv['--backup'],
            target: argv['--target'],
            refresh: argv['--refresh'] ?? true,
            refreshOnly: argv['--refresh-only'],
            setStatus: argv['--set-status']?.[0] || argv['--set-state']?.[0],
            replaceTargets: argv['--replace'],
            parallelism: argv['--parallelism'],
            compactWarnings: argv['--compact-warnings'] ?? false,
            testDirectory: argv['--test-directory']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'destroy') {
        ensureNoPositionalArgs(command, commandArgs);
        await (0, destroy_1.destroyCmd)({
            dir: workDir,
            verbose,
            scope,
            lock: argv['--lock'] ?? true,
            lockTimeout: argv['--lock-timeout'] ?? '0s',
            input: argv['--input'] ?? true,
            statePath: argv['--state'],
            backupPath: argv['--backup']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'show') {
        const path = commandArgs[0];
        await (0, show_1.showCmd)({
            path,
            isJson: argv['--json'],
            verbose,
            dir: String(argv['--chdir'] || '.'),
            statePath: argv['--state'],
            backupPath: argv['--backup']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'refresh') {
        ensureNoPositionalArgs(command, commandArgs);
        await (0, refresh_1.refreshCmd)({
            dir: workDir,
            verbose,
            scope,
            lock: argv['--lock'] ?? true,
            lockTimeout: argv['--lock-timeout'] ?? '0s',
            statePath: argv['--state'],
            backupPath: argv['--backup'],
            parallelismRaw: argv['--parallelism'],
            compactWarnings: argv['--compact-warnings'] ?? false
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'diff') {
        ensureNoPositionalArgs(command, commandArgs);
        await (0, diff_1.diffCmd)({
            dir: workDir,
            verbose,
            scope
        });
        process.exit(0);
    }
    if (command === 'import') {
        if (commandArgs.length !== 2) {
            logger_1.logger.error(`Usage: ${const_1.TITLE_CLI} import [options] ADDR ISSUE_NUMBER`);
            process.exit(1);
        }
        const identityArg = commandArgs[0];
        const issueNumber = commandArgs[1];
        await (0, import_1.importCmd)({
            dir: workDir,
            scope,
            identityArg,
            issueNumber,
            lock: argv['--lock'] ?? true,
            lockTimeout: argv['--lock-timeout'] ?? '0s',
            statePath: argv['--state'],
            backupPath: argv['--backup']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'state') {
        if (commandArgs.length === 0) {
            console.log((0, help_1.getCommandHelp)('state'));
            process.exit(1);
        }
        const stateSubCommand = commandArgs[0];
        const stateArgs = commandArgs.slice(1);
        await (0, state_1.stateCmd)({
            dir: workDir,
            action: stateSubCommand,
            args: stateArgs,
            statePath: argv['--state'],
            backupPath: argv['--backup'],
            isJson: argv['--json'],
            id: argv['--id'],
            dryRun: argv['--dry-run'],
            force: argv['--force']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'taint' || command === 'untaint') {
        if (commandArgs.length === 0) {
            logger_1.logger.error(`Usage: ${const_1.TITLE_CLI} ${command} [options] name`);
            process.exit(1);
        }
        await (0, taint_1.taintCmd)({
            dir: workDir,
            action: command,
            identityRaw: commandArgs[0],
            statePath: argv['--state'],
            backupPath: argv['--backup'],
            allowMissing: argv['--allow-missing'],
            lock: argv['--lock'] ?? true,
            lockTimeout: argv['--lock-timeout'] ?? '0s'
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'workspace') {
        await (0, workspace_1.workspaceCmd)({ dir: workDir, verbose, args: commandArgs });
        process.exit(process.exitCode || 0);
    }
    if (command === 'force-unlock') {
        if (commandArgs.length !== 1) {
            logger_1.logger.error(`Usage: ${const_1.TITLE_CLI} force-unlock [options] LOCK_ID`);
            process.exit(1);
        }
        await (0, force_unlock_1.forceUnlockCmd)({
            dir: workDir,
            lockId: commandArgs[0],
            force: argv['--force'],
            statePath: argv['--state']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'graph') {
        if (argv['--help']) {
            const { HELP_GRAPH } = require('./help');
            console.log(HELP_GRAPH);
            process.exit(0);
        }
        ensureNoPositionalArgs(command, commandArgs);
        await (0, graph_1.graphCmd)({
            dir: workDir,
            scope,
            drawCycles: argv['--draw-cycles']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'report') {
        const type = commandArgs.length > 0 ? commandArgs[0] : 'raw';
        await (0, report_1.reportCmd)({
            dir: workDir,
            type,
            format: argv['--format'] || 'md',
            filter: argv['--filter'] || [],
            fields: argv['--field'] || [],
            apply: argv['--apply'],
            out: argv['--out'],
            statePath: argv['--state']
        });
        process.exit(0);
    }
    if (command === 'generate') {
        let genScope = undefined;
        let titleArg = undefined;
        const hasScopeFlag = Object.prototype.hasOwnProperty.call(argv, '--scope');
        if (commandArgs.length > 0) {
            // First argument could be scope or title
            const first = commandArgs[0].toLowerCase();
            if (['testcase', 'testrun', 'testplan'].includes(first)) {
                genScope = first;
                titleArg = commandArgs.slice(1).join(' ');
            }
            else {
                titleArg = commandArgs.join(' ');
            }
        }
        if (!genScope && hasScopeFlag) {
            genScope = String(argv['--scope']);
        }
        if (!genScope) {
            logger_1.logger.error(`Usage: testform generate <scope> [title]\n\nYou must specify the scope either as the first argument or using the -scope flag (e.g., -scope=testrun).`);
            process.exit(1);
        }
        if (!['testcase', 'testrun', 'testplan'].includes(genScope)) {
            logger_1.logger.error(`Invalid scope '${genScope}'. Must be one of: testcase, testrun, testplan.`);
            process.exit(1);
        }
        if (!titleArg)
            titleArg = undefined; // empty string to undefined
        await (0, generate_1.generateCmd)({
            dir: workDir,
            scope: genScope,
            title: titleArg,
            rules: argv['--rule'] || []
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'fmt') {
        const testDir = argv['--test-directory'] ? (0, path_1.resolve)(workDir, argv['--test-directory']) : workDir;
        const targetDir = commandArgs.length > 0 ? (0, path_1.resolve)(workDir, commandArgs[0]) : testDir;
        await (0, fmt_1.fmtCmd)({
            dir: targetDir,
            check: argv['--check'],
            list: argv['--list'] ?? true,
            write: argv['--write'] ?? true,
            recursive: argv['--recursive']
        });
        process.exit(process.exitCode || 0);
    }
    if (command === 'login') {
        const hostname = commandArgs.length > 0 ? commandArgs[0] : 'github.com';
        await (0, login_1.loginCmd)({ hostname });
        process.exit(process.exitCode || 0);
    }
    if (command === 'logout') {
        const hostname = commandArgs.length > 0 ? commandArgs[0] : 'github.com';
        await (0, logout_1.logoutCmd)({ hostname });
        process.exit(process.exitCode || 0);
    }
    console.log(help_1.HELP_GLOBAL);
    process.exit(1);
};
exports.main = main;
if (require.main === module || !module.parent) {
    main().catch((err) => {
        // console.error(err.stack);
        notify_1.notify.push({
            type: 'error',
            title: err.name,
            detail: [err.message]
        });
    });
}
