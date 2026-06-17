# Codex CLI / Codex App — tool reference

Specnaut skills are authored using **Claude Code tool names**. This file
maps every Claude Code tool to its Codex equivalent so a skill that says
`Use Task to dispatch a subagent` reads correctly when Specnaut runs
inside Codex.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/using-superpowers/references/codex-tools.md`.
> Re-implemented for Specnaut.

## Tool mapping

| Claude Code | Codex | Notes |
|---|---|---|
| `Read` | `read_file` | Same argument shape (`path`). |
| `Write` | `write_file` | Same shape; pass `content`. |
| `Edit` | `apply_patch` | Codex uses a unified-diff style patch tool; the Edit semantic (old_string → new_string) maps to a one-hunk patch. |
| `Bash` | `shell` | Same shape; Codex's `shell` runs in the workspace cwd. |
| `Skill` | `skill` | Codex exposes a native `skill` tool — pass the skill name and args. |
| `Task` | `spawn_agent` / `wait_agent` / `close_agent` | Three-step protocol: spawn, wait for completion, close. Wrap in a helper if you dispatch frequently. |
| `TodoWrite` | `update_plan` | Codex's planner exposes a structured update API; pass the full updated plan, not deltas. |
| `WebSearch` | `web.search` | Available only if the user has enabled web tools. |
| `WebFetch` | `web.fetch` | Same. |
| `Grep` | `shell` invoking `grep` / `rg` | No native grep tool — shell out. |
| `Glob` | `shell` invoking `find` / `fd` | No native glob tool — shell out. |

## Subagent dispatch — concrete pattern

A skill that reads `Use Task to dispatch a code reviewer subagent` should,
on Codex, expand to:

```
id = spawn_agent(agent_type="code-reviewer", prompt="<full prompt>")
result = wait_agent(id, timeout=900)
close_agent(id)
```

If the wait times out, decide whether to retry or to surface the partial
result to the user.

## Idiom differences worth noting

- **Plan updates** are heavyweight on Codex — `update_plan` rewrites the
  full plan each call. Don't call it per-step; call it at task boundaries.
- **`apply_patch`** rejects malformed patches more strictly than Claude
  Code's `Edit`. Always confirm a Read of the target file before patching.
- **Subagent timeout** defaults vary; pass `timeout=` explicitly for any
  dispatch you expect to take > 5 minutes.

## Manifest pointer

For the Codex marketplace adapter (`.codex-plugin/plugin.json`), the
canonical install entry is:

```
/plugins  → search "specnaut" → install
```

(Once Specnaut ships to the Codex marketplace; see issue #277.)
