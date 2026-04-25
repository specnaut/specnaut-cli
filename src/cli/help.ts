import { bold, cyan, dim } from "@std/fmt/colors";

export const HELP = `${
  bold("specflow")
} — improved spec-kit CLI with auto-chain, review, and backlog

${bold("Usage:")}
  specflow init <project-name>        Bootstrap a new project in ./<project-name>
  specflow init --here                Bootstrap in the current directory
  specflow self-update [--check]      Update the specflow binary
  specflow backlog sync [--id NNN] [--dry-run] [--allow-secrets]
                                     Sync tasks/backlog/ to GitHub Issues + Project V2
  specflow backlog configure         Interactive setup of .specflow/config.yml
  specflow check [--project]         Diagnose the environment (and optionally the project)
  specflow upgrade [--dry-run] [--force]
                                     Update project templates to the binary's version
  specflow --version                  Print version
  specflow --help                     Show this help

${bold("Flags (for init):")}
  --here         Scaffold into the current directory instead of creating a new one
  --no-git       Skip "git init" detection and prompt
  --ai <name>    Target AI harness: claude (default) | cursor

${bold("Docs:")}  ${cyan("https://github.com/mkrlabs/specflow")}`;

export function renderVersionLine(
  version: string,
  templatesVersion: string,
): string {
  return `specflow ${version} ${dim(`(templates ${templatesVersion})`)}`;
}
