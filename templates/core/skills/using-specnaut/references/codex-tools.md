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

## Always name the role — never dispatch by task description alone

`agent_type=` is not decoration. Codex resolves a spawned child's model in
three steps, and stops at the first that answers:

1. the **explicit spawn value** — what `agent_type=` selects;
2. the **`[agents]` default** in `.codex/config.toml`;
3. **the parent session's value.**

A child spawned by describing the task, with no `agent_type=`, selects no
role. Step 1 is empty, so it falls through — and before Specnaut wrote step 2,
step 3 was the only link left. Every such child silently ran on your primary
model, and raising your primary model raised all of them with it, which is how
a long orchestration escalates onto the most expensive model on your account
with nothing to report it.

Specnaut now scaffolds `.codex/config.toml` with `[agents]` defaults, so step 2
answers and the floor is bounded. That is a safety net, not the fix: naming the
role is what gets the work the model it was tiered for. Each bundled role pins
its own `model` and `model_reasoning_effort` in `.codex/agents/<name>.toml`.

**Role selection versus task naming.** `agent_type=` chooses *who* runs the
work — a configured seat with a model, a reasoning budget and a prompt.
`prompt=` describes *what* the work is. Putting the role name in the prompt
does not select the role; only `agent_type=` does.

**Context does not come with it.** A spawned child does not inherit the parent
conversation. Everything it needs — file paths, the task, the acceptance
criteria — has to be in `prompt=`. What it *can* inherit, when unspecified, is
the model, which is exactly the inheritance this section is about.

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
