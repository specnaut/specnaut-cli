# Claude Code — baseline tool reference

Specflow skills are authored using **Claude Code tool names** as the lingua
franca. This file documents the canonical Claude Code tool set that other
harness adapters (`codex-tools.md`, `cursor-tools.md`,
`opencode-tools.md`, `copilot-tools.md`) translate.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/using-superpowers/references/`. Re-implemented for
> Specflow's harness coverage.

## Canonical tool set

| Tool | Purpose |
|---|---|
| `Read` | Read a file from disk; supports image / PDF / notebook formats. |
| `Write` | Write or overwrite a file from scratch. |
| `Edit` | Exact-string replace in a file (must Read first). |
| `Bash` | Run a shell command in the project working directory. |
| `Skill` | Invoke another skill by name (`Skill({skill: "<name>", args: "…"})`). |
| `Task` | Dispatch a subagent for a delegated task (`Task({subagent_type: "general-purpose", description: "…", prompt: "…"})`). |
| `TodoWrite` | Persist a checklist for multi-step work. |
| `WebSearch` | Search the web for current information. |
| `WebFetch` | Fetch a URL and process it with a prompt. |
| `Grep` / `Glob` | Search file contents or file paths. |

## Conventions used by Specflow skills

- **File paths** are always absolute, except inside markdown documentation
  where project-relative paths read better.
- **Subagents** spawned via `Task` receive precisely the context they need —
  never the controller's full history. See the
  [`subagent-driven-development`](../../subagent-driven-development/SKILL.md)
  skill for the dispatch pattern.
- **Skills** invoked via `Skill` are listed in the harness-provided
  "available skills" registry; only use names that appear there.
- **Slash commands** the user types (`/specflow plan`, `/backlog …`) are
  resolved by the harness to a skill invocation — Specflow itself never
  registers raw commands outside the skill layer.

## When this file is the wrong reference

You are on Claude Code only. If you are running in:
- Codex CLI / App → see `codex-tools.md`
- Cursor → see `cursor-tools.md`
- OpenCode → see `opencode-tools.md`
- GitHub Copilot CLI → see `copilot-tools.md`

The `using-specflow` bootstrap skill auto-detects the running harness and
loads the right reference at session start.
