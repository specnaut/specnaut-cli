# specflow-plugin — Claude Code plugin for Specflow

This is the Claude Code plugin distribution of [Specflow](https://specflow.makerlabs.dev). It ships
the same slash-commands, sub-agents, and the auto-chain skill that the `specflow` binary scaffolds
into projects — just as a user-scope plugin instead.

## What's in here

| Path                                                                                                                                        | Contents                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `.claude-plugin/plugin.json`                                                                                                                | Plugin manifest (`specflow-plugin`, v0.0.1 alpha)                 |
| `skills/auto-chain/SKILL.md`                                                                                                                | Auto-chain skill — `/specflow-plugin:auto-chain`                  |
| `skills/{specify,plan,tasks,implement,analyze,review,merge,constitution,checklist,clarify}/SKILL.md`                                        | The 10 Specflow slash-commands — `/specflow-plugin:specify`, etc. |
| `agents/{code-reviewer,developer,devops-sre,product-owner,qa-tester,review-coordinator,security-auditor,test-reviewer,workflow-manager}.md` | 9 sub-agents available to invoke in plugin scope                  |
| `skills/groom/SKILL.md`                                                                                                                     | Groom skill — `/specflow-plugin:groom`                            |

**Coming in subsequent slices** (tracked in
[issue #73](https://github.com/mkrlabs/specflow/issues/73)):

- `PluginDetector` port + the v0.x → plugin migration logic in `specflow upgrade`.

### Known caveat: handoff IDs

The 10 command SKILL.md files include `handoffs:` frontmatter that references peer commands by their
**binary-scaffolded** IDs (`specflow.plan`, `specflow.clarify`, …). In plugin scope those IDs are
`specflow-plugin:plan` etc., so the clickable handoff buttons may not resolve. For the full handoff
UX today, use the binary-scaffolded copies (run `specflow init`) — the plugin versions are the
discoverability layer, not the polished workflow. Handoff rewriting is a known follow-up task on
#73.

## How this differs from `specflow init`

- The plugin is **user-scope** and **versioned** — installed once, available across all your
  projects, updates via `/plugin update`.
- The binary's `specflow init` scaffolds **project-scope** copies — you can customize them
  per-project, and they ship with shorter slash-command names (e.g. `/specify` instead of
  `/specflow-plugin:specify`).
- Backlog skill, hooks, and `.specflow/` files stay binary-owned because they read project-state at
  runtime.

See [the design doc](../docs/superpowers/specs/2026-05-08-claude-plugin-design.md) for the full
plugin / binary boundary and the v0.x → plugin migration logic.

## Install (when ready)

```bash
/plugin install mkrlabs/specflow-plugin
```

(The plugin is currently `0.0.1` — pre-release. Wait for v0.1.0 before relying on it in production.)

## Local development

To test changes to the plugin without publishing:

```bash
claude --plugin-dir /path/to/specflow/plugin
```

Then invoke any plugin skill: `/specflow-plugin:auto-chain specify "…"`.

## Versioning

The plugin is on `0.0.1` and will move to lockstep with the `specflow` binary once the migration
logic (slices 4–6 in #73) lands. Until then, treat it as alpha — bumps may be breaking.
