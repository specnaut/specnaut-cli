# Gemini CLI — tool reference

Specflow skills are authored using **Claude Code tool names**. This file
maps each Claude Code tool to its Gemini CLI equivalent.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/using-superpowers/references/gemini-tools.md`.
> Re-implemented for Specflow.

## Tool mapping

| Claude Code | Gemini CLI | Notes |
|---|---|---|
| `Read` | `read_file` | Same argument shape. |
| `Write` | `write_file` | Same. |
| `Edit` | `replace` | Gemini's edit tool is named `replace`; pass `file_path`, `old_string`, `new_string`. |
| `Bash` | `run_shell_command` | Same shape; pass `command`. |
| `Skill` | `activate_skill` | Gemini's skill-invocation tool. |
| `Task` | `@generalist` subagent | Gemini uses `@`-mention syntax for subagent dispatch. The `@generalist` agent is the catch-all equivalent of Claude Code's `general-purpose`. |
| `TodoWrite` | `save_memory` for persistence; `todo` for in-session checklists | Gemini's persistent state model is split into ephemeral todos and durable memory. Pick the right one for context. |
| `WebSearch` | `google_web_search` | Native — same shape. |
| `WebFetch` | `web_fetch` | Same. |
| `Grep` | `search_file_content` | Native grep equivalent. |
| `Glob` | `glob` | Native. |

## Subagent dispatch — concrete pattern

A skill that reads `Use Task to dispatch a code reviewer subagent` should,
on Gemini, expand to:

```
@generalist Please review the following code change against the plan:
[paste full prompt content]
```

The `@`-mention triggers a fresh subagent context; pass the entire prompt
as the message body. Wait for the subagent's response in the same chat
stream — there is no separate `wait_agent` call.

## Extension manifest

Gemini CLI consumes plugins as **extensions**, not as Claude-style
plugins. The Specflow extension manifest (see issue #279) lives at the
repo root:

```json
{
  "name": "specflow",
  "description": "...",
  "version": "1.x.x",
  "contextFileName": "GEMINI.md"
}
```

The `contextFileName` points at a `GEMINI.md` file that Gemini loads at
session start (parallel to `CLAUDE.md` for Claude Code). The
`using-specflow` bootstrap skill references this file from inside Gemini.

## Idiom differences worth noting

- **No persistent plan tool.** Gemini lacks a direct `TodoWrite`
  equivalent for ephemeral plans; skill prose should describe the plan
  in markdown and let the LLM maintain it in context, or use
  `save_memory` for plans that must survive a session boundary.
- **Subagents share the chat.** Unlike Claude Code's isolated `Task`
  context, `@generalist` runs in the same conversation thread. Be
  explicit about what context the subagent should attend to.
- **Install command**: `gemini extensions install https://github.com/mkrlabs/specflow`
  (once the extension manifest ships — issue #279).
