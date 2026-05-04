import { bold, cyan, dim } from "@std/fmt/colors";

export const HELP = `${
  bold("specflow")
} — AI project scaffolding CLI with auto-chain, review, and backlog

${bold("Usage:")}
  specflow init <project-name>        Bootstrap a new project in ./<project-name>
  specflow init --here                Bootstrap in the current directory
  specflow self-update [--check]      Update the specflow binary
  specflow check [--project]          Diagnose the environment (and optionally the project)
  specflow upgrade [--dry-run] [--force]
                                      Update project templates to the binary's version
  specflow --version, -v              Print version
  specflow --help, -h                 Show this help

${bold("Flags (for init):")}
  --here         Scaffold into the current directory instead of creating a new one
  --no-git       Skip "git init" detection and prompt
  --ai <name>    Target AI harness: claude (default) | cursor | codex | gemini | windsurf | copilot | opencode | antigravity

${bold("Docs:")}    ${cyan("https://specflow.makerlabs.dev")}
${bold("Source:")}  ${cyan("https://github.com/mkrlabs/specflow")}`;

export function renderVersionLine(
  version: string,
  templatesVersion: string,
): string {
  return `specflow ${version} ${dim(`(templates ${templatesVersion})`)}`;
}
