import { bold, cyan, dim } from "@std/fmt/colors";

export const HELP = `${
  bold("specflow")
} — AI project scaffolding CLI with auto-chained workflow, review, and backlog

${bold("Usage:")}
  specflow init <project-name>        Bootstrap a new project in ./<project-name>
  specflow init --here                Bootstrap in the current directory
  specflow self-update [--check]      Update the specflow binary
  specflow check [--project]          Diagnose the environment (and optionally the project)
  specflow upgrade [--dry-run] [--force] [--backlog <name>] [--reset-baseline]
                                      Update project templates to the binary's version
  specflow reconcile --status         List files pending post-upgrade reconciliation
  specflow reconcile <path> --accept-upstream | --accept-current
                                      Resolve a preserved file after upgrade
  specflow cloud login [--api-url <url>]
                                      Authenticate with Specflow Cloud (browser device flow) and link a project
  specflow cloud logout [--api-url <url>]
                                      Remove stored Specflow Cloud credentials
  specflow --version, -v              Print version
  specflow --help, -h                 Show this help

${bold("Flags (for init):")}
  --here              Scaffold into the current directory instead of creating a new one
  --no-git            Skip "git init" detection and prompt
  --ai <name>         Target AI harness: claude (default) | cursor | codex | windsurf | copilot | opencode | antigravity
  --backlog <name>    Backlog backend: local (default) | github | gitlab | cloud
                      (cloud: run "specflow cloud login" after init to authenticate + link a project)
  --backlog-url <url> Kanban / project URL (e.g. https://github.com/orgs/<org>/projects/<N>)
                      Required for github/gitlab in non-interactive mode; pre-fills .specflow/backlog-config.yml
  --backlog-repo <r>  GitHub repo override <owner>/<name>; falls back to "git remote get-url origin"
  --scheme <name>     Versioning scheme for the release scripts: semver | date
                      Auto-detected from library markers (package.json exports, pyproject.toml,
                      Cargo.toml [lib], composer.json type=library), semver-shaped git tags
                      (v1.2.3), or a CHANGELOG.md with Keep-a-Changelog headers. Falls back to
                      "date" when no signal is found.
  --force             Overwrite locally-customized files (existing content backed up to *.specflow.bak)
  --dry-run           Show the plan without writing — trumps --force

${bold("Flags (for upgrade):")}
  --dry-run           Show the plan without writing
  --force             Overwrite locally-customized files (existing content backed up to *.specflow.bak)
  --backlog <name>    Switch the backlog backend (local | github | gitlab). Re-renders the backlog skill;
                      existing data in the previous backend is NOT migrated.
  --reset-baseline    Trust the on-disk content as the new SHA baseline. Use when files are flagged
                      "customized locally" but you never edited them (heals stale lock SHAs). Combine
                      with --dry-run to preview what would change.

${bold("Docs:")}    ${cyan("https://specflow.makerlabs.dev")}
${bold("Cloud:")}   ${cyan("https://specflow.makerlabs.app")} ${
  dim("— run headless, answer your agent from your phone")
}
${bold("Source:")}  ${cyan("https://github.com/mkrlabs/specflow")}`;

export function renderVersionLine(
  version: string,
  templatesVersion: string,
): string {
  return `specflow ${version} ${dim(`(templates ${templatesVersion})`)}`;
}

export function printReconcileHelp(): void {
  console.log(`specflow reconcile — post-upgrade reconciliation

USAGE:
specflow reconcile --status
   Print a JSON object listing files pending reconciliation.

specflow reconcile <path> --accept-upstream
   Take the new template version. Backs up the local file to
   <path>.specflow.bak, copies upstream content into place, and
   updates .specflow/installed.lock.

specflow reconcile <path> --accept-current
   Keep the local customized version. Re-stamps the lock SHA to
   match on-disk content (the next upgrade will not re-flag the file
   as preserved).

EXAMPLES:
specflow reconcile --status
specflow reconcile .claude/agents/developer.md --accept-upstream
specflow reconcile .claude/agents/developer.md --accept-current
`);
}
