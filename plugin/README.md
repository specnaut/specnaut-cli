# claude-specflow — Claude Code plugin for Specflow

This is the Claude Code plugin distribution of [Specflow](https://specflow.makerlabs.dev). It ships
the same slash-commands, sub-agents, and the auto-chain skill that the `specflow` binary scaffolds
into projects — just as a user-scope plugin instead.

## What's in here

| Path                         | Contents                                             |
| ---------------------------- | ---------------------------------------------------- |
| `.claude-plugin/plugin.json` | Plugin manifest                                      |
| `skills/auto-chain/SKILL.md` | The auto-chain skill (`/claude-specflow:auto-chain`) |

**Coming in subsequent slices** (tracked in
[issue #73](https://github.com/mkrlabs/specflow/issues/73)):

- `skills/specify/`, `skills/plan/`, `skills/tasks/`, etc. — the 10 specflow.* slash-commands,
  namespaced under the plugin (`/claude-specflow:specify`).
- `agents/` — the 9 sub-agent definitions (architect, product-owner, qa-tester, devops-sre, …).
- `skills/specflow.groom/` — the groom skill.

## How this differs from `specflow init`

- The plugin is **user-scope** and **versioned** — installed once, available across all your
  projects, updates via `/plugin update`.
- The binary's `specflow init` scaffolds **project-scope** copies — you can customize them
  per-project, and they ship with shorter slash-command names (e.g. `/specify` instead of
  `/claude-specflow:specify`).
- Backlog skill, hooks, and `.specflow/` files stay binary-owned because they read project-state at
  runtime.

See [the design doc](../docs/superpowers/specs/2026-05-08-claude-plugin-design.md) for the full
plugin / binary boundary and the v0.x → plugin migration logic.

## Install (when ready)

```bash
/plugin install mkrlabs/claude-specflow
```

(The plugin is currently `0.0.1` — pre-release. Wait for v0.1.0 before relying on it in production.)

## Local development

To test changes to the plugin without publishing:

```bash
claude --plugin-dir /path/to/specflow/plugin
```

Then invoke any plugin skill: `/claude-specflow:auto-chain specify "…"`.

## Versioning

The plugin is on `0.0.1` and will move to lockstep with the `specflow` binary once the migration
logic (slices 4–6 in #73) lands. Until then, treat it as alpha — bumps may be breaking.
