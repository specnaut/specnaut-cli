# Specflow router-skill consolidation — design

## Summary

Consolidate the 11 bundled slash-command skills (`specflow-specify`, `specflow-plan`,
`specflow-tasks`, `specflow-analyze`, `specflow-implement`, `specflow-review`, `specflow-merge`,
`specflow-constitution`, `specflow-checklist`, `specflow-clarify`, `specflow-groom`) plus the
`auto-chain` utility into a single `.claude/skills/specflow/SKILL.md` router skill. `/specflow` with
no args shows a workflow overview; `/specflow specify "feature"` routes to the specify phase. The 10
phase markdowns become supporting reference files inside the same skill directory, loaded on demand.

---

## Q1 — Auto-invocation precision

**The problem.** Claude Code uses the `description` field to decide when to auto-invoke a skill.
Today each skill's description is tightly scoped (e.g. "Create or update the feature specification
from a natural language feature description"). With one router, a single description must cover 11
different trigger phrases — and the platform hard-truncates the combined `description` +
`when_to_use` text at 1,536 characters per skill. Dilution is real and will degrade discovery.

**Platform mechanics (from the live docs).** Two fields contribute to the discovery signal:

- `description` — primary field, always shown to Claude.
- `when_to_use` — appended to `description` in the skill listing; counts toward the same 1,536-char
  cap. Useful for trigger phrases / example requests.

**Recommendation: use `when_to_use` with per-phase trigger phrases, plus
`disable-model-invocation:
true` on the router itself.**

Rationale: the current phase skills already have `disable-model-invocation: true` — no phase skill
auto-triggers today. The router should preserve this contract. The only auto-triggerable surface
that exists today is `specflow-review` (no `disable-model-invocation` flag in its frontmatter, so
Claude _can_ auto-invoke it). The router should set `disable-model-invocation: true` globally and
rely on explicit invocation `/specflow <phase>` or on `specflow-review`'s behavior being maintained
via the existing `specflow-review` skill (see Q7 below for the alias approach).

If Kevin wants auto-invocation for the review phase specifically, the cleanest path is a thin alias
skill (see Q7) rather than trying to encode partial `disable-model-invocation` behaviour in the
router.

**Budget math.** At 1,536 chars, a tight `when_to_use` listing all phase trigger phrases is
feasible:

```
specify: "spec out a feature", "write a spec", "create a specification"
plan: "plan a feature", "build a technical plan"
clarify: "clarify requirements", "fill in gaps in the spec"
tasks: "generate tasks", "break down the plan"
analyze: "check consistency", "analyze artifacts"
implement: "implement the feature", "start coding"
review: "review the implementation", "run quality gates"
merge: "merge the branch", "ship the feature"
constitution: "update the constitution", "edit project rules"
checklist: "generate a checklist"
groom: "groom the backlog", "run a hygiene pass"
auto-chain: "do the whole workflow", "run everything end to end"
```

That comes in at ~450 chars, well within budget.

---

## Q2 — `handoffs:` for self-loops

**The platform constraint.** The `handoffs:` frontmatter field takes an `agent:` value that is a
skill name. With 11 separate skills, `agent: specflow-plan` names a distinct skill. With one router
skill named `specflow`, a handoff would need `agent: specflow` plus an argument
(`prompt: plan ...`).

**Does Claude Code support self-loop handoffs?** The docs describe `handoffs:` as clickable buttons
that re-invoke a named skill with a prompt. There is no documented restriction on the target being
the same skill as the caller — the `agent:` field is just a skill lookup. A handoff
`agent: specflow` with `prompt: plan {feature}` would invoke `/specflow plan {feature}`, which is a
valid self-loop.

**Recommendation: option (a) — self-invoke with new args.**

```yaml
handoffs:
  - label: Build Technical Plan
    agent: specflow
    prompt: plan {feature}
    send: true
  - label: Clarify Spec Requirements
    agent: specflow
    prompt: clarify
    send: true
```

The router's body parses `$ARGUMENTS` to extract the sub-command (`$0`) and the remainder (`$1`
onward), then loads the relevant phase reference doc and executes its instructions. The handoff
buttons become "click to go to next phase" exactly as today, just routed through the same skill.

**Caveat.** If the platform's handoff machinery resolves `agent:` against a static skills registry
at build time (rather than at click time), a self-loop might fail or create recursion the platform
doesn't support. This is not documented one way or the other. The safe fallback is option (b):
remove `handoffs:` entirely and embed next-phase suggestions as plain text at the end of each phase
body ("To continue: `/specflow plan`"). Option (b) loses clickability but is guaranteed to work.

**Verdict: implement option (a) first; fall back to option (b) if self-loops fail in testing.**

---

## Q3 — Plugin namespace

**Current state.** Plugin slash-commands are namespaced: `/specflow-plugin:specify`,
`/specflow-plugin:plan`, etc. This works because the plugin ships 11 separate skill folders
(`skills/specflow-specify/SKILL.md`, `skills/specflow-plan/SKILL.md`, …).

**After consolidation.** The plugin would ship a single `skills/specflow/SKILL.md` folder. The
resulting slash-command would be `/specflow-plugin:specflow`. Users would type
`/specflow-plugin:specflow specify "feature"`.

The double-prefix (`specflow-plugin:specflow`) is awkward but accurate — the plugin name is
`specflow-plugin`, the skill name is `specflow`. This is the correct model because the plugin and
the project-local skill coexist: project-local is `/specflow`, plugin is
`/specflow-plugin:specflow`. The symmetry is clean even if the plugin invocation is verbose.

**Alternative: name the plugin differently.** If the plugin were renamed `sf` or `specflow` (not
`specflow-plugin`), the namespaced command would be `/specflow:specflow` (still awkward) or
`/sf:specflow` (cleaner but requires renaming the plugin, which is a separate release concern).

**Recommendation: keep the plugin name `specflow-plugin` and accept the double-prefix for plugin
invocation.** The plugin audience is primarily people who haven't done `specflow init` yet (they
rely on the plugin for discoverability). For established projects, the project-local `/specflow` is
the primary UX. Double-prefix matters less for the plugin audience.

**Impact on `src/domain/plugin_coverage.ts`.** The `PLUGIN_COVERED_PATHS_CLAUDE` list and
`isPluginCoveredPath` regex currently enumerate 10 `specflow-<phase>` paths plus `auto-chain` and
`specflow-groom`. After consolidation, the coverage list shrinks to a single entry:
`.claude/skills/specflow/SKILL.md`. The regex pattern changes from
`/^\.claude\/skills\/specflow-[a-z]+\/SKILL\.md$/` to an exact match on
`.claude/skills/specflow/SKILL.md`.

---

## Q4 — Auto-chain skill

**Current state.** `auto-chain` is a separate skill in `.claude/skills/auto-chain/SKILL.md`. It
references phase skills by name (`/specflow-specify`, `/specflow-plan`, etc.) in its instructions.

**After consolidation**, phase names change: the instructions should reference `/specflow specify`,
`/specflow plan`, etc.

**Two options:**

A. Keep `auto-chain` as a separate skill, update its body to reference `/specflow <phase>`. This
preserves the user-facing `/auto-chain` command, which some users may have bookmarked or scripted.

B. Fold `auto-chain` into the router as `/specflow auto-chain specify "feature"` (or
`/specflow chain "feature"` for brevity). Drop the separate skill folder.

**Recommendation: option A.** `auto-chain` has a distinct identity ("run the whole pipeline") that
is clearer as a dedicated slash-command than as a nested sub-command of the router. The body update
is trivial — replace all `specflow-<phase>` references with `specflow <phase>`. The skill stays in
`.claude/skills/auto-chain/SKILL.md` with its own `SKILL.md` file unchanged in structure.

This also keeps the migration simpler: `auto-chain` is not part of the consolidation migration (no
folder rename, just a body update on upgrade).

---

## Q5 — Reference docs layout

**Three candidates:**

| Option | Layout                                      | Trade-offs                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | `.claude/skills/specflow/phases/<phase>.md` | Native skill support: the platform allows supporting files in the skill dir. Router loads them on demand (`See phases/specify.md`). Files are project-local, so users can customize per-phase instructions. Recommended by the docs ("move reference material to separate files"). |
| B      | `.specflow/skill-phases/<phase>.md`         | Files live in the `.specflow/` project tree. Semantically correct (Specflow-owned). But the skill's `SKILL.md` would need to reference a path outside its own directory, which the platform doesn't explicitly support for progressive disclosure.                                 |
| C      | Single `SKILL.md` with section headers      | Simplest. No file system overhead. But a single SKILL.md with 10 full phase bodies easily exceeds the 500-line guideline and pays the token cost on every invocation, not just when that phase runs.                                                                               |

**Recommendation: option A — `.claude/skills/specflow/phases/<phase>.md`.**

The platform docs are explicit: "move reference material to separate files" and "reference these
files from your SKILL.md so Claude knows what they contain and when to load them." On-demand loading
is the right economics — the router body says "Read `phases/specify.md` for specify instructions"
and Claude loads it only when needed. Files remain project-local and user-customizable, which
preserves the current pattern (users can edit individual phase files today by editing the skill
body).

File layout after consolidation:

```
.claude/skills/specflow/
├── SKILL.md                  # router: arg parsing, phase dispatch, overview
└── phases/
    ├── specify.md            # full specify instructions (was specflow-specify content)
    ├── clarify.md
    ├── plan.md
    ├── tasks.md
    ├── analyze.md
    ├── implement.md
    ├── review.md
    ├── merge.md
    ├── constitution.md
    └── checklist.md
```

`specflow-groom` instructions move to `phases/groom.md`. The router SKILL.md stays under 200 lines
(routing logic + phase index with one-line descriptions + "see phases/<phase>.md" pointers).

---

## Q6 — Migration from v0.14 to consolidated

**What must happen:**

1. Remove 11 old skill folders: `.claude/skills/specflow-specify/`, `specflow-plan/`,
   `specflow-tasks/`, `specflow-analyze/`, `specflow-implement/`, `specflow-review/`,
   `specflow-merge/`, `specflow-constitution/`, `specflow-checklist/`, `specflow-clarify/`,
   `specflow-groom/`

2. Create the new consolidated folder: `.claude/skills/specflow/SKILL.md` +
   `.claude/skills/specflow/phases/*.md`

3. Update `auto-chain/SKILL.md` in place (body update only, no folder rename).

4. Rewrite lock entries: drop the 11 `specflow-*` paths + `specflow-groom` path; add
   `specflow/SKILL.md` + `specflow/phases/*.md` paths.

**Implementation pattern.** Follow `migrateLegacyDottedSkillFolders` in
`/Users/kevin/Sites/specflow/src/cli/handlers/upgrade_handler.ts` (lines 81–132). Add a new exported
function `migrateSpecflowRouterSkill(projectDir: string)` using the same structure:

- Detect presence of any `specflow-specify/SKILL.md` (the sentinel for v0.14 layout).
- If present: rename/collapse to `specflow/` tree, write phase files, update lock atomically.
- Return list of moves for the upgrade summary.
- Idempotent: if `.claude/skills/specflow/SKILL.md` already exists, skip and return empty moves.

**Safe-when-customized.** A user who edited `specflow-specify/SKILL.md` should not lose their
changes. Detection: SHA of on-disk file vs lock SHA. If customized, copy the customized body into
`phases/specify.md` rather than overwriting with the bundle snapshot. Log a warning:
"specflow-specify was customized — preserved in specflow/phases/specify.md, review for conflicts."
This is the same `preserve` action already implemented in the upgrade plan for
`pluginAvailable:
true` customized files.

---

## Q7 — Per-phase auto-invocation override

**Can we restore per-phase auto-invocation without 11 skill folders?**

Option A: `when_to_use` phrase patterns (described in Q1). Covers all phases in one field, no extra
files. The model must parse "I want to specify a feature" → route to `/specflow specify`. This works
for explicit matches but is less precise than a dedicated per-phase description. Dilution risk is
moderate.

Option B: Thin alias skills — one hidden `SKILL.md` per phase in separate folders with
`user-invocable: false` (hidden from the `/` menu) and without `disable-model-invocation` (so Claude
can auto-invoke). Each alias file contains only the routing dispatch:

```yaml
---
description: Create or update the feature specification from a natural language feature description.
user-invocable: false
---

Route to the main specflow skill: /specflow specify $ARGUMENTS
```

This restores per-phase discovery precision while hiding the alias from the user's `/` menu. The 11
hidden alias folders add file system overhead but are tiny (each is a 5-line SKILL.md).

Option C: Ship the router with `disable-model-invocation: true` and accept that all invocation is
explicit (`/specflow <phase>`). This is the current behaviour anyway — all current phase skills
already have `disable-model-invocation: true` except `specflow-review`. For the review phase,
maintain a single thin alias (option B pattern) to preserve the auto-invocation.

**Recommendation: option C with one alias for review.**

All current phase skills are already manual-only. The only phase where auto-invocation matters is
`specflow-review` (no `disable-model-invocation` today). Create a single alias skill
`.claude/skills/specflow-review-alias/SKILL.md` (or reuse the `specflow-review/` folder name as a
stub that dispatches to the router). This is one file, not 11. If Kevin decides more phases should
be auto-invocable later, add aliases one at a time without touching the router.

---

## Trade-offs Kevin needs to decide

1. **Self-loop handoffs (Q2).** Implement self-loop (`agent: specflow`) and verify in a live Claude
   Code session before shipping. If the platform rejects self-loops, fall back to plain-text
   next-phase suggestions (no clickable buttons). Recommendation: accept the risk and test; button
   UX is worth the experiment.

2. **Auto-chain fate (Q4).** Keep `auto-chain` as a separate skill (option A) vs fold it into the
   router as `/specflow chain`. Recommendation: keep separate — it preserves the existing UX for
   users who type `/auto-chain`.

3. **Review auto-invocation (Q7).** The review phase is the only one that today is auto-invocable.
   After consolidation, maintain that with a thin stub skill for `specflow-review` that dispatches
   to `/specflow review`. Recommendation: yes, preserve it; the alternative is a regression for
   users who rely on Claude triggering review automatically.

4. **Plugin rename (Q3).** Accept `/specflow-plugin:specflow` double-prefix or rename the plugin to
   remove one level. Recommendation: accept double-prefix for now; plugin rename is a separate
   release concern.

5. **Migration scope.** Whether the migration runs automatically on `specflow upgrade` (recommended)
   or requires an explicit `specflow migrate` command. Recommendation: fold into `upgrade` as all
   prior migrations have been — the pattern is established and users expect `upgrade` to modernize
   their layout.

---

## Affected files

**Templates (source of truth — never edit bundle directly):**

- NEW: `templates/core/skills/specflow/SKILL.md` (router)
- NEW: `templates/core/skills/specflow/phases/specify.md` (body from existing `specflow-specify.md`)
- NEW: `templates/core/skills/specflow/phases/clarify.md`
- NEW: `templates/core/skills/specflow/phases/plan.md`
- NEW: `templates/core/skills/specflow/phases/tasks.md`
- NEW: `templates/core/skills/specflow/phases/analyze.md`
- NEW: `templates/core/skills/specflow/phases/implement.md`
- NEW: `templates/core/skills/specflow/phases/review.md`
- NEW: `templates/core/skills/specflow/phases/merge.md`
- NEW: `templates/core/skills/specflow/phases/constitution.md`
- NEW: `templates/core/skills/specflow/phases/checklist.md`
- NEW: `templates/core/skills/specflow/phases/groom.md`
- UPDATED: `templates/core/skills/auto-chain/SKILL.md` (replace `specflow-<phase>` refs with
  `specflow <phase>`)
- REMOVED: `templates/core/commands/specflow-specify.md` (content moved to phases/specify.md)
- REMOVED: `templates/core/commands/specflow-*.md` (all 10 phase command files)
- REMOVED: `templates/core/skills/specflow-groom/SKILL.md`
- `templates/manifest.json` — add new paths, remove old paths

**Source code:**

- UPDATED: `src/domain/plugin_coverage.ts` — `isPluginCoveredPath` regex +
  `PLUGIN_COVERED_PATHS_CLAUDE` list
- NEW: migration function `migrateSpecflowRouterSkill` in `src/cli/handlers/upgrade_handler.ts` (or
  extracted to a new `src/application/migrations/` module)
- UPDATED: `src/cli/handlers/upgrade_handler.ts` — call `migrateSpecflowRouterSkill` in the upgrade
  sequence
- UPDATED: `src/infrastructure/fs_project_inspector.ts` — any path-based checks that enumerate
  `specflow-*` folders

**Tests:**

- NEW: `tests/unit/migrate_specflow_router_test.ts`
- NEW: `tests/integration/upgrade_router_migration_test.ts` (customized file preservation scenario)
- UPDATED: `tests/unit/plugin_coverage_test.ts` (new path set)

---

## Drift flags

None detected for this feature area. The existing `plugin_coverage.ts` comment references
`docs/superpowers/specs/2026-05-08-claude-plugin-design.md` which exists and is consistent with the
code.
