# specnaut-plugin — Claude Code plugin for Specnaut

This is the Claude Code plugin distribution of [Specnaut](https://specnaut.com). It ships the same
slash-commands and sub-agents that the `specnaut` binary scaffolds into projects — just as a
user-scope plugin instead. `/specnaut specify "<feature>"` auto-chains the full workflow by default;
pass `--manual` to opt out.

## What's in here

| Path                                                                                                                                        | Contents                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`                                                                                                                | Plugin manifest (`specnaut-plugin`, lockstep with the binary version) |
| `skills/{specify,plan,tasks,implement,analyze,review,merge,constitution,checklist,clarify}/SKILL.md`                                        | The 10 Specnaut slash-commands — `/specnaut-plugin:specify`, etc.     |
| `agents/{code-reviewer,developer,devops-sre,product-owner,qa-tester,review-coordinator,security-auditor,test-reviewer,workflow-manager}.md` | 9 sub-agents available to invoke in plugin scope                      |
| `skills/groom/SKILL.md`                                                                                                                     | Groom skill — `/specnaut-plugin:groom`                                |

The full plugin migration shipped in v0.12.x (issue
[#73](https://github.com/specnaut/specnaut-cli/issues/73)). When the plugin is installed and the
project harness is `claude`, `specnaut upgrade` auto-migrates vanilla on-disk agents to the plugin
(backs them up, then removes them — the plugin serves them going forward).
`specnaut check
--project` warns about any plugin-covered files that are missing when the plugin is
uninstalled.

### Known caveat: handoff IDs

The 10 command SKILL.md files include `handoffs:` frontmatter that references peer commands by their
**binary-scaffolded** IDs (`specnaut-plan`, `specnaut-clarify`, …). In plugin scope those IDs are
`specnaut-plugin:plan` etc., so the clickable handoff buttons may not resolve. For the full handoff
UX today, use the binary-scaffolded copies (run `specnaut init`) — the plugin versions are the
discoverability layer, not the polished workflow. Handoff rewriting is a known follow-up task on
#73.

## How this differs from `specnaut init`

- The plugin is **user-scope** and **versioned** — installed once, available across all your
  projects, updates via `/plugin update`.
- The binary's `specnaut init` scaffolds **project-scope** copies — you can customize them
  per-project, and they ship with shorter slash-command names (e.g. `/specify` instead of
  `/specnaut-plugin:specify`).
- Backlog skill, hooks, and `.specnaut/` files stay binary-owned because they read project-state at
  runtime.

## Install

```bash
/plugin install specnaut/specnaut-cli-plugin
```

## Local development

To test changes to the plugin without publishing:

```bash
claude --plugin-dir /path/to/specnaut/plugin
```

Then invoke any plugin skill: `/specnaut-plugin:specnaut specify "…"`.

## Versioning

The plugin's `version` field in `.claude-plugin/plugin.json` is kept in lockstep with the `specnaut`
binary by `scripts/bump-version.ts`, which is run as part of every `/release`. The release pipeline
(`.github/workflows/release.yml`) hard-fails on any drift between the two.
