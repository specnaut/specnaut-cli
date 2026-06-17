# Cursor — tool reference

Specnaut skills are authored using **Claude Code tool names**. This file
maps each Claude Code tool to its Cursor Agent equivalent.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/using-superpowers/references/`. Re-implemented for
> Specnaut.

## Tool mapping

| Claude Code | Cursor Agent | Notes |
|---|---|---|
| `Read` | `read_file` | Cursor's read tool returns the file with line numbers. |
| `Write` | `edit_file` (full overwrite) | Cursor uses one `edit_file` tool for both create and edit; pass the full new content. |
| `Edit` | `edit_file` (partial) | Same tool, pass a precise edit specification. |
| `Bash` | `run_terminal_cmd` | Same shape; pass `command` + `is_background`. |
| `Skill` | `Skill` | Cursor's Agent plugin format exposes a native `Skill` tool with the same shape as Claude Code. |
| `Task` | `Task` via Agent plugin | Cursor supports subagent dispatch when the plugin declares `agents` in its manifest. |
| `TodoWrite` | `todo_write` | Cursor's todo tool, semantically equivalent. |
| `WebSearch` | `web_search` | Same. |
| `WebFetch` | `web_search` + manual read | Cursor doesn't expose a separate URL-fetch tool; use `web_search` then `read_file` on the result if it's local. |
| `Grep` / `Glob` | `grep_search` / `file_search` | Cursor exposes both natively with similar arguments. |

## Idiom differences worth noting

- **`edit_file` is unified.** Cursor doesn't distinguish `Write` (create
  new) from `Edit` (modify existing); the same tool does both based on
  whether the path exists. Skill authors should still write "create" or
  "modify" in prose for clarity to other harnesses.
- **Hooks live in `hooks-cursor.json`**, not `hooks.json`. Cursor uses
  `snake_case` field names (`session_start`, `pre_tool_use`) where
  Claude Code uses `camelCase` (`SessionStart`, `PreToolUse`). The
  Specnaut Cursor adapter handles the translation; skill content stays
  uniform.
- **Plugin manifest** uses `.cursor-plugin/plugin.json` with keys
  `{skills, agents, commands, hooks}` (see issue #278 for the adapter).

## Subagent dispatch — concrete pattern

A skill that reads `Use Task to dispatch a code reviewer subagent` works
on Cursor identically to Claude Code, **provided the plugin's
`.cursor-plugin/plugin.json` declares `agents: "./agents/"`**. Without
that declaration, Cursor's Agent doesn't see the subagent definitions
and the dispatch falls back to inline execution.

## Auto-activation

Cursor honors the same `description:` frontmatter contract as Claude
Code — when the user's prompt matches phrases in a skill's `description:`
field, Cursor invokes the skill automatically. The `SessionStart` hook
(via `hooks-cursor.json`) injects the `using-specnaut` bootstrap skill
to make Specnaut skill-aware on every turn.
