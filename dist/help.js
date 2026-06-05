"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP_REPORT = exports.HELP_DIFF = exports.HELP_WORKSPACE = exports.HELP_VERSION = exports.HELP_UNTAINT = exports.HELP_TAINT = exports.HELP_STATE_SHOW = exports.HELP_STATE_RM = exports.HELP_STATE_PUSH = exports.HELP_STATE_PULL = exports.HELP_STATE_MV = exports.HELP_STATE_LIST = exports.HELP_STATE_IDENTITIES = exports.HELP_STATE = exports.HELP_LOGOUT = exports.HELP_LOGIN = exports.HELP_GRAPH = exports.HELP_FORCE_UNLOCK = exports.HELP_FMT = exports.HELP_SHOW = exports.HELP_REFRESH = exports.HELP_IMPORT = exports.HELP_DESTROY = exports.HELP_APPLY = exports.HELP_VALIDATE = exports.HELP_PLAN = exports.HELP_INIT = exports.HELP_GLOBAL = void 0;
exports.getCommandHelp = getCommandHelp;
const const_1 = require("./const");
const chalk_1 = require("chalk");
exports.HELP_GLOBAL = `
${(0, chalk_1.bold)('Usage:')} ${const_1.TITLE_CLI} [global options] [subcommand] [args]

The available commands for execution are listed below.
The primary workflow commands are given first, followed by
less common or more advanced commands.

${(0, chalk_1.bold)('Main commands:')}
  init          Prepare working directory for other commands
  validate      Check whether the configuration is valid
  plan          Show changes required by current configuration
  apply         Create or update resources 
  destroy       Destroy previously-created resources 

${(0, chalk_1.bold)('All other commands:')}
  diff          Show drift between local configuration and state
  fmt           Reformat your configuration in the standard style
  force-unlock  Release a stuck lock on the current workspace
  graph         Generate a Graphviz graph of the steps in an operation
  import        Associate existing infrastructure with a ${const_1.TITLE_APP} resource
  login         Obtain and save credentials for a remote host
  logout        Remove locally-stored credentials for a remote host
  refresh       Update the state to match remote systems
  report        Generate multi-dimensional test execution reports
  show          Show the current state or a saved plan
  state         Advanced state management
  taint         Mark a resource instance as not fully functional
  untaint       Remove the 'tainted' state from a resource instance
  version       Show the current ${const_1.TITLE_APP} version
  workspace     Workspace management

${(0, chalk_1.bold)('Global options (use these before the subcommand, if any):')}
  -chdir=DIR    Switch to a different working directory before executing the given subcommand.
  -projectId=ID Override the default project ID defined in your testform.json.
  -scope=SCOPE  Limit the scope of the execution (e.g. to a specific feature or tag).
  -help         Show this help output, or the help for a specified subcommand.
  -version      An alias for the "version" subcommand.
`;
exports.HELP_INIT = `
Usage: ${const_1.TITLE_CLI} [global options] init [options]

  Initialize a new or existing ${const_1.TITLE_APP} working directory by creating
  initial files and loading any remote state.

  This is the first command that should be run for any new or existing
  ${const_1.TITLE_APP} configuration per machine. This sets up all the local data
  necessary to run ${const_1.TITLE_APP}.

  This command is always safe to run multiple times.

Options:

  -backend=false          Disable backend initialization for this configuration
                          and use what was previously initialized instead.

  -backend-config=path    Configuration to be merged with what is in the
                          configuration file's 'backend' block. This can be
                          a 'key=value' format, and can be specified multiple
                          times.

  -lock=false             Don't hold a state lock during backend migration.
                          This is dangerous if others might concurrently run
                          commands against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -no-color               If specified, output won't contain any color.

  -json                   If specified, machine readable output will be
                          printed in JSON format.

  -reconfigure            Reconfigure a backend, ignoring any saved
                          configuration.

  -migrate-state          Reconfigure a backend, and attempt to migrate any
                          existing state.
`.trim();
exports.HELP_PLAN = `
Usage: ${const_1.TITLE_CLI} [global options] plan [options]

  Generates a speculative execution plan, showing what actions ${const_1.TITLE_APP}
  would take to apply the current configuration. This command will not
  actually perform the planned actions.

  You can optionally save the plan to a file, which you can then pass to
  the "apply" command to perform exactly the actions described in the plan.

Plan Customization Options:

  The following options customize how ${const_1.TITLE_APP} will produce its plan. You
  can also use these options when you run "${const_1.TITLE_CLI} apply" without passing
  it a saved plan, in order to plan and apply in a single command.

  -destroy            Select the "destroy" planning mode, which creates a plan
                      to destroy all objects currently managed by this
                      ${const_1.TITLE_APP} configuration instead of the usual behavior.

  -refresh-only       Select the "refresh only" planning mode, which checks
                      whether remote objects still match the outcome of the
                      most recent ${const_1.TITLE_APP} apply but does not propose any
                      actions to undo any changes made outside of ${const_1.TITLE_APP}.

  -refresh=false      Skip checking for external changes to remote objects
                      while creating the plan. This can potentially make
                      planning faster, but at the expense of possibly planning
                      against a stale record of the remote system state.

  -replace=resource   Force replacement of a particular resource instance using
                      its resource address. If the plan would've normally
                      produced an update or no-op action for this instance,
                      ${const_1.TITLE_APP} will plan to replace it instead. You can use
                      this option multiple times to replace more than one object.

  -target=resource    Limit the planning operation to only the given module,
                      resource, or resource instance and all of its
                      dependencies. You can use this option multiple times to
                      include more than one object. This is for exceptional
                      use only.

  -var 'foo=bar'      Set a value for one of the input variables in the root
                      module of the configuration. Use this option more than
                      once to set more than one variable.

  -var-file=filename  Load variable values from the given file, in addition
                      to the default files ${const_1.TITLE_CLI}.tfvars and *.auto.tfvars.
                      Use this option more than once to include more than one
                      variables file.

Other Options:

  -compact-warnings          If ${const_1.TITLE_APP} produces any warnings that are not
                             accompanied by errors, shows them in a more compact
                             form that includes only the summary messages.

  -detailed-exitcode         Return detailed exit codes when the command exits.
                             This will change the meaning of exit codes to:
                             0 - Succeeded, diff is empty (no changes)
                             1 - Errored
                             2 - Succeeded, there is a diff

  -lock=false                Don't hold a state lock during the operation. This
                             is dangerous if others might concurrently run
                             commands against the same workspace.

  -lock-timeout=0s           Duration to retry a state lock.

  -no-color                  If specified, output won't contain any color.

  -out=path                  Write a plan file to the given path. This can be
                             used as input to the "apply" command.

  -parallelism=n             Limit the number of concurrent operations. Defaults
                             to 10.

  -state=statefile           A legacy option used for the local backend only.
                             See the local backend's documentation for more
                             information.
                             
  -backup=path               Path to backup the existing state file before
                             modifying. Defaults to the "-state" path with
                             ".backup" extension.

  -test-directory=path       Set the ${const_1.TITLE_APP} test directory. If omitted,
                             defaults to the chdir directory.
`.trim();
exports.HELP_VALIDATE = `
Usage: ${const_1.TITLE_CLI} [global options] validate [options]

  Validate the configuration files in a directory, referring only to the
  configuration and not accessing any remote services.

  Validate runs checks that verify whether a configuration is syntactically
  valid and internally consistent.

Options:

  -json                 Produce output in a machine-readable JSON format.
                        Always disables color.

  -no-color             If specified, output won't contain any color.

  -no-tests             If specified, ${const_1.TITLE_APP} will only parse the files and
                        skip policy validations.

  -test-directory=path  Set the ${const_1.TITLE_APP} test directory, defaults to "tests".
  
  -query=string         Filter the parsed documents to locate specific test 
                        scenarios across the active scope.
`.trim();
exports.HELP_APPLY = `
Usage: ${const_1.TITLE_CLI} [global options] apply [options] [PLAN]

  Creates or updates infrastructure according to ${const_1.TITLE_APP} configuration
  files in the current directory.

  By default, ${const_1.TITLE_APP} will generate a new plan and present it for your
  approval before taking any action. You can optionally provide a plan
  file created by a previous call to "${const_1.TITLE_CLI} plan", in which case
  ${const_1.TITLE_APP} will take the actions described in that plan without any
  confirmation prompt.

Options:

  -auto-approve          Skip interactive approval of plan before applying.

  -backup=path           Path to backup the existing state file before
                         modifying. Defaults to the "-state" path with
                         ".backup" extension. Set to "-" to disable backup.

  -compact-warnings      If ${const_1.TITLE_APP} produces any warnings that are not
                         accompanied by errors, show them in a more compact
                         form that includes only the summary messages.

  -destroy               Destroy ${const_1.TITLE_APP}-managed infrastructure.
                         The command "${const_1.TITLE_CLI} destroy" is a convenience alias
                         for this option.

  -lock=false            Don't hold a state lock during the operation. This is
                         dangerous if others might concurrently run commands
                         against the same workspace.

  -lock-timeout=0s       Duration to retry a state lock.

  -input=true            Ask for input for variables if not directly set.

  -no-color              If specified, output won't contain any color.

  -parallelism=n         Limit the number of parallel resource operations.
                         Defaults to 10.

  -replace=resource      ${const_1.TITLE_APP} will plan to replace this resource instance
                         instead of doing an update or no-op action. 

  -set-status=assigns    Injects or updates the status field in your local
                         testrun features before applying.
                         (e.g., "tc1=passed,tc2=failed").
                         Supported statuses: passed, failed, pending,
                         blocked, skipped, unexecuted.

  -state=path            Path to read and save state. Defaults to "testform.tfstate".
                         Legacy option for the local backend only. See the local
                         backend's documentation for more information.

  -var 'foo=bar'         Set a value for one of the input variables in the root
                         module of the configuration. Use this option more than
                         once to set more than one variable.

  -var-file=filename     Load variable values from the given file, in addition
                         to the default files ${const_1.TITLE_CLI}.tfvars and *.auto.tfvars.
                         Use this option more than once to include more than one
                         variables file.

  -test-directory=path   Set the ${const_1.TITLE_APP} test directory. If omitted,
                         defaults to the chdir directory.

  If you don't provide a saved plan file then this command will also accept
  all of the plan-customization options accepted by the ${const_1.TITLE_CLI} plan command.
  For more information on those options, run:
      ${const_1.TITLE_CLI} plan -help
`.trim();
exports.HELP_DESTROY = `
Usage: ${const_1.TITLE_CLI} [global options] destroy [options]

  Destroy ${const_1.TITLE_APP}-managed infrastructure.

  This command is a convenience alias for:
      ${const_1.TITLE_CLI} apply -destroy

  This command also accepts many of the plan-customization options accepted by
  the ${const_1.TITLE_CLI} plan command. For more information on those options, run:
      ${const_1.TITLE_CLI} plan -help
`.trim();
exports.HELP_IMPORT = `
Usage: ${const_1.TITLE_CLI} [global options] import [options] ADDR ISSUE_NUMBER

  Import an existing GitHub Issue into your ${const_1.TITLE_APP} state.

  This command connects to GitHub, fetches the specified ISSUE_NUMBER, and
  imports it into your local ${const_1.TITLE_APP} state under the given ADDR (Identity).
  This allows existing GitHub Issues to come under ${const_1.TITLE_APP} management
  without having to be initially created via a 'testform apply'.

  ADDR: The identity of the scenario (e.g., 'test1').
  ISSUE_NUMBER: The numeric ID of the GitHub Issue to import (e.g., '123').

  This command will make network requests to GitHub but will not modify
  the remote issue.

Options:

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -no-color               If specified, output won't contain any color.

  -state, and -backup     Custom paths for the state and backup files.
`.trim();
exports.HELP_REFRESH = `
Usage: ${const_1.TITLE_CLI} [global options] refresh [options]

  Update the local state file by checking the real-world status of all tracked
  GitHub Issues and updating their metadata (e.g., titles, descriptions).

  This command will not modify your GitHub Issues, but it will modify your
  local state file to reflect any changes made on GitHub. These state changes
  might cause new actions to occur when you generate a plan or call apply next.

Options:

  -compact-warnings   If ${const_1.TITLE_APP} produces any warnings that are not
                      accompanied by errors, show them in a more compact form
                      that includes only the summary messages.

  -lock=false         Don't hold a state lock during the operation. This is
                      dangerous if others might concurrently run commands
                      against the same workspace.

  -lock-timeout=0s    Duration to retry a state lock.

  -no-color           If specified, output won't contain any color.

  -parallelism=n      Limit the number of concurrent operations. Defaults to 10.

  -state, and -backup Custom paths for the state and backup files.
`.trim();
exports.HELP_SHOW = `
Usage: ${const_1.TITLE_CLI} [global options] show [options] [path]

  Reads and outputs a ${const_1.TITLE_APP} state or plan file in a human-readable
  form. If no path is specified, the current state will be shown.

Options:

  -no-color           If specified, output won't contain any color.
  -json               If specified, output the ${const_1.TITLE_APP} plan or state in
                      a machine-readable form.
`.trim();
exports.HELP_FMT = `
Usage: ${const_1.TITLE_CLI} [global options] fmt [options] [target...]

  Rewrites all ${const_1.TITLE_APP} scenario files to a canonical format. All
  testing files (.feature) are updated using standard Gherkin syntax
  indentation.

  By default, fmt scans the current directory for .feature files. If you
  provide a directory for the target argument, then fmt will scan that
  directory instead.

  The content must be in the Gherkin language native syntax.

Options:

  -list=false    Don't list files whose formatting differs

  -write=false   Don't write to source files

  -check         Check if the input is formatted. Exit status will be 3 if
                 any input is not properly formatted and zero otherwise.

  -no-color      If specified, output won't contain any color.

  -recursive     Also process files in subdirectories. By default, only the
                 given directory (or current directory) is processed.
`.trim();
exports.HELP_FORCE_UNLOCK = `
Usage: ${const_1.TITLE_CLI} [global options] force-unlock LOCK_ID

  Manually unlock the state for the defined configuration.

  This will not modify your infrastructure. This command removes the lock on the
  state for the current workspace. The behavior of this lock is dependent
  on the backend being used. Local state files cannot be unlocked by another
  process.

Options:

  -force                 Don't ask for input for unlock confirmation.
`.trim();
exports.HELP_GRAPH = `
Usage: ${const_1.TITLE_CLI} [global options] graph [options]

  Produces an ASCII tree representation of the dependency graph between
  different objects in the current test configuration and state.

  By default the graph shows the relationships between the hierarchical
  components in your configuration: Test Plans -> Test Runs -> Test Cases.

Options:

  -draw-cycles     Highlight the dependency links in the graph with colored
                   edges to explicitly visualize the dependency between
                   Plans, Runs, and Cases.

  -type=TYPE       (deprecated) In prior versions of Testform, specified the
                   type of operation graph to output.

  -module-depth=n  (deprecated) In prior versions of Testform, specified the
                   depth of modules to show in the output.
`.trim();
exports.HELP_LOGIN = `
Usage: ${const_1.TITLE_CLI} [global options] login [hostname]

  Retrieves an authentication token for the given hostname, if it supports
  automatic login, and saves it in a credentials file in your home directory.

  If no hostname is provided, the default hostname is github.com, to
  log in to GitHub.

  If not overridden by credentials helper settings in the CLI configuration,
  the credentials will be written to the following local file:
      ~/.testform.d/credentials.json
`.trim();
exports.HELP_LOGOUT = `
Usage: ${const_1.TITLE_CLI} [global options] logout [hostname]

  Removes locally-stored credentials for specified hostname.

  Note: the API token is only removed from local storage, not destroyed on the
  remote server, so it will remain valid until manually revoked.

  If no hostname is provided, the default hostname is github.com.
`.trim();
exports.HELP_STATE = `
Usage: ${const_1.TITLE_CLI} [global options] state [subcommand] [options] [args]

  This command has subcommands for advanced state management.

  These subcommands can be used to slice and dice the ${const_1.TITLE_APP} state.
  This is sometimes necessary in advanced cases. For your safety, all
  state management commands that modify the state create a timestamped
  backup of the state prior to making modifications.

Subcommands:
    identities          List the identities of resources in the state
    list                List resources in the state
    mv                  Move an item in the state
    pull                Pull current state and output to stdout
    push                Update remote state from a local state file
    rm                  Remove instances from the state
    show                Show a resource in the state
`.trim();
exports.HELP_STATE_IDENTITIES = `
Usage: ${const_1.TITLE_CLI} [global options] state identities [options] -json [address...]

  List the json format of the identities of resources in the ${const_1.TITLE_APP} state.

  This command lists the identities of resource instances in the ${const_1.TITLE_APP} state in json format.
  The address argument can be used to filter the instances by resource or module. If
  no pattern is given, identities for all resource instances are listed.

  The addresses must either be module addresses or absolute resource
  addresses, such as:
      github_testcase.example
      module.example
      module.example.module.child
      module.example.github_testcase.example

  An error will be returned if any of the resources or modules given as
  filter addresses do not exist in the state.

Options:

  -state=statefile    Path to a ${const_1.TITLE_APP} state file to use to look
                      up ${const_1.TITLE_APP}-managed resources. By default, ${const_1.TITLE_APP}
                      will consult the state of the currently-selected
                      workspace.

  -id=ID              Filters the results to include only instances whose
                      resource types have an attribute named "id" whose value
                      equals the given id string.
`.trim();
exports.HELP_STATE_LIST = `
Usage: ${const_1.TITLE_CLI} [global options] state list [options] [address...]

  List resources in the ${const_1.TITLE_APP} state.

  This command lists resource instances in the ${const_1.TITLE_APP} state. The address
  argument can be used to filter the instances by resource or module. If
  no pattern is given, all resource instances are listed.

  The addresses must either be module addresses or absolute resource
  addresses, such as:
      github_testcase.example
      module.example
      module.example.module.child
      module.example.github_testcase.example

  An error will be returned if any of the resources or modules given as
  filter addresses do not exist in the state.

Options:

  -state=statefile    Path to a ${const_1.TITLE_APP} state file to use to look
                      up ${const_1.TITLE_APP}-managed resources. By default, ${const_1.TITLE_APP}
                      will consult the state of the currently-selected
                      workspace.

  -id=ID              Filters the results to include only instances whose
                      resource types have an attribute named "id" whose value
                      equals the given id string.
`.trim();
exports.HELP_STATE_MV = `
Usage: ${const_1.TITLE_CLI} [global options] state mv [options] SOURCE DESTINATION

 This command will move an item matched by the address given to the
 destination address. This command can also move to a destination address
 in a completely different state file.

 This can be used for simple resource renaming, moving items to and from
 a module, moving entire modules, and more. And because this command can also
 move data to a completely new state, it can also be used for refactoring
 one configuration into multiple separately managed ${const_1.TITLE_APP} configurations.

 This command will output a backup copy of the state prior to saving any
 changes. The backup cannot be disabled. Due to the destructive nature
 of this command, backups are required.

 If you're moving an item to a different state file, a backup will be created
 for each state file.

Options:

  -dry-run                If set, prints out what would've been moved but doesn't
                          actually move anything.

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -ignore-remote-version  A rare option used for the remote backend only. See
                          the remote backend documentation for more information.

  -state, state-out, and -backup are legacy options supported for the local
  backend only. For more information, see the local backend's documentation.
`.trim();
exports.HELP_STATE_PULL = `
Usage: ${const_1.TITLE_CLI} [global options] state pull [options]

  Pull the state from its location, upgrade the local copy, and output it
  to stdout.

  This command "pulls" the current state and outputs it to stdout.
  As part of this process, ${const_1.TITLE_APP} will upgrade the state format of the
  local copy to the current version.

  The primary use of this is for state stored remotely. This command
  will still work with local state but is less useful for this.
`.trim();
exports.HELP_STATE_PUSH = `
Usage: ${const_1.TITLE_CLI} [global options] state push [options] PATH

  Update remote state from a local state file at PATH.

  This command "pushes" a local state and overwrites remote state
  with a local state file. The command will protect you against writing
  an older serial or a different state file lineage unless you specify the
  "-force" flag.

  This command works with local state (it will overwrite the local
  state), but is less useful for this use case.

  If PATH is "-", then this command will read the state to push from stdin.
  Data from stdin is not streamed to the backend: it is loaded completely
  (until pipe close), verified, and then pushed.

Options:

  -force              Write the state even if lineages don't match or the
                      remote serial is higher.

  -lock=false         Don't hold a state lock during the operation. This is
                      dangerous if others might concurrently run commands
                      against the same workspace.

  -lock-timeout=0s    Duration to retry a state lock.
`.trim();
exports.HELP_STATE_RM = `
Usage: ${const_1.TITLE_CLI} [global options] state rm [options] ADDRESS...

  Remove one or more items from the ${const_1.TITLE_APP} state, causing ${const_1.TITLE_APP} to
  "forget" those items without first destroying them in the remote system.

  This command removes one or more resource instances from the ${const_1.TITLE_APP} state
  based on the addresses given. You can view and list the available instances
  with "${const_1.TITLE_CLI} state list".

  If you give the address of an entire module then all of the instances in
  that module and any of its child modules will be removed from the state.

  If you give the address of a resource that has "count" or "for_each" set,
  all of the instances of that resource will be removed from the state.

Options:

  -dry-run                If set, prints out what would've been removed but
                          doesn't actually remove anything.

  -backup=PATH            Path where ${const_1.TITLE_APP} should write the backup
                          state.

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -state=PATH             Path to the state file to update. Defaults to the
                          current workspace state.
                          Legacy option for the local backend only. See
                          the local backend's documentation for more
                          information.

  -ignore-remote-version  Continue even if remote and local ${const_1.TITLE_APP} versions
                          are incompatible. This may result in an unusable
                          workspace, and should be used with extreme caution.
`.trim();
exports.HELP_STATE_SHOW = `
Usage: ${const_1.TITLE_CLI} [global options] state show [options] ADDRESS

  Shows the attributes of a resource in the ${const_1.TITLE_APP} state.

  This command shows the attributes of a single resource in the ${const_1.TITLE_APP}
  state. The address argument must be used to specify a single resource.
  You can view the list of available resources with "${const_1.TITLE_CLI} state list".

Options:

  -state=statefile    Path to a ${const_1.TITLE_APP} state file to use to look
                      up ${const_1.TITLE_APP}-managed resources. By default it will
                      use the state "${const_1.FILE_STATE}" if it exists.
`.trim();
exports.HELP_TAINT = `
Usage: ${const_1.TITLE_CLI} [global options] taint [options] [address]

  ${const_1.TITLE_APP} uses the term "tainted" to describe a resource instance
  which may not be fully functional, either because its creation
  partially failed or because you've manually marked it as such using
  this command.

  This will not modify your infrastructure directly, but subsequent
  ${const_1.TITLE_APP} plans will include actions to destroy the remote object
  and create a new object to replace it.

  You can remove the "taint" state from a resource instance using
  the "${const_1.TITLE_CLI} untaint" command.

  The address is in the usual resource address syntax, such as:
    aws_instance.foo
    aws_instance.bar[1]
    module.foo.module.bar.aws_instance.baz

  Use your shell's quoting or escaping syntax to ensure that the
  address will reach ${const_1.TITLE_APP} correctly, without any special
  interpretation.

Options:

  -allow-missing          If specified, the command will succeed (exit code 0)
                          even if the resource is missing.

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -state, and -backup     Custom paths for the state and backup files.
`.trim();
exports.HELP_UNTAINT = `
Usage: ${const_1.TITLE_CLI} [global options] untaint [options] name

  ${const_1.TITLE_APP} uses the term "tainted" to describe a resource instance
  which may not be fully functional, either because its creation
  partially failed or because you've manually marked it as such using
  the "${const_1.TITLE_CLI} taint" command.

  This command removes that state from a resource instance, causing
  ${const_1.TITLE_APP} to see it as fully-functional and not in need of
  replacement.

  This will not modify your infrastructure directly. It only avoids
  ${const_1.TITLE_APP} planning to replace a tainted instance in a future operation.

Options:

  -allow-missing          If specified, the command will succeed (exit code 0)
                          even if the resource is missing.

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -state, and -backup     Custom paths for the state and backup files.
`.trim();
exports.HELP_VERSION = `
Usage: ${const_1.TITLE_CLI} version [options]

  Displays the version of ${const_1.TITLE_APP}.
`.trim();
exports.HELP_WORKSPACE = `
Usage: ${const_1.TITLE_CLI} [global options] workspace

  new, list, show, select and delete ${const_1.TITLE_APP} workspaces.

Subcommands:
    delete    Delete a workspace
    list      List Workspaces
    new       Create a new workspace
    select    Select a workspace
    show      Show the name of the current workspace
`.trim();
exports.HELP_DIFF = `
Usage: ${const_1.TITLE_CLI} [global options] diff [options]

  Show drift between local configuration and state.
`.trim();
exports.HELP_REPORT = `
Usage: ${const_1.TITLE_CLI} [global options] report <type> [options]

  Generates multi-dimensional test reports from the local state.
  Available report types are grouped by scope:

  📦 Scope: Test Case
    testcase-summary     List of all test cases and their status
    test-case-activity   Dashboard of test cases with graphs and trends

  🏃 Scope: Test Run
    testrun-summary      Test runs and their pass/fail metrics
    testrun-detailed     In-depth view of a specific Test Run

  📋 Scope: Test Plan
    testplan-summary     Overall Test Plan Progress and linked test runs

  🌐 Cross-Scope (Multi-dimensional)
    defects              List of failed/blocked tests with issue links
    traceability         Mapping between requirements/tags and test runs
    coverage             Percentage of passed tests grouped by tags
    two-dimensional      Status distribution matrix
    raw                  Extract all data for custom reporting

Options:

  -format <md|csv|json>  Output format. Default is "md" (Markdown).
  -out <path>            Path to save the generated report.
  -filter <key=val>      Filter data by any state attribute. Can be
                         specified multiple times.
  -groupBy <field>       Group results dynamically by a specific field
                         using JSONPath (e.g. attributes.custom_fields.sprint).
  -apply                 Create a GitHub Issue for the report.
  -field <key=val>       Custom field values to attach when -apply is used.
                         Also accepts a JSON string (e.g. '{"key": "val"}').
                         Can be specified multiple times.
`.trim();
function getCommandHelp(command) {
    switch (command) {
        case 'init': return exports.HELP_INIT;
        case 'validate': return exports.HELP_VALIDATE;
        case 'plan': return exports.HELP_PLAN;
        case 'apply': return exports.HELP_APPLY;
        case 'destroy': return exports.HELP_DESTROY;
        case 'import': return exports.HELP_IMPORT;
        case 'refresh': return exports.HELP_REFRESH;
        case 'diff': return exports.HELP_DIFF;
        case 'show': return exports.HELP_SHOW;
        case 'fmt': return exports.HELP_FMT;
        case 'force-unlock': return exports.HELP_FORCE_UNLOCK;
        case 'login': return exports.HELP_LOGIN;
        case 'workspace': return exports.HELP_WORKSPACE;
        case 'report': return exports.HELP_REPORT;
        case 'logout': return exports.HELP_LOGOUT;
        case 'state': return exports.HELP_STATE;
        case 'state identities': return exports.HELP_STATE_IDENTITIES;
        case 'state list': return exports.HELP_STATE_LIST;
        case 'state mv': return exports.HELP_STATE_MV;
        case 'state pull': return exports.HELP_STATE_PULL;
        case 'state push': return exports.HELP_STATE_PUSH;
        case 'state rm': return exports.HELP_STATE_RM;
        case 'state show': return exports.HELP_STATE_SHOW;
        case 'taint': return exports.HELP_TAINT;
        case 'untaint': return exports.HELP_UNTAINT;
        case 'version': return exports.HELP_VERSION;
        default: return null;
    }
}
