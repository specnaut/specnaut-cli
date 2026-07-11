# GitHub Copilot CLI — tool reference

Specnaut skills are authored using **Claude Code tool names**. This file
maps each Claude Code tool to its GitHub Copilot CLI equivalent.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/using-superpowers/references/copilot-tools.md`.
> Re-implemented for Specnaut.

## Tool mapping

| Claude Code | Copilot CLI | Notes |
|---|---|---|
| `Read` | `read` | Same shape. |
| `Write` | `write` | Same. |
| `Edit` | `edit` | Same. |
| `Bash` | `bash` | Same. |
| `Skill` | `skill` | Native — invokes a registered plugin skill. |
| `Task` | `task` with `agent_type` parameter | Copilot's task tool takes `agent_type` to select a subagent (similar to Claude Code's `subagent_type`). |
| `TodoWrite` | `sql` with built-in `todos` table | Copilot exposes a SQLite-backed durable state via the `sql` tool; the `todos` table is its checklist primitive. |
| `WebSearch` | `web_search` | Same. |
| `WebFetch` | `web_fetch` | Same. |
| `Grep` | `grep` | Same. |
| `Glob` | `glob` | Same. |

## Plugin marketplace

Copilot CLI distributes plugins through a **marketplace repository** — a
separate GitHub repo registered with `copilot plugin marketplace add`.
The Specnaut marketplace (see issue #281) lives at
`specnaut/specnaut-cli-marketplace` (planned) and registers Specnaut as
`specnaut@specnaut-marketplace`.

Install flow for end users:

```bash
copilot plugin marketplace add specnaut/specnaut-cli-marketplace
copilot plugin install specnaut@specnaut-marketplace
```

## Subagent dispatch — concrete pattern

A skill that reads `Use Task to dispatch a code reviewer subagent` should,
on Copilot CLI, expand to:

```
task({
  agent_type: "code-reviewer",
  description: "Review changes against the plan",
  prompt: "<full prompt>"
})
```

The agent runs in an isolated context and returns when complete. The
calling skill gets the subagent's final report as the tool's return
value.

## Idiom differences worth noting

- **`sql` for state.** Copilot's `TodoWrite` equivalent is a structured
  database insert/update. Skill prose that says "track this in a TODO
  list" needs the adapter to translate to a `sql` insert into the
  `todos` table. The `using-specnaut` bootstrap skill explains the
  schema.
- **No `WebFetch` slug.** Copilot uses `web_fetch` (snake_case) where
  Claude Code uses `WebFetch` (PascalCase). The mapping is the only
  difference — the semantics are identical.
- **SessionStart hook.** Copilot's hook system uses
  `{"additionalContext": "..."}` as the injection format (SDK standard).
  The Specnaut Copilot SessionStart hook (see #282) reads the
  `using-specnaut` bootstrap skill and emits this shape at session
  boot.

## Auto-activation

Copilot honors the same `description:` frontmatter contract as Claude
Code and Cursor — when the user's prompt matches phrases in a skill's
`description:` field, Copilot invokes the skill. The SessionStart hook
(once #282 lands) ensures `using-specnaut` is loaded so the agent knows
which Specnaut skill to pick for which user phrasing.
