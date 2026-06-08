import { FILE_STATE, TITLE_APP, TITLE_CLI } from './const';
import { bold } from 'chalk';

export const HELP_GLOBAL = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] [subcommand] [args]

The available commands for execution are listed below.
The primary workflow commands are given first, followed by
less common or more advanced commands.

${bold(`Main commands:`)}
  init          Prepare working directory for other commands
  validate      Check whether the configuration is valid
  plan          Show changes required by current configuration
  apply         Create or update resources 
  destroy       Destroy previously-created resources 

${bold(`All other commands:`)}
  diff          Show drift between local configuration and state
  print         Parse a feature file and print the JSON AST
  fmt           Reformat your configuration in the standard style
  force-unlock  Release a stuck lock on the current workspace
  graph         Generate a Graphviz graph of the steps in an operation
  import        Associate existing infrastructure with a ${TITLE_APP} resource
  login         Obtain and save credentials for a remote host
  logout        Remove locally-stored credentials for a remote host
  refresh       Update the state to match remote systems
  report        Generate multi-dimensional test execution reports
  show          Show the current state or a saved plan
  state         Advanced state management
  taint         Mark a resource instance as not fully functional
  tool          Manage test files locally (add, autocomplete, state)
  untaint       Remove the 'tainted' state from a resource instance
  version       Show the current ${TITLE_APP} version
  workspace     Workspace management

${bold(`Global options (use these before the subcommand, if any):`)}
  -chdir=DIR    Switch to a different working directory before executing the given subcommand.
  -projectId    Override the default project ID defined in your testform.json.
  -scope        Limit the scope of the execution (testcase, testrun, testplan).
  -help         Show this help output, or the help for a specified subcommand.
  -version      An alias for the "version" subcommand.
`;
export const HELP_INIT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] init [options]

  Initialize a new or existing ${TITLE_APP} working directory by creating
  initial files and loading any remote state.

  This is the first command that should be run for any new or existing
  ${TITLE_APP} configuration per machine. This sets up all the local data
  necessary to run ${TITLE_APP}.

  This command is always safe to run multiple times.

${bold(`Options:`)}

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

export const HELP_PLAN = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] plan [options]

  Generates a speculative execution plan, showing what actions ${TITLE_APP}
  would take to apply the current configuration. This command will not
  actually perform the planned actions.

  You can optionally save the plan to a file, which you can then pass to
  the "apply" command to perform exactly the actions described in the plan.

${bold(`Plan Customization Options:`)}

  The following options customize how ${TITLE_APP} will produce its plan. You
  can also use these options when you run "${TITLE_CLI} apply" without passing
  it a saved plan, in order to plan and apply in a single command.

  -destroy            Select the "destroy" planning mode, which creates a plan
                      to destroy all objects currently managed by this
                      ${TITLE_APP} configuration instead of the usual behavior.

  -refresh-only       Select the "refresh only" planning mode, which checks
                      whether remote objects still match the outcome of the
                      most recent ${TITLE_APP} apply but does not propose any
                      actions to undo any changes made outside of ${TITLE_APP}.

  -refresh=false      Skip checking for external changes to remote objects
                      while creating the plan. This can potentially make
                      planning faster, but at the expense of possibly planning
                      against a stale record of the remote system state.

  -replace=resource   Force replacement of a particular resource instance using
                      its resource address. If the plan would've normally
                      produced an update or no-op action for this instance,
                      ${TITLE_APP} will plan to replace it instead. You can use
                      this option multiple times to replace more than one object.

  -target=resource    Limit the planning operation to only the given module,
                      resource, or resource instance and all of its
                      dependencies. You can use this option multiple times to
                      include more than one object. This is for exceptional
                      use only.

  -var 'foo=bar'      Set a value for one of the input variables in the root
                      module of the configuration. Use this option more than
                      once to set more than one variable.

  -var-file=filename  Load variable values from the given file (.json or key=value format).
                      Use this option more than once to include more than one
                      variables file.

${bold(`Other Options:`)}

  -compact-warnings   If ${TITLE_APP} produces any warnings that are not
                      accompanied by errors, shows them in a more compact
                      form that includes only the summary messages.

  -detailed-exitcode  Return detailed exit codes when the command exits.
                      This will change the meaning of exit codes to:
                      0 - Succeeded, diff is empty (no changes)
                      1 - Errored
                      2 - Succeeded, there is a diff

  -lock=false         Don't hold a state lock during the operation. This
                      is dangerous if others might concurrently run
                      commands against the same workspace.

  -lock-timeout=0s    Duration to retry a state lock.

  -no-color           If specified, output won't contain any color.

  -out=path           Write a plan file to the given path. This can be
                      used as input to the "apply" command.

  -parallelism=n      Limit the number of concurrent operations. Defaults
                      to 10.

  -state=statefile    A legacy option used for the local backend only.
                      See the local backend's documentation for more
                      information.
                      
  -backup=path        Path to backup the existing state file before
                      modifying. Defaults to the "-state" path with
                      ".backup" extension.

  -test-directory=path Set the ${TITLE_APP} test directory. If omitted,
                      defaults to the chdir directory.
`.trim();

export const HELP_VALIDATE = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] validate [options]

  Validate the configuration files in a directory, referring only to the
  configuration and not accessing any remote services.

  Validate runs checks that verify whether a configuration is syntactically
  valid and internally consistent.

${bold(`Options:`)}

  -json                 Produce output in a machine-readable JSON format.
                        Always disables color.

  -no-color             If specified, output won't contain any color.

  -no-tests             If specified, ${TITLE_APP} will only parse the files and
                        skip policy validations.

  -test-directory=path  Set the ${TITLE_APP} test directory, defaults to "tests".
  
  -query=string         Filter the parsed documents to locate specific test 
                        scenarios across the active scope.
`.trim();

export const HELP_APPLY = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] apply [options] [PLAN]

  Creates or updates infrastructure according to ${TITLE_APP} configuration
  files in the current directory.

  By default, ${TITLE_APP} will generate a new plan and present it for your
  approval before taking any action. You can optionally provide a plan
  file created by a previous call to "${TITLE_CLI} plan", in which case
  ${TITLE_APP} will take the actions described in that plan without any
  confirmation prompt.

${bold(`Options:`)}

  -auto-approve       Skip interactive approval of plan before applying.

  -backup=path        Path to backup the existing state file before
                      modifying. Defaults to the "-state" path with
                      ".backup" extension. Set to "-" to disable backup.

  -compact-warnings   If ${TITLE_APP} produces any warnings that are not
                      accompanied by errors, show them in a more compact
                      form that includes only the summary messages.

  -destroy            Destroy ${TITLE_APP}-managed infrastructure.
                      The command "${TITLE_CLI} destroy" is a convenience alias
                      for this option.

  -lock=false         Don't hold a state lock during the operation. This is
                      dangerous if others might concurrently run commands
                      against the same workspace.

  -lock-timeout=0s    Duration to retry a state lock.

  -input=true         Ask for input for variables if not directly set.

  -no-color           If specified, output won't contain any color.

  -parallelism=n      Limit the number of parallel resource operations.
                      Defaults to 10.

  -replace=resource   ${TITLE_APP} will plan to replace this resource instance
                      instead of doing an update or no-op action. 

  -set-status=assigns Injects or updates the status field in your local
                      testrun features before applying.
                      (e.g., "tc1=passed,tc2=failed").
                      Supported statuses: passed, failed, pending,
                      blocked, skipped, unexecuted.

  -state=path         Path to read and save state. Defaults to "testform.tfstate".
                      Legacy option for the local backend only. See the local
                      backend's documentation for more information.

  -var 'foo=bar'      Set a value for one of the input variables in the root
                      module of the configuration. Use this option more than
                      once to set more than one variable.

  -var-file=filename  Load variable values from the given file (.json or key=value format).
                      Use this option more than once to include more than one
                      variables file.

  -test-directory=path Set the ${TITLE_APP} test directory. If omitted,
                      defaults to the chdir directory.

  If you don't provide a saved plan file then this command will also accept
  all of the plan-customization options accepted by the ${TITLE_CLI} plan command.
  For more information on those options, run:
      ${TITLE_CLI} plan -help
`.trim();

export const HELP_DESTROY = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] destroy [options]

  Destroy ${TITLE_APP}-managed infrastructure.

  This command is a convenience alias for:
      ${TITLE_CLI} apply -destroy

  This command also accepts many of the plan-customization options accepted by
  the ${TITLE_CLI} plan command. For more information on those options, run:
      ${TITLE_CLI} plan -help
`.trim();

export const HELP_IMPORT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] import [options] ADDR ISSUE_NUMBER

  Import an existing GitHub Issue into your ${TITLE_APP} state.

  This command connects to GitHub, fetches the specified ISSUE_NUMBER, and
  imports it into your local ${TITLE_APP} state under the given ADDR (Identity).
  This allows existing GitHub Issues to come under ${TITLE_APP} management
  without having to be initially created via a 'testform apply'.

  ADDR: The identity of the scenario (e.g., 'test1').
  ISSUE_NUMBER: The numeric ID of the GitHub Issue to import (e.g., '123').

  This command will make network requests to GitHub but will not modify
  the remote issue.

${bold(`Options:`)}

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -no-color               If specified, output won't contain any color.

  -state, and -backup     Custom paths for the state and backup files.
`.trim();

export const HELP_REFRESH = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] refresh [options]

  Update the local state file by checking the real-world status of all tracked
  GitHub Issues and updating their metadata (e.g., titles, descriptions).

  This command will not modify your GitHub Issues, but it will modify your
  local state file to reflect any changes made on GitHub. These state changes
  might cause new actions to occur when you generate a plan or call apply next.

${bold(`Options:`)}

  -compact-warnings   If ${TITLE_APP} produces any warnings that are not
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

export const HELP_SHOW = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] show [options] [path]

  Reads and outputs a ${TITLE_APP} state or plan file in a human-readable
  form. If no path is specified, the current state will be shown.

${bold(`Options:`)}

  -no-color           If specified, output won't contain any color.
  -json               If specified, output the ${TITLE_APP} plan or state in
                      a machine-readable form.
`.trim();

export const HELP_FMT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] fmt [options] [target...]

  Rewrites all ${TITLE_APP} scenario files to a canonical format. All
  testing files (.feature) are updated using standard Gherkin syntax
  indentation.

  By default, fmt scans the current directory for .feature files. If you
  provide a directory for the target argument, then fmt will scan that
  directory instead.

  The content must be in the Gherkin language native syntax.

${bold(`Options:`)}

  -list=false    Don't list files whose formatting differs

  -write=false   Don't write to source files

  -check         Check if the input is formatted. Exit status will be 3 if
                 any input is not properly formatted and zero otherwise.

  -no-color      If specified, output won't contain any color.

  -recursive     Also process files in subdirectories. By default, only the
                 given directory (or current directory) is processed.
`.trim();

export const HELP_FORCE_UNLOCK = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] force-unlock LOCK_ID

  Manually unlock the state for the defined configuration.

  This will not modify your infrastructure. This command removes the lock on the
  state for the current workspace. The behavior of this lock is dependent
  on the backend being used. Local state files cannot be unlocked by another
  process.

${bold(`Options:`)}

  -force                 Don't ask for input for unlock confirmation.
`.trim();

export const HELP_GRAPH = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] graph [options]

  Produces an ASCII tree representation of the dependency graph between
  different objects in the current test configuration and state.

  By default the graph shows the relationships between the hierarchical
  components in your configuration: Test Plans -> Test Runs -> Test Cases.

${bold(`Options:`)}

  -draw-cycles     Highlight the dependency links in the graph with colored
                   edges to explicitly visualize the dependency between
                   Plans, Runs, and Cases.

  -type=TYPE       (deprecated) In prior versions of Testform, specified the
                   type of operation graph to output.

  -module-depth=n  (deprecated) In prior versions of Testform, specified the
                   depth of modules to show in the output.
`.trim();

export const HELP_LOGIN = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] login [hostname]

  Retrieves an authentication token for the given hostname, if it supports
  automatic login, and saves it in a credentials file in your home directory.

  If no hostname is provided, the default hostname is github.com, to
  log in to GitHub.

  If not overridden by credentials helper settings in the CLI configuration,
  the credentials will be written to the following local file:
      ~/.testform.d/credentials.json
`.trim();

export const HELP_LOGOUT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] logout [hostname]

  Removes locally-stored credentials for specified hostname.

  Note: the API token is only removed from local storage, not destroyed on the
  remote server, so it will remain valid until manually revoked.

  If no hostname is provided, the default hostname is github.com.
`.trim();

export const HELP_STATE = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state [subcommand] [options] [args]

  This command has subcommands for advanced state management.

  These subcommands can be used to slice and dice the ${TITLE_APP} state.
  This is sometimes necessary in advanced cases. For your safety, all
  state management commands that modify the state create a timestamped
  backup of the state prior to making modifications.

${bold(`Subcommands:`)}
    identities          List the identities of resources in the state
    list                List resources in the state
    mv                  Move an item in the state
    pull                Pull current state and output to stdout
    push                Update remote state from a local state file
    rm                  Remove instances from the state
    show                Show a resource in the state
`.trim();

export const HELP_STATE_IDENTITIES = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state identities [options] -json [address...]

  List the json format of the identities of resources in the ${TITLE_APP} state.

  This command lists the identities of resource instances in the ${TITLE_APP} state in json format.
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

${bold(`Options:`)}

  -state=statefile    Path to a ${TITLE_APP} state file to use to look
                      up ${TITLE_APP}-managed resources. By default, ${TITLE_APP}
                      will consult the state of the currently-selected
                      workspace.

  -id=ID              Filters the results to include only instances whose
                      resource types have an attribute named "id" whose value
                      equals the given id string.
`.trim();

export const HELP_STATE_LIST = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state list [options] [address...]

  List resources in the ${TITLE_APP} state.

  This command lists resource instances in the ${TITLE_APP} state. The address
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

${bold(`Options:`)}

  -state=statefile    Path to a ${TITLE_APP} state file to use to look
                      up ${TITLE_APP}-managed resources. By default, ${TITLE_APP}
                      will consult the state of the currently-selected
                      workspace.

  -id=ID              Filters the results to include only instances whose
                      resource types have an attribute named "id" whose value
                      equals the given id string.
`.trim();

export const HELP_STATE_MV = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state mv [options] SOURCE DESTINATION

 This command will move an item matched by the address given to the
 destination address. This command can also move to a destination address
 in a completely different state file.

 This can be used for simple resource renaming, moving items to and from
 a module, moving entire modules, and more. And because this command can also
 move data to a completely new state, it can also be used for refactoring
 one configuration into multiple separately managed ${TITLE_APP} configurations.

 This command will output a backup copy of the state prior to saving any
 changes. The backup cannot be disabled. Due to the destructive nature
 of this command, backups are required.

 If you're moving an item to a different state file, a backup will be created
 for each state file.

${bold(`Options:`)}

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

export const HELP_STATE_PULL = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state pull [options]

  Pull the state from its location, upgrade the local copy, and output it
  to stdout.

  This command "pulls" the current state and outputs it to stdout.
  As part of this process, ${TITLE_APP} will upgrade the state format of the
  local copy to the current version.

  The primary use of this is for state stored remotely. This command
  will still work with local state but is less useful for this.
`.trim();

export const HELP_STATE_PUSH = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state push [options] PATH

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

${bold(`Options:`)}

  -force              Write the state even if lineages don't match or the
                      remote serial is higher.

  -lock=false         Don't hold a state lock during the operation. This is
                      dangerous if others might concurrently run commands
                      against the same workspace.

  -lock-timeout=0s    Duration to retry a state lock.
`.trim();

export const HELP_STATE_RM = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state rm [options] ADDRESS...

  Remove one or more items from the ${TITLE_APP} state, causing ${TITLE_APP} to
  "forget" those items without first destroying them in the remote system.

  This command removes one or more resource instances from the ${TITLE_APP} state
  based on the addresses given. You can view and list the available instances
  with "${TITLE_CLI} state list".

  If you give the address of an entire module then all of the instances in
  that module and any of its child modules will be removed from the state.

  If you give the address of a resource that has "count" or "for_each" set,
  all of the instances of that resource will be removed from the state.

${bold(`Options:`)}

  -dry-run                If set, prints out what would've been removed but
                          doesn't actually remove anything.

  -backup=PATH            Path where ${TITLE_APP} should write the backup
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

  -ignore-remote-version  Continue even if remote and local ${TITLE_APP} versions
                          are incompatible. This may result in an unusable
                          workspace, and should be used with extreme caution.
`.trim();

export const HELP_STATE_SHOW = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] state show [options] ADDRESS

  Shows the attributes of a resource in the ${TITLE_APP} state.

  This command shows the attributes of a single resource in the ${TITLE_APP}
  state. The address argument must be used to specify a single resource.
  You can view the list of available resources with "${TITLE_CLI} state list".

${bold(`Options:`)}

  -state=statefile    Path to a ${TITLE_APP} state file to use to look
                      up ${TITLE_APP}-managed resources. By default it will
                      use the state "${FILE_STATE}" if it exists.
`.trim();

export const HELP_TAINT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] taint [options] [address]

  ${TITLE_APP} uses the term "tainted" to describe a resource instance
  which may not be fully functional, either because its creation
  partially failed or because you've manually marked it as such using
  this command.

  This will not modify your infrastructure directly, but subsequent
  ${TITLE_APP} plans will include actions to destroy the remote object
  and create a new object to replace it.

  You can remove the "taint" state from a resource instance using
  the "${TITLE_CLI} untaint" command.

  The address is in the usual resource address syntax, such as:
    aws_instance.foo
    aws_instance.bar[1]
    module.foo.module.bar.aws_instance.baz

  Use your shell's quoting or escaping syntax to ensure that the
  address will reach ${TITLE_APP} correctly, without any special
  interpretation.

${bold(`Options:`)}

  -allow-missing          If specified, the command will succeed (exit code 0)
                          even if the resource is missing.

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -state, and -backup     Custom paths for the state and backup files.
`.trim();

export const HELP_UNTAINT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] untaint [options] name

  ${TITLE_APP} uses the term "tainted" to describe a resource instance
  which may not be fully functional, either because its creation
  partially failed or because you've manually marked it as such using
  the "${TITLE_CLI} taint" command.

  This command removes that state from a resource instance, causing
  ${TITLE_APP} to see it as fully-functional and not in need of
  replacement.

  This will not modify your infrastructure directly. It only avoids
  ${TITLE_APP} planning to replace a tainted instance in a future operation.

${bold(`Options:`)}

  -allow-missing          If specified, the command will succeed (exit code 0)
                          even if the resource is missing.

  -lock=false             Don't hold a state lock during the operation. This is
                          dangerous if others might concurrently run commands
                          against the same workspace.

  -lock-timeout=0s        Duration to retry a state lock.

  -state, and -backup     Custom paths for the state and backup files.
`.trim();

export const HELP_VERSION = `
${bold(`Usage:`)} ${TITLE_CLI} version [options]

  Displays the version of ${TITLE_APP}.
`.trim();

export const HELP_WORKSPACE = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] workspace

  new, list, show, select and delete ${TITLE_APP} workspaces.

${bold(`Subcommands:`)}
    delete    Delete a workspace
    list      List Workspaces
    new       Create a new workspace
    select    Select a workspace
    show      Show the name of the current workspace
`.trim();

export const HELP_DIFF = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] diff [options]

  Show drift between local configuration and state.

${bold(`Options:`)}

  -scope=scope        Limit the scope of the execution (testcase, testrun, testplan).
`.trim();

export const HELP_REPORT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] report <type> [options]

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

${bold(`Options:`)}

  -format=format      Output format.
                      Default is "md" (Markdown).
                      Available formats: md, csv, json.

  -out=path           Path to save the generated report.
                      Default is stdout.

  -filter=key=val     Filter data by any state attribute. Can be
                      specified multiple times.

  -groupBy=field      Group results dynamically by a specific field
                      using JSONPath (e.g. attributes.custom_fields.sprint).
                      Default is "testcase" (testcase-summary) or "testrun" (testrun-summary).
                      Other values: "testplan", "feature".

  -apply              Create a GitHub Issue for the report.

  -var=key=val        Set a custom field value to attach when -apply is used.
                      Use this option more than once to set more than one variable.

  -var-file=filename  Load custom field values from the given file (.json or key=value format)
                      to attach when -apply is used.
`.trim();

export const HELP_TEST = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] test <subcommand> [options]

  Manage test files locally. Groups operations for creating and updating
  testrun and testplan feature files without interacting with GitHub.

  These subcommands do NOT interact with GitHub. They operate on local files
  and testform.state only.

${bold(`Subcommands:`)}
  add           Create a new testrun or testplan feature file
  autocomplete  Expand empty Rule blocks in a testrun file from its source
                .case.feature (testrun only)
  state         Update a testcase execution status within a testrun

${bold(`Target Resolution (-target flag):`)}
  All subcommands accept three forms to identify a testrun/testplan:
    Full path:    tests/testrun/20260607_013738_ef7c0c.run.feature
    Relative:     20260607_013738_ef7c0c.run.feature  (or fragment)
    Identity:     @tr-2  (resolved from testform.state)

  If a fragment matches more than one file, an error lists all ambiguous
  matches so you can be more specific.
`.trim();

export const HELP_TEST_FEATURE = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] test feature [options]

  Create a new testrun or testplan feature file based on your naming
  convention defined in testform.json.

  This subcommand does NOT apply to testcase scope.
  It automatically resolves the output directory and applies the naming
  convention (including timestamp, hash, and slug) defined in your config.

${bold(`Options:`)}

  -scope=scope        Required. Must be 'testrun' or 'testplan'.

  -title=title        An optional title for the feature file. If not provided,
                      a default name based on the timestamp is generated.

  -rule=rule          Include a Rule block (Rule: <rule>) in the generated file.
                      The command verifies that a feature file for this rule
                      exists in the workspace.
                      Can be specified multiple times.
`.trim();

export const HELP_TEST_AUTOCOMPLETE = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] test autocomplete -target=<resource>

  [testrun only] Reads each Rule block in the target testrun feature file,
  finds the referenced .case.feature on disk, and expands its scenarios into
  the testrun file with 'link status = pending'.

  Files are matched by @testrun tag OR the .run.feature extension.

  Rules that already have explicit Scenario blocks are left unchanged —
  manual control is always preserved.

${bold(`Options:`)}

  -target=resource    Required. Identifies the testrun file. Accepts:
                        Full path:  tests/testrun/20260607_ef7c0c.run.feature
                        Relative:   20260607_ef7c0c.run.feature  (or fragment)
                        Identity:   @tr-2  (resolved from testform.state)

  -test-directory=dir Optional. Limits the search scope for .case.feature files.
`.trim();

export const HELP_TEST_STATE = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] test state "featureFile@tc-N=status" -target=<resource>

  [testrun only] Update the execution status of a specific testcase within
  a testrun. Simultaneously updates:
    - The GitHub comment for that testcase
    - The issue body checklist
    - The local testrun feature file

  The testcase argument must include the source feature file to avoid
  ambiguity when multiple Rules share the same @tc-N numbering.

${bold(`Available statuses:`)} passed, failed, pending, skipped, blocked, wip

${bold(`Options:`)}

  -target=resource    Required. Identifies the testrun file. Accepts:
                        Full path:  tests/testrun/20260607_ef7c0c.run.feature
                        Relative:   20260607_ef7c0c.run.feature  (or fragment)
                        Identity:   @tr-2  (resolved from testform.state)

${bold(`Argument:`)} "featureFile@tc-N=status"

  The featureFile can be a filename, a relative path, or a full identity.
  Use the full path when multiple Rules share the same @tc-N numbers.

${bold(`Examples:`)}

  ${TITLE_CLI} test state "cuenta/inicio-sesion.feature@tc-1=passed" -target="@tr-2"
  ${TITLE_CLI} test state "github_testcase.agencia/cuenta.feature::@tc-3=failed" -target="20260607.run.feature"
`.trim();

export const HELP_PRINT = `
${bold(`Usage:`)} ${TITLE_CLI} [global options] print [options]

  Parse a specific feature file and print its JSON Abstract Syntax Tree (AST).
  This command is designed for developers to debug Gherkin feature parsing and Testform's
  filtering behavior.

${bold(`Options:`)}

  -scope=scope        Limit the scope of the execution (testcase, testrun, testplan).

  -file=path          The filename or partial filename to parse and output.
                      If not provided, all parsed scenarios in the current
                      scope will be printed.

  -format=format      Choose between 'gherkin' (raw Gherkin AST) or 'testform' 
                      (filtered and enriched by Testform). Default is 'testform'.

  -var=key=val        Set a value for one of the input variables in the root
                      module of the configuration. Use this option more than
                      once to set more than one variable.

  -var-file=filename  Load variable values from the given file (.json or key=value format).
                      Use this option more than once to include more than one
                      variables file.
`.trim();

export function getCommandHelp(command: string): string | null {
  switch (command) {
    case 'init': return HELP_INIT;
    case 'validate': return HELP_VALIDATE;
    case 'plan': return HELP_PLAN;
    case 'apply': return HELP_APPLY;
    case 'destroy': return HELP_DESTROY;
    case 'import': return HELP_IMPORT;
    case 'refresh': return HELP_REFRESH;
    case 'diff': return HELP_DIFF;
    case 'show': return HELP_SHOW;
    case 'fmt': return HELP_FMT;
    case 'force-unlock': return HELP_FORCE_UNLOCK;
    case 'login': return HELP_LOGIN;
    case 'workspace': return HELP_WORKSPACE;
    case 'report': return HELP_REPORT;
    case 'print': return HELP_PRINT;
    case 'logout': return HELP_LOGOUT;
    case 'state': return HELP_STATE;
    case 'state identities': return HELP_STATE_IDENTITIES;
    case 'state list': return HELP_STATE_LIST;
    case 'state mv': return HELP_STATE_MV;
    case 'state pull': return HELP_STATE_PULL;
    case 'state push': return HELP_STATE_PUSH;
    case 'state rm': return HELP_STATE_RM;
    case 'state show': return HELP_STATE_SHOW;
    case 'taint': return HELP_TAINT;
    case 'untaint': return HELP_UNTAINT;
    case 'version': return HELP_VERSION;
    case 'tool': return HELP_TEST;
    case 'tool feature': return HELP_TEST_FEATURE;
    case 'tool autocomplete': return HELP_TEST_AUTOCOMPLETE;
    case 'tool state': return HELP_TEST_STATE;
    default: return null;
  }
}