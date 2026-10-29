# specnaut-plugin — Claude Code plugin for Specnaut

This is the Claude Code plugin distribution of [Specnaut](https://specnaut.com). It ships the same
slash-commands and sub-agents that the `specnaut` binary scaffolds into projects — just as a
user-scope plugin instead. `/task plan "<feature>"` auto-chains the full workflow by default; pass
`--manual` to opt out.

## What's in here

| Path                                       | Contents                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`               | Plugin manifest (`specnaut-plugin`, lockstep with the binary version)                                                                                |
| `skills/task/SKILL.md`, `skills/task/*.md` | The `/task` router and its backlog docs — one unit of work, from backlog item to merged branch.                                                      |
| `skills/task/phases/*.md`                  | The documents `/task` loads on demand — `plan`, `tasks`, `implement`, `review`, `merge`, `audit`, `constitution`, plus the contract docs they share. |
| `skills/specnaut/`, `skills/ship/`         | `/specnaut` (`doc`, `list`, `upgrade`) and `/ship` (`tag`, `release`).                                                                               |
| `agents/*.md`                              | The sub-agents, available to invoke in plugin scope                                                                                                  |

The full plugin migration shipped in v0.12.x (issue
[#73](https://github.com/specnaut/specnaut-cli/issues/73)). When the plugin is installed and the
project harness is `claude`, `specnaut upgrade` auto-migrates vanilla on-disk agents to the plugin
(backs them up, then removes them — the plugin serves them going forward).
`specnaut check
--project` warns about any plugin-covered files that are missing when the plugin is
uninstalled.

## How this differs from `specnaut init`

- The plugin is **user-scope** and **versioned** — installed once, available across all your
  projects, updates via `/plugin update`.
- The binary's `specnaut init` scaffolds **project-scope** copies — you can customize them
  per-project, and they ship with shorter slash-command names (e.g. `/task plan` instead of
  `/specnaut-plugin:task plan`).
- The backlog scripts, hooks, and `.specnaut/` files stay binary-owned because they read project
  state at runtime and resolve paths from their installed location. The `/task` skill's documents —
  `groom` included — are served from plugin scope like any other skill; the scripts they drive are
  the project's own `.specnaut/scripts/`.

## Install

```bash
/plugin marketplace add specnaut/specnaut-marketplace
/plugin install specnaut-plugin@specnaut-marketplace
```

## Local development

To test changes to the plugin without publishing:

```bash
claude --plugin-dir /path/to/specnaut/plugin
```

Then invoke any plugin skill: `/specnaut-plugin:task plan "…"`.

## Versioning

The plugin's `version` field in `.claude-plugin/plugin.json` is kept in lockstep with the `specnaut`
binary by `scripts/bump-version.ts`, which is run as part of every release. The release pipeline
(`.github/workflows/release.yml`) hard-fails on any drift between the two.
