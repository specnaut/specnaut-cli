import { bold, cyan, dim } from "@std/fmt/colors";

export const HELP = `${
  bold("specnaut")
} — AI project scaffolding CLI with auto-chained workflow, review, and backlog

${bold("Usage:")}
  specnaut init <project-name>        Bootstrap a new project in ./<project-name>
  specnaut init --here                Bootstrap in the current directory
  specnaut self-update [--check]      Update the specnaut binary
  specnaut check [--project]          Diagnose the environment (and optionally the project)
  specnaut upgrade [--dry-run] [--force] [--backlog <name>] [--reset-baseline]
                                      Update project templates to the binary's version
  specnaut diff [<path>] [--only-customised]
                                      Show how managed files diverge from the bundled originals (read-only).
                                      With <path>, scope to that one managed file.
  specnaut scan [--path <dir>] [--format text|json|mermaid] [--top <n|all>]
                                      Map file, function and class sizes against the size limits
                                      (read-only, offline, no agent): where to look, not a verdict
  specnaut verify-scripts             Check .specnaut/scripts/ against a copy the branch does not carry,
                                      and the config a branch controls against the base, before resume,
                                      groom, the backlog verbs, audit, review or merge run them
                                      (read-only). Exit 0 trusted, 1 untrusted, 3 no base
  specnaut record-checkout            Record the checkout a session started on (HEAD and the instruction and
                                      config files it loaded), from a SessionStart hook's input on stdin
  specnaut review gate                Check, from a Claude Code PreToolUse hook's input on stdin, that the
                                      session's checkout may start a review of a branch it cannot trust.
                                      Exit 0 let through, 2 refused
  specnaut review guard               Judge, from a Claude Code PreToolUse hook's input on stdin, a tool
                                      call of a session under the review lock: only Read, Grep, Glob,
                                      TodoWrite, the review seats and the review's commands run. Exit 0, 2 refused
  specnaut review start <pr|remote/branch>
                                      Once the gate let it through: lock the session until it ends, export
                                      the branch as inert files outside the project, and print where
                                      (HEAD, SEATS, SCRATCH, OBJECTS, LOGS)
  specnaut review trust <pr> <sha>    Print trusted, or untrusted and why, for reviewing PR <pr> at commit
                                      <sha>, from the forge's facts alone: a team member's PR, its head in
                                      this repository and at <sha>. Exit 0 trusted, 1 untrusted
  specnaut review end <sha>           Remove the export of <sha>
  specnaut sandbox probe              Report which sandbox would run a branch's gates, and why each other
                                      one cannot (read-only). Exit 0 one is available, 1 none: static only
  specnaut sandbox exec <sha> [--toolchain <dir>[:<dir>...]] [--log <file>] -- <command> [<arg>...]
                                      Run <command> on the exported tree of commit <sha> in that sandbox:
                                      the tree read-only, no network, no home, the --toolchain folders
                                      read-only and on its PATH. --log: its output to that new file,
                                      controls dropped, capped. Exit: the command's; 124 out of time;
                                      125 not run
  specnaut reconcile --status         List files pending post-upgrade reconciliation
  specnaut reconcile <path> --accept-upstream | --accept-current
                                      Resolve a preserved file after upgrade
  specnaut spec pull <task>           Materialise a task's cloud-hosted spec into .specnaut/specs/.cache/<task>/
  specnaut spec push <task>           Upsert local spec content for <task> to Specnaut Cloud (cloud backend)
  specnaut login [--api-url <url>]    Authenticate with Specnaut Cloud (alias for "cloud login")
  specnaut cloud login [--api-url <url>]
                                      Authenticate with Specnaut Cloud (browser device flow) and link a project
  specnaut cloud logout [--api-url <url>]
                                      Remove stored Specnaut Cloud credentials
  specnaut cloud orgs [--api-url <url>]
                                      List the organizations your account belongs to
  specnaut cloud board [--api-url <url>]
                                      Show the linked project's board (tasks grouped by column)
  specnaut cloud token [--api-url <url>]
                                      Print a fresh access token on stdout (for scripts)
  specnaut --version, -v              Print version
  specnaut --help, -h                 Show this help

${bold("Flags (for init):")}
  --here              Scaffold into the current directory instead of creating a new one
  --no-git            Skip "git init" detection and prompt
  --ai <name>         Target AI harness: claude (default) | cursor | codex | copilot | opencode | antigravity
  --backlog <name>    Backlog backend: cloud (default) | local | github | gitlab
                      (non-interactive runs take the default, and cloud needs
                       "specnaut cloud login" before the backlog works)
  --backlog-url <url> Kanban / project URL (e.g. https://github.com/orgs/<org>/projects/<N>)
                      Required for github/gitlab in non-interactive mode; pre-fills .specnaut/backlog-config.yml
  --backlog-repo <r>  GitHub repo override <owner>/<name>; falls back to "git remote get-url origin"
  --scheme <name>     Versioning scheme for the release scripts: semver | date
                      Auto-detected from library markers (package.json exports, pyproject.toml,
                      Cargo.toml [lib], composer.json type=library), semver-shaped git tags
                      (v1.2.3), or a CHANGELOG.md with Keep-a-Changelog headers. Falls back to
                      "date" when no signal is found.
  --spec-backend <n>  Where specs are stored: cloud (default, recommended) | local
                      (cloud: hosted specs via Specnaut Cloud — run "specnaut cloud login" after init;
                       local: markdown files in .specnaut/specs/, unchanged from before)
  --force             Overwrite locally-customized files (existing content backed up to *.specnaut.bak)
  --reset-preserved   Ignore .specnaut/preserve.yml for this run so declared files are refreshed too
                      (never the default; reported per overridden file)
  --dry-run           Show the plan without writing — trumps --force

${bold("Flags (for upgrade):")}
  --dry-run           Show the plan without writing
  --force             Overwrite locally-customized files (existing content backed up to *.specnaut.bak)
  --backlog <name>    Switch the backlog backend (local | github | gitlab). Re-renders the backlog skill;
                      existing data in the previous backend is NOT migrated.
  --reset-baseline    Take upstream for every file listed under "customized, and behind" — the ones
                      an update was published for and never reached. Files merely customized are
                      left alone; each overwrite keeps a *.specnaut.bak. Per-file: specnaut
                      reconcile <path> --accept-upstream. Add --dry-run to preview what would change.
  --reset-preserved   Ignore .specnaut/preserve.yml for this run so declared files follow normal
                      upgrade rules (never the default; reported per overridden file).

${bold("Flags (for diff):")}
  <path>              Optional project-relative path of ONE managed file (e.g.
                      .specnaut/scripts/backlog/_config.sh). Scopes the view to it, which is what a
                      preserve.yml maintenance walk needs. A path the lock does not track is an
                      error, not a silent fall-back to the whole-project view.
  --only-customised   Restrict the output to files whose on-disk content diverges from the recorded
                      lock baseline — i.e. files you actually customized (skips unchanged managed files).

${bold("Flags (for scan):")}
  --path <dir>        Scan one subtree, relative to the repository root; matching nothing exits 2
  --format <name>     text (default) | json | mermaid
  --top <n|all>       How long each list is (default 20); the totals always count every file.
                      Exit 0: no file over its ceiling; 1: a file over its ceiling; 3: could not run.
                      Function and class sizes are estimated and never change the exit code.

${bold("Docs:")}    ${cyan("https://specnaut.com")}
${bold("Cloud:")}   ${cyan("https://specnaut.com")} ${
  dim("— run headless, answer your agent from your phone")
}
${bold("Source:")}  ${cyan("https://github.com/specnaut/specnaut-cli")}`;

export function renderVersionLine(
  version: string,
  templatesVersion: string,
): string {
  return `specnaut ${version} ${dim(`(templates ${templatesVersion})`)}`;
}

export function printReconcileHelp(): void {
  console.log(`specnaut reconcile — post-upgrade reconciliation

USAGE:
specnaut reconcile --status
   Print a JSON object listing files pending reconciliation. Every
   path listed resolves with one of the two forms below; a staged copy
   left by an older upgrade is not listed, and the next
   \`specnaut upgrade\` deletes it.

specnaut reconcile <path> --accept-upstream
   Take the new template version. Backs up the local file to
   <path>.specnaut.bak, copies upstream content into place, and
   updates .specnaut/installed.lock.

specnaut reconcile <path> --accept-current
   Keep the local customized version. Re-stamps the lock SHA to
   match on-disk content (the next upgrade will not re-flag the file
   as preserved).

EXAMPLES:
specnaut reconcile --status
specnaut reconcile .claude/agents/developer.md --accept-upstream
specnaut reconcile .claude/agents/developer.md --accept-current
`);
}
