#!/usr/bin/env node
import { parseArgs } from 'node:util';
import chalk from 'chalk';
import { resolve } from 'path';

// Commands
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
import { printCmd } from './commands/print';

import { IScope } from './core/types';
import { VariableParser } from './core/variables';
import { VERSION_CLI } from './core/const';
import { HELP_GLOBAL, getCommandHelp } from './core/help';

function getScope(scopeStr?: string): IScope | 'all' {
  if (scopeStr === 'testrun' || scopeStr === 'testplan' || scopeStr === 'testcase' || scopeStr === 'all') {
    return scopeStr;
  }
  return 'testcase'; // default
}

function getVariables(varArg: any, varFileArg: any, workDir: string) {
  const vars: string[] = Array.isArray(varArg) ? varArg : (varArg ? [varArg] : []);
  const varFiles: string[] = Array.isArray(varFileArg) ? varFileArg : (varFileArg ? [varFileArg] : []);
  return new VariableParser(vars, varFiles, workDir);
}

const args = process.argv.slice(2);

// 1. Global Parse
let globalValues: any;
let globalPositionals: any;

try {
  const parsed = parseArgs({
    args,
    options: {
      chdir: { type: 'string', short: 'C', default: '.' },
      'no-color': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      scope: { type: 'string', short: 's' }
    },
    strict: false
  });
  globalValues = parsed.values;
  globalPositionals = parsed.positionals;
} catch (err: any) {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
}

if (globalValues.version || globalValues.v) {
  console.log(VERSION_CLI);
  process.exit(0);
}

if (globalValues['no-color']) {
  chalk.level = 0;
}

const globals = {
  chdir: globalValues.chdir || '.',
  noColor: !!globalValues['no-color'],
  scope: globalValues.scope,
  help: !!globalValues.help || !!globalValues.h
};

const command = globalPositionals[0];

if (!command) {
  console.log(HELP_GLOBAL);
  process.exit(globals.help ? 0 : 1);
}

const subArgs = args.slice(args.indexOf(command) + 1);

// Helper to check sub-help
function checkSubHelp(options: any) {
  if (options.help || options.h || globals.help) {
    const helpTxt = getCommandHelp(command);
    if (helpTxt) console.log(helpTxt);
    else console.log(`No help available for ${command}`);
    process.exit(0);
  }
}

// 2. Subcommand Routing
async function main() {
  switch (command) {

    case 'init': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          'backend-config': { type: 'string', multiple: true },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          reconfigure: { type: 'boolean' },
          'migrate-state': { type: 'boolean' },
          backend: { type: 'boolean', default: true },
          json: { type: 'boolean' },
          input: { type: 'boolean', default: true },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await initCmd({
        dir: globals.chdir, verbose: !!opts.verbose, backendConfigRaw: opts['backend-config'] as string[],
        lock: opts.lock as boolean, lockTimeout: opts['lock-timeout'] as string, reconfigure: !!opts.reconfigure,
        migrateState: !!opts['migrate-state'], backendEnabled: opts.backend as boolean, isJson: !!opts.json, inputEnabled: opts.input as boolean
      });
      break;
    }

    case 'validate': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          scope: { type: 'string', short: 's' },
          var: { type: 'string', multiple: true },
          'var-file': { type: 'string', multiple: true },
          json: { type: 'boolean' },
          'test-directory': { type: 'string' },
          'no-tests': { type: 'boolean' },
          query: { type: 'string' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const dir = positionals[0] || globals.chdir;
      await validateCmd({
        targetPath: dir, verbose: !!opts.verbose, scope: getScope(opts.scope as string || globals.scope) as IScope,
        variables: getVariables(opts.var, opts['var-file'], globals.chdir), isJson: !!opts.json, testDirectory: opts['test-directory'] as string,
        noTests: !!opts['no-tests'], query: opts.query as string
      });
      break;
    }

    case 'plan': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          scope: { type: 'string', short: 's' },
          out: { type: 'string', short: 'o' },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          var: { type: 'string', multiple: true },
          'var-file': { type: 'string', multiple: true },
          json: { type: 'boolean' },
          'detailed-exitcode': { type: 'boolean' },
          state: { type: 'string' },
          backup: { type: 'string' },
          target: { type: 'string', multiple: true },
          destroy: { type: 'boolean' },
          refresh: { type: 'boolean', default: true },
          'refresh-only': { type: 'boolean' },
          replace: { type: 'string', multiple: true },
          parallelism: { type: 'string' },
          'compact-warnings': { type: 'boolean' },
          'test-directory': { type: 'string' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await planCmd({
        dir: globals.chdir, verbose: !!opts.verbose, scope: getScope(opts.scope as string || globals.scope), outPath: opts.out as string,
        lock: opts.lock as boolean, lockTimeout: opts['lock-timeout'] as string, variables: getVariables(opts.var, opts['var-file'], globals.chdir),
        isJson: !!opts.json, detailedExitCode: !!opts['detailed-exitcode'], statePath: opts.state as string, backupPath: opts.backup as string,
        target: opts.target as string[], destroyPlan: !!opts.destroy, refresh: opts.refresh as boolean, refreshOnly: !!opts['refresh-only'],
        replaceTargets: opts.replace as string[], parallelism: opts.parallelism as string, compactWarnings: !!opts['compact-warnings'],
        testDirectory: opts['test-directory'] as string
      });
      break;
    }

    case 'apply': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          scope: { type: 'string', short: 's' },
          'auto-approve': { type: 'boolean', short: 'a' },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          input: { type: 'boolean', default: true },
          var: { type: 'string', multiple: true },
          'var-file': { type: 'string', multiple: true },
          state: { type: 'string' },
          backup: { type: 'string' },
          target: { type: 'string', multiple: true },
          refresh: { type: 'boolean', default: true },
          'refresh-only': { type: 'boolean' },
          'set-status': { type: 'string' },
          replace: { type: 'string', multiple: true },
          parallelism: { type: 'string' },
          'compact-warnings': { type: 'boolean' },
          'test-directory': { type: 'string' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const planFile = positionals[0];
      await applyCmd({
        dir: globals.chdir, autoApprove: !!opts['auto-approve'], verbose: !!opts.verbose, scope: getScope(opts.scope as string || globals.scope),
        planFile: planFile, lock: opts.lock as boolean, lockTimeout: opts['lock-timeout'] as string, input: opts.input as boolean,
        variables: getVariables(opts.var, opts['var-file'], globals.chdir), statePath: opts.state as string, backupPath: opts.backup as string,
        target: opts.target as string[], refresh: opts.refresh as boolean, refreshOnly: !!opts['refresh-only'], setStatus: opts['set-status'] as string,
        replaceTargets: opts.replace as string[], parallelism: opts.parallelism as string, compactWarnings: !!opts['compact-warnings'],
        testDirectory: opts['test-directory'] as string
      });
      break;
    }

    case 'destroy': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          scope: { type: 'string', short: 's' },
          'auto-approve': { type: 'boolean', short: 'a' },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          input: { type: 'boolean', default: true },
          var: { type: 'string', multiple: true },
          'var-file': { type: 'string', multiple: true },
          state: { type: 'string' },
          backup: { type: 'string' },
          target: { type: 'string', multiple: true },
          refresh: { type: 'boolean', default: true },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await destroyCmd({
        dir: globals.chdir, verbose: !!opts.verbose, scope: getScope(opts.scope as string || globals.scope),
        lock: opts.lock as boolean, lockTimeout: opts['lock-timeout'] as string, input: opts.input as boolean,
        statePath: opts.state as string, backupPath: opts.backup as string
      });
      break;
    }

    case 'show': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          json: { type: 'boolean' },
          state: { type: 'string' },
          backup: { type: 'string' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const path = positionals[0];
      await showCmd({
        path: path, isJson: !!opts.json, verbose: !!opts.verbose, dir: globals.chdir, statePath: opts.state as string, backupPath: opts.backup as string
      });
      break;
    }

    case 'refresh': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          scope: { type: 'string', short: 's' },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          state: { type: 'string' },
          backup: { type: 'string' },
          parallelism: { type: 'string' },
          'compact-warnings': { type: 'boolean' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await refreshCmd({
        dir: globals.chdir, verbose: !!opts.verbose, scope: getScope(opts.scope as string || globals.scope), lock: opts.lock as boolean,
        lockTimeout: opts['lock-timeout'] as string, statePath: opts.state as string, backupPath: opts.backup as string,
        parallelismRaw: opts.parallelism as string, compactWarnings: !!opts['compact-warnings']
      });
      break;
    }

    case 'diff': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          scope: { type: 'string', short: 's' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await diffCmd({ dir: globals.chdir, verbose: !!opts.verbose, scope: getScope(opts.scope as string || globals.scope) });
      break;
    }

    case 'import': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          scope: { type: 'string', short: 's' },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          state: { type: 'string' },
          backup: { type: 'string' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const addr = positionals[0];
      const issue = positionals[1];
      await importCmd({
        dir: globals.chdir, scope: getScope(opts.scope as string || globals.scope) as IScope, identityArg: addr, issueNumber: issue,
        lock: opts.lock as boolean, lockTimeout: opts['lock-timeout'] as string, statePath: opts.state as string, backupPath: opts.backup as string
      });
      break;
    }

    case 'state': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          state: { type: 'string' },
          backup: { type: 'string' },
          json: { type: 'boolean' },
          id: { type: 'string' },
          'dry-run': { type: 'boolean' },
          force: { type: 'boolean' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const action = positionals[0];
      const cmdArgs = positionals.slice(1);
      await stateCmd({
        dir: globals.chdir, action: action, args: cmdArgs, statePath: opts.state as string, backupPath: opts.backup as string,
        isJson: !!opts.json, id: opts.id as string, dryRun: !!opts['dry-run'], force: !!opts.force
      });
      break;
    }

    case 'taint': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          state: { type: 'string' },
          backup: { type: 'string' },
          'allow-missing': { type: 'boolean' },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const name = positionals[0];
      await taintCmd({
        dir: globals.chdir, action: 'taint', identityRaw: name, statePath: opts.state as string, backupPath: opts.backup as string,
        allowMissing: !!opts['allow-missing'], lock: opts.lock as boolean, lockTimeout: opts['lock-timeout'] as string
      });
      break;
    }

    case 'untaint': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          state: { type: 'string' },
          backup: { type: 'string' },
          'allow-missing': { type: 'boolean' },
          lock: { type: 'boolean', default: true },
          'lock-timeout': { type: 'string', default: '0s' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const name = positionals[0];
      await taintCmd({
        dir: globals.chdir, action: 'untaint', identityRaw: name, statePath: opts.state as string, backupPath: opts.backup as string,
        allowMissing: !!opts['allow-missing'], lock: opts.lock as boolean, lockTimeout: opts['lock-timeout'] as string
      });
      break;
    }

    case 'force-unlock': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          force: { type: 'boolean' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const lockId = positionals[0];
      await forceUnlockCmd({ dir: globals.chdir, lockId: lockId, force: !!opts.force });
      break;
    }

    case 'graph': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          type: { type: 'string', default: 'plan' },
          'draw-cycles': { type: 'boolean' },
          'module-depth': { type: 'string' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await graphCmd({ dir: globals.chdir, drawCycles: !!opts['draw-cycles'] });
      break;
    }

    case 'workspace': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await workspaceCmd({ dir: globals.chdir, verbose: !!opts.verbose, args: positionals });
      break;
    }

    case 'report': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          verbose: { type: 'boolean' },
          format: { type: 'string', default: 'text' },
          filter: { type: 'string', multiple: true },
          out: { type: 'string' },
          apply: { type: 'boolean' },
          var: { type: 'string', multiple: true },
          'var-file': { type: 'string', multiple: true },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const type = positionals[0] || 'default';
      await reportCmd({
        dir: globals.chdir, type: type, format: opts.format as string, filter: (opts.filter as string[]) || [], out: opts.out as string, apply: !!opts.apply,
        variables: getVariables(opts.var, opts['var-file'], globals.chdir)
      });
      break;
    }

    case 'generate': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          title: { type: 'string' },
          rule: { type: 'string', multiple: true },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await generateCmd({ dir: globals.chdir, scope: getScope(globals.scope) as IScope, title: opts.title as string, rules: opts.rule as string[] });
      break;
    }

    case 'fmt': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          check: { type: 'boolean' },
          list: { type: 'boolean', default: true },
          write: { type: 'boolean', default: true },
          recursive: { type: 'boolean' },
          'test-directory': { type: 'string' },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const dir = positionals[0];
      const testDir = opts['test-directory'] ? resolve(globals.chdir, opts['test-directory'] as string) : globals.chdir;
      await fmtCmd({ dir: dir || testDir, check: !!opts.check, list: !!opts.list, write: !!opts.write, recursive: !!opts.recursive });
      break;
    }

    case 'print': {
      const parsed = parseArgs({
        args: subArgs,
        options: {
          file: { type: 'string' },
          format: { type: 'string', default: 'testform' },
          var: { type: 'string', multiple: true },
          'var-file': { type: 'string', multiple: true },
          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      await printCmd({
        dir: globals.chdir, file: opts.file as string, format: opts.format as string, scope: getScope(globals.scope) as IScope,
        variables: getVariables(opts.var, opts['var-file'], globals.chdir)
      });
      break;
    }

    case 'login': {
      const parsed = parseArgs({
        args: subArgs,
        options: {

          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const hostname = positionals[0] || 'github.com';
      await loginCmd({ hostname });
      break;
    }

    case 'logout': {
      const parsed = parseArgs({
        args: subArgs,
        options: {

          help: { type: 'boolean', short: 'h' }
        },
        strict: false
      });
      const opts = parsed.values;
      const positionals = parsed.positionals;
      checkSubHelp(opts);
      const hostname = positionals[0] || 'github.com';
      await logoutCmd({ hostname });
      break;
    }

    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      console.log(HELP_GLOBAL);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(chalk.red(`Fatal Error: ${err.message}`));
  process.exit(1);
});
