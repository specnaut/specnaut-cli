# specflow-plugin — Claude Code plugin for Specflow

This is the Claude Code plugin distribution of [Specflow](https://specflow.makerlabs.dev). It ships
the same slash-commands and sub-agents that the `specflow` binary scaffolds into projects — just as
a user-scope plugin instead. `/specflow specify "<feature>"` auto-chains the full workflow by
default; pass `--manual` to opt out.

## What's in here

| Path                                                                                                                                        | Contents                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`                                                                                                                | Plugin manifest (`specflow-plugin`, lockstep with the binary version)         |
| `skills/specflow-auto/SKILL.md`                                                                                                             | Deprecated alias (removed in next major) — kept one release for muscle memory |
| `skills/{specify,plan,tasks,implement,analyze,review,merge,constitution,checklist,clarify}/SKILL.md`                                        | The 10 Specflow slash-commands — `/specflow-plugin:specify`, etc.             |
| `agents/{code-reviewer,developer,devops-sre,product-owner,qa-tester,review-coordinator,security-auditor,test-reviewer,workflow-manager}.md` | 9 sub-agents available to invoke in plugin scope                              |
| `skills/groom/SKILL.md`                                                                                                                     | Groom skill — `/specflow-plugin:groom`                                        |

The full plugin migration shipped in v0.12.x (issue
[#73](https://github.com/mkrlabs/specflow/issues/73)). When the plugin is installed and the project
harness is `claude`, `specflow upgrade` auto-migrates vanilla on-disk agents to the plugin (backs
them up, then removes them — the plugin serves them going forward). `specflow check
--project` warns
about any plugin-covered files that are missing when the plugin is uninstalled.

### Known caveat: handoff IDs

The 10 command SKILL.md files include `handoffs:` frontmatter that references peer commands by their
**binary-scaffolded** IDs (`specflow-plan`, `specflow-clarify`, …). In plugin scope those IDs are
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

## Install

```bash
/plugin install mkrlabs/specflow-plugin
```

## Local development

To test changes to the plugin without publishing:

```bash
claude --plugin-dir /path/to/specflow/plugin
```

Then invoke any plugin skill: `/specflow-plugin:specflow specify "…"`.

## Versioning

The plugin's `version` field in `.claude-plugin/plugin.json` is kept in lockstep with the `specflow`
binary by `scripts/bump-version.ts`, which is run as part of every `/release`. The release pipeline
(`.github/workflows/release.yml`) hard-fails on any drift between the two.
