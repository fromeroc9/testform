#!/usr/bin/env node
import arg from 'arg';
import { bold, red, cyan } from 'chalk';
import { arch, platform } from 'node:process';
import { resolve } from 'path';

// Import commands
import { initCmd } from './commands/init';
import { planCmd } from './commands/plan';
import { validateCmd } from './commands/validate';
import { applyCmd } from './commands/apply';
import { destroyCmd } from './commands/destroy';
import { showCmd } from './commands/show';
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
import { generateCmd } from './commands/generate';
import { testCmd } from './commands/tool';
import { printCmd } from './commands/print';
import { IScope } from './core/types';
import { VariableParser } from './core/variables';
import chalk from 'chalk';
import { logger } from './core/logger';
import { TITLE_APP, TITLE_CLI, VERSION_CONFIG, VERSION_STATE, VERSION_CLI, FILE_CONFIG, FILE_STATE } from './core/const';
import { getCommandHelp, HELP_GLOBAL } from './core/help';

type InputScope = IScope;

function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((v) => Number(v));
    const pb = b.split('.').map((v) => Number(v));
    const size = Math.max(pa.length, pb.length);

    for (let i = 0; i < size; i++) {
        const av = pa.at(i) ?? 0;
        const bv = pb.at(i) ?? 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }

    return 0;
}

function printVersion(detailed: boolean = false) {
    const latestVersion = process.env.TESTSTATE_LATEST_VERSION;
    const platformArch = `${platform}_${arch}`;

    console.log(cyan(`${TITLE_APP} v${VERSION_CLI}`));
    console.log(`on ${platformArch}`);

    if (detailed) {
        console.log(`+ Config Version: ${VERSION_CONFIG} (${FILE_CONFIG})`);
        console.log(`+ State Version: ${VERSION_STATE} (${FILE_STATE})`);
    }

    if (latestVersion && compareVersions(VERSION_CLI, latestVersion) < 0) {
        console.log('');
        console.log(`Your version of ${TITLE_APP} is out of date! The latest version`);
        console.log(`is ${latestVersion}. You can update from your release source.`);
    }
}

function printTooManyArgsForInit(): void {
    logger.error('Too many command line arguments. Did you mean to use -chdir?');
}

function ensureNoPositionalArgs(command: string, args: string[]): void {
    if (args.length > 0) {
        logger.error(`Too many command line arguments\n\nTo specify a working directory for the ${command}, use the global -chdir flag.`);
    }
}

function isScopeToken(value?: string): value is InputScope {
    if (!value) return false;
    return [
        'testcase',
        'testrun',
        'testplan',
    ].includes(value.toLowerCase());
}

function normalizeLongFlags(rawArgs: string[]): string[] {
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
        'rule',
        'title'
    ]);

    const shortFlags: Record<string, string> = {
        'C': 'chdir',
        's': 'scope',
        'h': 'help',
        'v': 'verbose',
        'a': 'auto-approve',
        'o': 'out'
    };

    return rawArgs.map((arg) => {
        const match = arg.match(/^-([a-zA-Z][a-zA-Z-]*)(=.*)?$/);
        if (!match) return arg;

        const flag = match[1];
        const suffix = match[2] || '';

        if (shortFlags[flag]) {
            return `--${shortFlags[flag]}${suffix}`;
        }

        const lowerFlag = flag.toLowerCase();
        if (longFlags.has(lowerFlag)) {
            return `--${lowerFlag}${suffix}`;
        }

        return arg;
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
    let argv: arg.Result<any>;
    try {
        const rawArgs = normalizeLongFlags(process.argv.slice(2));
        const booleanOverrides = new Map<string, boolean>();
        const filteredArgs: string[] = [];

        for (const argOption of rawArgs) {
            const match = argOption.match(/^(--[a-z][a-z-]*)=(true|false)$/i);
            if (match && booleanFlags.has(match[1])) {
                booleanOverrides.set(match[1], match[2].toLowerCase() === 'true');
            } else {
                filteredArgs.push(argOption);
            }
        }

        argv = arg({
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
            '--rule': [String],
            '--title': String,
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
    } catch (err: any) {
        if (err.code === 'ARG_UNKNOWN_OPTION') {
            console.error(`\x1b[31mError: ${err.message}\x1b[0m\n`);
            console.log(`Usage: ${TITLE_CLI} [global options] <subcommand> [args]\nRun '${TITLE_CLI} -help' for more information.`);
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
            if (commandRaw === 'tool' && commandArgsRaw.length > 0) {
                helpKey = `tool ${commandArgsRaw[0]}`;
            }
            const cmdHelp = getCommandHelp(helpKey);
            if (cmdHelp) {
                console.log(cmdHelp);
            } else {
                console.log(`Unknown command: ${helpKey}\n\n${HELP_GLOBAL}`);
            }
        } else {
            console.log(HELP_GLOBAL);
        }
        process.exit(0);
    }

    if (!commandRaw) {
        console.log(HELP_GLOBAL);
        process.exit(0);
    }

    let command = commandRaw.toLowerCase();
    let commandArgs = commandArgsRaw;

    const hasExplicitScope = Object.prototype.hasOwnProperty.call(argv, '--scope');
    let scopeArg = (argv['--scope'] as IScope | 'all') || (hasExplicitScope ? 'testcase' : 'all');
    if (!hasExplicitScope && ['plan', 'apply', 'diff', 'refresh', 'destroy'].includes(command)) {
        logger.warn(`Warning: Scanning all scopes. You can use -scope (testcase|testrun|testplan) to limit the operation.`);
    }
    const workDir = String(argv['--chdir'] || '.');
    const variableParser = new VariableParser(argv['--var'], argv['--var-file'], workDir);

    if (argv['--no-color']) {
        chalk.level = 0;
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
    const singleScope: IScope = scope === 'all' ? 'testcase' : scope;

    if (command === 'version') {
        printVersion(true);
        process.exit(process.exitCode || 0);
    }

    if (command === 'init') {
        if (commandArgs.length > 0) {
            printTooManyArgsForInit();
        }
        await initCmd({
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
            logger.error(`Too many command line arguments\n\nExpected at most one positional argument.`);
        }
        await validateCmd({
            targetPath: validateDir,
            verbose,
            scope: singleScope,
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
        await planCmd({
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
        let planFile: string | undefined = undefined;
        if (commandArgs.length === 1) {
            planFile = commandArgs[0];
        } else if (commandArgs.length > 1) {
            logger.error(`Too many command line arguments\n\nExpected at most one positional argument.`);
        }
        await applyCmd({
            dir: workDir,
            autoApprove: Boolean(argv['--auto-approve']),
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
            replaceTargets: argv['--replace'],
            parallelism: argv['--parallelism'],
            compactWarnings: argv['--compact-warnings'] ?? false,
            testDirectory: argv['--test-directory']
        });
        process.exit(process.exitCode || 0);
    }

    if (command === 'destroy') {
        ensureNoPositionalArgs(command, commandArgs);
        await destroyCmd({
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
        await showCmd({
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
        await refreshCmd({
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
        await diffCmd({
            dir: workDir,
            verbose,
            scope
        });
        process.exit(0);
    }

    if (command === 'import') {
        if (commandArgs.length !== 2) {
            logger.error(`Usage: ${TITLE_CLI} import [options] ADDR ISSUE_NUMBER`);
            process.exit(1);
        }
        const identityArg = commandArgs[0];
        const issueNumber = commandArgs[1];
        await importCmd({
            dir: workDir,
            scope: singleScope,
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
            console.log(getCommandHelp('state'));
            process.exit(1);
        }
        const stateSubCommand = commandArgs[0];
        const stateArgs = commandArgs.slice(1);
        await stateCmd({
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
            logger.error(`Usage: ${TITLE_CLI} ${command} [options] name`);
            process.exit(1);
        }
        await taintCmd({
            dir: workDir,
            action: command as 'taint' | 'untaint',
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
        await workspaceCmd({ dir: workDir, verbose, args: commandArgs });
        process.exit(process.exitCode || 0);
    }

    if (command === 'force-unlock') {
        if (commandArgs.length !== 1) {
            logger.error(`Usage: ${TITLE_CLI} force-unlock [options] LOCK_ID`);
            process.exit(1);
        }
        await forceUnlockCmd({
            dir: workDir,
            lockId: commandArgs[0],
            force: argv['--force'],
            statePath: argv['--state']
        });
        process.exit(process.exitCode || 0);
    }

    if (command === 'graph') {
        if (argv['--help']) {
            const { HELP_GRAPH } = require('./core/help');
            console.log(HELP_GRAPH);
            process.exit(0);
        }
        ensureNoPositionalArgs(command, commandArgs);
        await graphCmd({
            dir: workDir,
            scope: singleScope,
            drawCycles: argv['--draw-cycles']
        });
        process.exit(process.exitCode || 0);
    }

    if (command === 'report') {
        const type = commandArgs.length > 0 ? commandArgs[0] : 'raw';
        await reportCmd({
            dir: workDir,
            type,
            format: argv['--format'] || 'md',
            filter: argv['--filter'] || [],
            variables: variableParser,
            apply: argv['--apply'],
            out: argv['--out'],
            statePath: argv['--state']
        });
        process.exit(0);
    }

    if (command === 'tool') {
        if (commandArgs.length === 0) {
            const helpText = `\nUsage: ${TITLE_CLI} [global options] tool <subcommand> [options]\n\nSubcommands:\n  feature       Create a new testrun or testplan feature file\n  autocomplete  Expand empty Rule blocks in a testrun file from its source .case.feature (testrun only)\n  state         Update a testcase execution status within a testrun\n\nRun '${TITLE_CLI} tool <subcommand> -help' for more information.`;
            console.log(helpText);
            process.exit(1);
        }
        const testSubCommand = commandArgs[0];
        const testSubArgs = commandArgs.slice(1);

        let testScope: IScope | undefined = undefined;
        if (argv['--scope'] && ['testcase', 'testrun', 'testplan'].includes(String(argv['--scope']))) {
            testScope = String(argv['--scope']) as IScope;
        }

        await toolCmd({
            dir: workDir,
            subCommand: testSubCommand,
            subArgs: testSubArgs,
            scope: testScope,
            title: argv['--title'],
            rules: argv['--rule'] || [],
            target: argv['--target']?.[0] || argv['--target'] as string | undefined,
            testDirectory: argv['--test-directory'],
            statePath: argv['--state'],
            backupPath: argv['--backup'],
            variables: variableParser,
            verbose,
        });
        process.exit(process.exitCode || 0);
    }

    if (command === 'fmt') {
        const testDir = argv['--test-directory'] ? resolve(workDir, argv['--test-directory']) : workDir;
        const targetDir = commandArgs.length > 0 ? resolve(workDir, commandArgs[0]) : testDir;
        await fmtCmd({
            dir: targetDir,
            check: argv['--check'],
            list: argv['--list'] ?? true,
            write: argv['--write'] ?? true,
            recursive: argv['--recursive']
        });
        process.exit(process.exitCode || 0);
    }

    if (command === 'print') {
        if (commandArgs.length === 0) {
            logger.error(`Usage: ${TITLE_CLI} print <file> [options]`);
            process.exit(1);
        }
        await printCmd({
            dir: workDir,
            file: commandArgs[0],
            format: argv['--format'] || 'testform',
            scope: singleScope,
            variables: variableParser
        });
        process.exit(process.exitCode || 0);
    }

    if (command === 'login') {
        const hostname = commandArgs.length > 0 ? commandArgs[0] : 'github.com';
        await loginCmd({ hostname });
        process.exit(process.exitCode || 0);
    }

    if (command === 'logout') {
        const hostname = commandArgs.length > 0 ? commandArgs[0] : 'github.com';
        await logoutCmd({ hostname });
        process.exit(process.exitCode || 0);
    }

    console.log(`Unknown command: ${command}\n\n${HELP_GLOBAL}`);
    process.exit(1);
};

export { main };

if (require.main === module || !module.parent) {
    main().catch((err: any) => {
        console.error(chalk.red(`\nFatal Error: ${err.message}\n`));
        process.exit(1);
    });
}
