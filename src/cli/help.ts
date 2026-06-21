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
  specnaut diff [--only-customised]   Show how managed files diverge from the bundled originals (read-only)
  specnaut reconcile --status         List files pending post-upgrade reconciliation
  specnaut reconcile <path> --accept-upstream | --accept-current
                                      Resolve a preserved file after upgrade
  specnaut login [--api-url <url>]    Authenticate with Specnaut Cloud (alias for "cloud login")
  specnaut cloud login [--api-url <url>]
                                      Authenticate with Specnaut Cloud (browser device flow) and link a project
  specnaut cloud logout [--api-url <url>]
                                      Remove stored Specnaut Cloud credentials
  specnaut cloud orgs [--api-url <url>]
                                      List the organizations your account belongs to
  specnaut cloud board [--api-url <url>]
                                      Show the linked project's board (tasks grouped by column)
  specnaut --version, -v              Print version
  specnaut --help, -h                 Show this help

${bold("Flags (for init):")}
  --here              Scaffold into the current directory instead of creating a new one
  --no-git            Skip "git init" detection and prompt
  --ai <name>         Target AI harness: claude (default) | cursor | codex | windsurf | copilot | opencode | antigravity
  --backlog <name>    Backlog backend: local (default) | github | gitlab | cloud
                      (cloud: run "specnaut cloud login" after init to authenticate + link a project)
  --backlog-url <url> Kanban / project URL (e.g. https://github.com/orgs/<org>/projects/<N>)
                      Required for github/gitlab in non-interactive mode; pre-fills .specnaut/backlog-config.yml
  --backlog-repo <r>  GitHub repo override <owner>/<name>; falls back to "git remote get-url origin"
  --scheme <name>     Versioning scheme for the release scripts: semver | date
                      Auto-detected from library markers (package.json exports, pyproject.toml,
                      Cargo.toml [lib], composer.json type=library), semver-shaped git tags
                      (v1.2.3), or a CHANGELOG.md with Keep-a-Changelog headers. Falls back to
                      "date" when no signal is found.
  --force             Overwrite locally-customized files (existing content backed up to *.specnaut.bak)
  --reset-preserved   Ignore .specnaut/preserve.yml for this run so declared files are refreshed too
                      (never the default; reported per overridden file)
  --dry-run           Show the plan without writing — trumps --force

${bold("Flags (for upgrade):")}
  --dry-run           Show the plan without writing
  --force             Overwrite locally-customized files (existing content backed up to *.specnaut.bak)
  --backlog <name>    Switch the backlog backend (local | github | gitlab). Re-renders the backlog skill;
                      existing data in the previous backend is NOT migrated.
  --reset-baseline    Trust the on-disk content as the new SHA baseline. Use when files are flagged
                      "customized locally" but you never edited them (heals stale lock SHAs). Combine
                      with --dry-run to preview what would change.
  --reset-preserved   Ignore .specnaut/preserve.yml for this run so declared files follow normal
                      upgrade rules (never the default; reported per overridden file).

${bold("Flags (for diff):")}
  --only-customised   Restrict the output to files whose on-disk content diverges from the recorded
                      lock baseline — i.e. files you actually customized (skips unchanged managed files).

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
   Print a JSON object listing files pending reconciliation.

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
