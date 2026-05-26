# Migrating from `obra/superpowers` to Specflow

A practical guide for engineers currently using
[`obra/superpowers`](https://github.com/obra/superpowers) (v5.1.0, MIT) who want to switch to
Specflow. Read this if you've been getting value from superpowers' writing-plans / subagent-driven /
requesting-code-review pattern but want tighter integration with a backlog, a constitution, a
spec-kit pipeline, and a multi-harness plugin distribution that ships the binary AND the plugin from
a single source.

## TL;DR

| You used                                     | Use this Specflow skill instead             | Notes                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `superpowers:brainstorming`                  | `brainstorming`                             | Same one-question-at-a-time discipline, same hand-off to writing-plans. Specflow version coexists with `/specflow specify` for greenfield spec-kit work.                                                            |
| `superpowers:writing-plans`                  | `writing-plans`                             | Same zero-placeholder + TDD-bite-size discipline. Saves to `docs/specflow/plans/` (not `docs/superpowers/plans/`). Hands off to `subagent-driven-development` or `executing-plans`.                                 |
| `superpowers:subagent-driven-development`    | `subagent-driven-development`               | Same two-stage review loop (spec compliance, then code quality). Dispatches Specflow's bundled `developer` + `code-reviewer` agents instead of generic `general-purpose` — agents already know project conventions. |
| `superpowers:executing-plans`                | `executing-plans`                           | Same inline-with-checkpoints semantics. Adds Specflow's pre-commit gate awareness (deno fmt/lint/bundle/check).                                                                                                     |
| `superpowers:requesting-code-review`         | `requesting-code-review`                    | Same Strengths / Critical / Important / Minor / Assessment template, inlined in the SKILL.md (no separate `code-reviewer.md` file — Specflow already bundles a `code-reviewer` agent).                              |
| `superpowers:verification-before-completion` | `verification-before-completion`            | Same forcing-function checklist before claiming DONE, with Specflow-specific gates (deno task test, plugin sync, Windsurf cap, smoke audit).                                                                        |
| `superpowers:using-superpowers`              | `using-specflow`                            | Bootstrap skill auto-loaded at SessionStart on every supported harness. Same "1% threshold for skill check" discipline, adapted to Specflow's skill + agent registry.                                               |
| `superpowers:using-git-worktrees`            | (not bundled)                               | Specflow doesn't ship an opinionated worktree skill. Use the upstream pattern manually if you prefer it.                                                                                                            |
| `superpowers:test-driven-development`        | (built into other skills)                   | TDD is mandated by `writing-plans` (every code step starts with a failing test) and the `developer` agent doctrine. No separate skill.                                                                              |
| `superpowers:systematic-debugging`           | (not yet bundled)                           | Future Specflow skill (no open issue yet — open one if you want it).                                                                                                                                                |
| `superpowers:finishing-a-development-branch` | (covered by `developer` agent + `/release`) | The developer agent owns PR + merge flow; `/release` owns tagging + publishing. No standalone skill.                                                                                                                |

## Why switch

The discipline is the same. The integration is what changes.

- **Backlog awareness** — Specflow ships a `backlog` skill + `product-owner` agent +
  GitHub/GitLab/local backends. Every plan can ref-link the GitHub issue, every PR auto-closes the
  linked issue, every grooming pass goes through the PO. Superpowers is harness-only; it doesn't
  know about your backlog.

- **Constitution gates** — `.specflow/memory/constitution.md` records project-specific principles
  (TDD discipline, hexagonal layers, error handling conventions). Skills + agents honour the
  constitution. Superpowers' equivalent is the upstream `CLAUDE.md` — same content type, different
  location and lifecycle.

- **Spec-kit pipeline** —
  `/specflow specify → clarify → plan → tasks →
  analyze → implement → review → merge` for
  greenfield features with formal contracts (research.md, data-model.md, contracts/, quickstart.md).
  Coexists with the `writing-plans` skill for issue-driven work. Superpowers doesn't have an
  equivalent ceremony.

- **Multi-harness plugin distribution** — same source tree ships to Claude Code, Codex, Cursor,
  OpenCode, Copilot CLI. Each harness has the right adapter manifest + SessionStart hook.
  Superpowers ships the same harness coverage; Specflow adds it on top of the `specflow init` binary
  scaffold so users get both options.

- **Native binary** — `specflow init` writes the files directly into a project (`.claude/`,
  `.specflow/`, `AGENTS.md`, etc.). No reliance on Python or Node toolchains. Superpowers requires
  the plugin to be installed via the harness's plugin loader.

## Step-by-step migration

### 0. Decide your distribution path

Two ways to install Specflow's skills:

- **Plugin** (recommended for cross-project usage): install via your harness's plugin loader (see
  `docs/llms.md` install matrix). The skill content stays in user scope; every project gets it
  automatically.
- **Binary scaffold** (recommended for per-project customization): run `specflow init` inside a
  project. Files land in `.claude/skills/`, `.specflow/`, `AGENTS.md`. You can edit them in place;
  `specflow upgrade` detects edits and preserves them.

Most teams use both: plugin for the always-there skill library, binary for the project-local backlog
(`.specflow/`), hooks, and constitution.

### 1. Install Specflow

Pick your harness from the install matrix in
[`docs/llms.md`](./llms.md#install-as-a-plugin--extension-five-harnesses). For Claude Code (most
common):

```
/plugin install mkrlabs/specflow-plugin
```

This installs the Specflow plugin at user scope. The SessionStart hook loads `using-specflow` at
every session start so the agent knows the skill + agent registry.

### 2. (Optional) Uninstall `obra/superpowers`

You don't have to remove superpowers — Specflow's skills are namespaced under `specflow:<skill>`
whereas superpowers uses `superpowers:<skill>`, so they coexist without slash-command collision. But
if you want a clean break:

```
/plugin uninstall superpowers
```

Skill files from `docs/superpowers/plans/` in your project remain on disk — they're plain markdown,
useful as historical reference. Consider moving them to `docs/specflow/plans/` for consistency with
the new save path, OR leave them where they are and let Specflow start fresh.

### 3. Run the bootstrap

In a new agent session (after the plugin install), the SessionStart hook fires and loads
`using-specflow`. You don't need to do anything — but to sanity-check the skill registry is loaded,
ask:

> "What Specflow skills do you have available?"

The agent should list `specflow` (router), `writing-plans`, `requesting-code-review`,
`subagent-driven-development`, `executing-plans`, `verification-before-completion`, `brainstorming`,
`backlog`, plus the agent registry (developer, code-reviewer, product-owner, etc.).

### 4. Map your existing plans

If you have plans under `docs/superpowers/plans/` from prior superpowers sessions, they're still
readable. Two options:

- **Leave them** — `subagent-driven-development` and `executing-plans` both accept any markdown file
  as input. The plan format is similar enough that the only thing that won't auto-resolve is the
  `superpowers:` skill references in the plan header.
- **Move + retarget** — `git mv docs/superpowers/plans/ docs/specflow/plans/` and sed-replace
  `superpowers:` → `specflow:` in the file headers. Now the plans are first-class Specflow plans.

### 5. Adopt the backlog (optional but recommended)

This is what superpowers doesn't have. Run `specflow init --here` in a project to scaffold the
`.specflow/` directory with the local Markdown backlog backend (or `--backlog github` /
`--backlog gitlab` if your issues live on a remote tracker). Then dispatch the `product-owner` agent
when you want to add or groom backlog items:

```
@product-owner add an item to track the OAuth integration
@product-owner groom the backlog
```

Migration of historical issues from a different tracker (Trello, Linear, etc.) is out of scope for
this guide — see the `product-owner` agent's doctrine in `templates/core/agents/product-owner.md`
for the canonical backlog patterns.

### 6. Adopt the constitution (optional but recommended)

`specflow init` scaffolds a starter `.specflow/memory/constitution.md` with four opinionated
baseline blocks (engineering methodology, architecture layers, back-end patterns, front-end
patterns). Edit to match your team's actual conventions. The `developer` agent reads the
constitution before implementing anything; the `code-reviewer` agent references it during reviews.
This is the "tribal knowledge → durable contract" move.

## Skill-by-skill notes

### `writing-plans`

- Save path: `docs/specflow/plans/YYYY-MM-DD-<feature>.md` (vs. `docs/superpowers/plans/` upstream)
- Same zero-placeholder discipline
- Same TDD-style bite-size task granularity (2–5 min/step)
- Hands off to either `subagent-driven-development` (recommended for 3+ task plans) or
  `executing-plans` (for trivial plans)
- Coexists with `/specflow plan` — the spec-kit pipeline phase for greenfield features. Different
  inputs (spec.md vs. issue URL), different outputs (multi-file artefact set vs. single executable
  plan).

### `subagent-driven-development`

- Dispatches Specflow's bundled `developer` agent as the implementer (vs. generic `general-purpose`
  upstream). The developer agent already knows the project conventions (hexagonal, TDD, in-code
  documentation, Windsurf cap, byte-identity plugin sync, smoke audit).
- Dispatches `code-reviewer` for both spec-compliance and code-quality stages, with different
  prompts.
- Status code handling identical (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).
- Model selection guidance identical (haiku for mechanical, standard for integration, most capable
  for architecture).

### `requesting-code-review`

- Single-file SKILL.md (no separate `code-reviewer.md` template — Specflow inlines the prompt
  template). Same Strengths / Critical / Important / Minor / Recommendations / Assessment format.
- Dispatches the bundled `code-reviewer` agent (vs. generic `general-purpose` upstream).
- Two-stage review pattern documented inline (spec compliance first, code quality second) for
  `subagent-driven-development` integration.

### `verification-before-completion`

- 8-item checklist tied to Specflow's actual quality contract:
  1. `deno task test` (passed count not "I think it's green")
  2. Pre-commit gates (fmt --check, lint, bundle, check)
  3. `git status --porcelain` clean
  4. Plan checkboxes all ticked
  5. `audit.sh` clean (when touching `templates/core/skills/`)
  6. `plugin_sync_test` green (when touching mirrored files)
  7. Windsurf 12000-char cap (when touching SKILL.md / agent prompts)
  8. Per-AC requirement coverage by file:line
- Report shape includes verification evidence inline (`Verification: …`).

### `using-specflow`

- Skill registry table covers Specflow's bundled skills (writing-plans, requesting-code-review,
  etc.)
- Agent registry table covers the 11 sub-agents (developer, code-reviewer, product-owner,
  devops-sre, etc.) with explicit invocation rules ("every backlog mutation → product-owner", "every
  release/pipeline change → devops-sre advisory first")
- Harness detection points at the 6 per-harness tool-mapping references
  (`references/<harness>-tools.md`)
- SessionStart hook auto-injection mechanism documented per harness

## Attribution

Specflow's `writing-plans`, `subagent-driven-development`, `requesting-code-review`,
`executing-plans`, `verification-before-completion`, `brainstorming`, and `using-specflow` skills
are **inspired by** the equivalent skills in
[`obra/superpowers` v5.1.0](https://github.com/obra/superpowers) (MIT), authored by Jesse Vincent.
Specflow re-implemented each skill with explicit integration to Specflow's bundled agents, backlog,
constitution, and multi-harness distribution. The discipline is the same; the integration is what
differs.

License: each derived SKILL.md cites the upstream MIT license in its footer. `docs/llms.md` carries
the project-level acknowledgement.

## Open questions / future work

- Workflow skills not yet bundled in Specflow: `systematic-debugging`, `using-git-worktrees`,
  `dispatching-parallel-agents`. Open an issue if you want one of these ported.
- Specflow ships a `devops-sre` agent (advisory mode for CI / release / distribution changes) that
  has no upstream equivalent — useful for Specflow's release pipeline; less universally applicable.
- Specflow ships a `product-owner` agent (sole owner of backlog mutations) — also no upstream
  equivalent.

## Get help

- Specflow docs: <https://specflow.makerlabs.dev>
- Issues + discussions: <https://github.com/mkrlabs/specflow>
- The original superpowers: <https://github.com/obra/superpowers>
