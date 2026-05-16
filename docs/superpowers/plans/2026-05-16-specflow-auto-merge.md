# Auto-chain as the default `/specflow` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/specflow specify "<feature>"` auto-chain the full workflow by default; reduce
`/specflow-auto` to a one-release deprecation alias.

**Architecture:** The router `templates/core/skills/specflow/SKILL.md` parses chain-mode flags
(`--manual`, `--once`, `--continue`) at the top level, dispatches to the phase file with cleaned
args, then reads a new `templates/core/skills/specflow/phases/auto-chain.md` to drive the chain when
the mode allows. `/specflow-auto` becomes a prose redirect with the same `name:` slug. Every
`templates/core/...` file is mirrored byte-identically into `plugin/...` per existing convention.

**Tech Stack:** Markdown templates + the Deno-based `scripts/bundle-templates.ts` that produces
`src/templates_bundle.ts` (regenerated on every commit by the pre-commit hook); the
`.claude/skills/test-sandbox/scripts/smoke-features.sh` content-assertion gate that runs against a
scaffolded sandbox project.

**Branch:** `feat/specflow-auto-default`

---

## File structure

| File                                                     | Responsibility                                                                                                                                                           | Status  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `templates/core/skills/specflow/phases/auto-chain.md`    | Chain mechanics: STOP #1, silent gates, STOP #2, mid-chain re-entry artefact detection, failure handling, context budget. Read by the router when CHAIN_MODE is engaged. | NEW     |
| `templates/core/skills/specflow/SKILL.md`                | Routing + flag parsing + post-phase chain decision.                                                                                                                      | EDIT    |
| `templates/core/skills/specflow/phases/analyze.md`       | Phase doc — tweak the "regenerate just plan.md" hint to mention `--once`.                                                                                                | EDIT    |
| `templates/core/skills/specflow/phases/review.md`        | Phase doc — drop the stale "hand back to `/specflow-auto`" reference.                                                                                                    | EDIT    |
| `templates/core/skills/specflow-auto/SKILL.md`           | Becomes a plain-prose deprecation alias.                                                                                                                                 | REWRITE |
| `templates/core/agents/specflow-expert.md`               | Line 217: flip the example from `/specflow-auto` to `/specflow`.                                                                                                         | EDIT    |
| `templates/harness-specific/cursor/specify-rules.mdc`    | Line 32: same flip.                                                                                                                                                      | EDIT    |
| `templates/harness-specific/claude/commands/specflow.md` | Line 18: drop the stale `disable-model-invocation: true` claim (it was lifted in a prior change).                                                                        | EDIT    |
| `plugin/skills/specflow/phases/auto-chain.md`            | Byte-identical mirror of the new templates/core file.                                                                                                                    | NEW     |
| `plugin/skills/specflow/SKILL.md`                        | Mirror.                                                                                                                                                                  | EDIT    |
| `plugin/skills/specflow/phases/{analyze,review}.md`      | Mirror.                                                                                                                                                                  | EDIT    |
| `plugin/skills/specflow-auto/SKILL.md`                   | Mirror of the deprecation alias.                                                                                                                                         | REWRITE |
| `plugin/agents/specflow-expert.md`                       | Mirror.                                                                                                                                                                  | EDIT    |
| `plugin/README.md`                                       | Lines 4, 12, 60: flip wording from "specflow-auto" to "auto-chain by default".                                                                                           | EDIT    |
| `plugin/.claude-plugin/plugin.json`                      | Line 3: description currently says "Specflow's specflow-auto skill, slash commands, and sub-agents…" — drop the specflow-auto branding.                                  | EDIT    |
| `docs/llms.md`                                           | Lines 63, 71, 358–413, 563: rewrite the auto-chain section + scattered references.                                                                                       | EDIT    |
| `.claude/skills/test-sandbox/scripts/smoke-features.sh`  | Move three `specflow-auto` assertions to the router; add a deprecation-notice assertion; add a chain-mode regression assertion.                                          | EDIT    |

---

## Task 0: Create the feature branch

**Files:** (none)

- [ ] **Step 1: Branch from main**

```bash
cd /Users/kevin/Sites/specflow
git checkout main
git pull --ff-only origin main
git checkout -b feat/specflow-auto-default
```

- [ ] **Step 2: Verify clean tree**

Run: `git status` Expected: `nothing to commit, working tree clean`

---

## Task 1: Create `phases/auto-chain.md` (chain mechanics)

**Files:**

- Create: `templates/core/skills/specflow/phases/auto-chain.md`
- Create: `plugin/skills/specflow/phases/auto-chain.md` (byte-identical mirror)

**Source content origin:** the body of today's `templates/core/skills/specflow-auto/SKILL.md` (chars
256 onwards), minus the "## Opt-out" section (moves to the router's flag-parsing block in Task 2).
Title and intro are rewritten because this file is no longer a top-level skill.

- [ ] **Step 1: Write the failing smoke assertion**

Edit `/Users/kevin/Sites/specflow/.claude/skills/test-sandbox/scripts/smoke-features.sh`. Locate the
existing block at line 205 (`echo "═══ #182  specflow-auto — mid-chain re-entry ═══"`) and INSERT a
new block immediately above it:

```bash
echo "═══ #251  auto-chain — chain mechanics file present ═══"
check "phases/auto-chain.md is bundled into the project" \
  'test -f .claude/skills/specflow/phases/auto-chain.md'
check "auto-chain.md documents STOP #1 and STOP #2" \
  'grep -q "STOP #1" .claude/skills/specflow/phases/auto-chain.md && grep -q "STOP #2" .claude/skills/specflow/phases/auto-chain.md'
check "auto-chain.md documents mid-chain re-entry" \
  'grep -q "Mid-chain re-entry" .claude/skills/specflow/phases/auto-chain.md'
```

- [ ] **Step 2: Create `templates/core/skills/specflow/phases/auto-chain.md`**

Write this exact content:

````markdown
# Auto-chain control

This file carries the chain mechanics that the `/specflow` router follows when chain mode is
engaged. The router reads it after a chainable phase (`specify`, `clarify`, `plan`, `tasks`,
`analyze`, `implement`, `review`) completes — unless `--manual` or `--once` was passed, or
downstream artefacts indicate one-shot intent.

## Default flow

```
specify → clarify → plan → tasks → analyze → implement → review → merge
          ▲                                                        ▲
          STOP #1 (only if clarifications needed)                  STOP #2 (pre-merge validation)
```

## Per-phase behavior

After each phase completes successfully, immediately invoke the next phase via the `Skill` tool (or
the platform equivalent). Do not emit a user-facing "ready for next step?" prompt. A one-line
`✓ <phase> complete — proceeding to <next>` log is sufficient.

## STOP #1 — Clarification checkpoint

After `/specflow clarify` finishes:

- If zero `[NEEDS CLARIFICATION]` markers remain in `spec.md`, continue silently to
  `/specflow plan`.
- If markers remain, present the top 3 questions to the user (per the `/specflow clarify` format)
  and wait for answers. Once the spec is updated, resume the chain automatically.

## Silent gates

These phases run without user interruption unless they fail hard or surface CRITICAL findings:

- `/specflow plan` — generates plan + research + data-model + contracts + quickstart.
- `/specflow tasks` — generates tasks.md.
- `/specflow analyze` — cross-artifact consistency check. On LOW/MEDIUM findings, log a summary and
  continue. On CRITICAL findings, stop and surface them.
- `/specflow implement` — runs the developer → review-coordinator → qa-tester pipeline. Has its own
  internal fix loop for review findings; do not intercept.
- `/specflow review` — final quality scan.

## STOP #2 — Pre-merge validation

After `/specflow review` passes, ALWAYS stop and present a compact summary before invoking
`/specflow merge`. The summary must include:

- Feature name and branch
- Files created / modified (count + key paths)
- Tests added and full-suite status
- Known deviations from tasks.md and rationale
- Open risks / deferred items
- One-line business outcome

Then ask explicitly: "Ready to merge? (yes to run /specflow merge, no to stay on the branch)". Wait
for explicit confirmation. On "yes", invoke `/specflow merge`. After merge, the chain ends.

## Mid-chain re-entry

When the user invokes any phase other than `specify` directly (e.g. `/specflow plan 042`,
`/specflow implement 042`), apply this context-aware default:

- **Downstream artefacts missing** → chain. The user is resuming an interrupted flow (long session,
  fresh shell after compaction, manual review between early phases). Continue through the remaining
  phases → STOP #2 with the same checkpoints as the entry-point flow.
- **Downstream artefacts present** → one-shot. The user is re-running a single phase (regenerate
  `plan.md` after a tweak, re-analyse after a spec edit). Do NOT cascade.

"Downstream artefacts" means files under `.specflow/specs/<feature>/` produced by phases AFTER the
one being invoked:

| Invoked phase | Downstream artefacts to check                                                           |
| ------------- | --------------------------------------------------------------------------------------- |
| `clarify`     | `plan.md`, `tasks.md`                                                                   |
| `plan`        | `tasks.md`, `data-model.md`, `contracts/`, `quickstart.md`                              |
| `tasks`       | `tasks.md` markings beyond the initial generation, or any task marked done              |
| `analyze`     | nothing (analyze is a read-only gate; treat as one-shot unless `--continue`)            |
| `implement`   | a merged PR, a `review.md`, or task completion past 50%                                 |
| `review`      | nothing past review (chain-tail is just `merge`); treat as one-shot unless `--continue` |

If any listed artefact is present, infer one-shot intent. If all are absent, chain.

### Explicit overrides

The router-level flags `--continue` and `--once` override the artefact-detection default. They are
mutually exclusive with each other and with `--manual`:

- `--continue` — force the chain regardless of artefact state. Useful when you want to regenerate a
  phase AND cascade downstream work afterwards (e.g. tweak `plan.md`, then re-run
  `tasks → analyze →
  implement → review` from scratch).
- `--once` — force one-shot regardless. Useful when downstream artefacts haven't been generated yet
  but you only want to run this single phase right now (e.g. inspect the spec before authorising the
  rest of the chain).

## Failure handling

- Hard failure in a silent gate (plan/tasks/analyze/implement/review): stop, surface the error, ask
  the user how to proceed. Do not silently retry.
- Task-level blockers reported by the developer agent during `implement`: the implement workflow has
  its own fix loop; do not intercept.
- `clarify` producing more than 5 questions: present the top 3 per the `/specflow clarify` quota;
  the rest can be asked later.

## Context budget

Long features (≥13 story points or ≥30 tasks) may exhaust context during `/specflow implement`. If
compaction occurs mid-chain, inform the user and let them resume from a fresh session — the
artefact-detection default above will pick up where the previous run stopped, or they can pass
`--continue` explicitly.
````

- [ ] **Step 3: Mirror to `plugin/skills/specflow/phases/auto-chain.md`**

```bash
cp /Users/kevin/Sites/specflow/templates/core/skills/specflow/phases/auto-chain.md \
   /Users/kevin/Sites/specflow/plugin/skills/specflow/phases/auto-chain.md
```

- [ ] **Step 4: Verify byte-identical**

```bash
diff /Users/kevin/Sites/specflow/templates/core/skills/specflow/phases/auto-chain.md \
     /Users/kevin/Sites/specflow/plugin/skills/specflow/phases/auto-chain.md
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add templates/core/skills/specflow/phases/auto-chain.md \
        plugin/skills/specflow/phases/auto-chain.md \
        .claude/skills/test-sandbox/scripts/smoke-features.sh
git commit -m "feat(specflow): add phases/auto-chain.md for chain mechanics

Carries the chain-control prose (STOP #1, silent gates, STOP #2,
mid-chain re-entry, --once/--continue) that the router reads when
chain mode is engaged. Body lifted from specflow-auto/SKILL.md minus
the manual opt-out section (which moves to the router's flag parser
in the next task). Plugin mirror is byte-identical.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Pre-commit will run `deno fmt --check`, `deno lint`, `deno task bundle`, `deno check src/main.ts`.
The bundle step will pick up the new file under `templates/core/` and regenerate
`src/templates_bundle.ts` automatically.

---

## Task 2: Promote the router to auto-chain by default

**Files:**

- Modify: `templates/core/skills/specflow/SKILL.md`
- Modify: `plugin/skills/specflow/SKILL.md` (byte-identical mirror)
- Modify: `.claude/skills/test-sandbox/scripts/smoke-features.sh` (chain-mode regression assertion)

- [ ] **Step 1: Add the chain-mode regression assertion**

Edit `/Users/kevin/Sites/specflow/.claude/skills/test-sandbox/scripts/smoke-features.sh`. Locate the
`#251` block created in Task 1 and INSERT immediately after the three `check` calls in that block:

```bash
check "router SKILL.md parses --manual flag" \
  'grep -q -- "--manual" .claude/skills/specflow/SKILL.md'
check "router SKILL.md routes to phases/auto-chain.md when chain mode is on" \
  'grep -q "phases/auto-chain.md" .claude/skills/specflow/SKILL.md'
check "router SKILL.md no longer recommends /specflow-auto for end-to-end runs" \
  '! grep -q "use \\`/specflow-auto specify" .claude/skills/specflow/SKILL.md'
```

- [ ] **Step 2: Edit `templates/core/skills/specflow/SKILL.md`**

Replace the entire body (lines 22–96 in today's file — keep frontmatter at lines 1–20 intact) with
the following:

```markdown
# Specflow router

`$ARGUMENTS` carries the user's input. Parse it as `[<flag>...] <phase> [rest]`:

1. **Chain mode parsing** — scan the tokens for at most one of `--manual`, `--once`, `--continue`.
   They are mutually exclusive; if more than one is present, report
   `error: --manual, --once, and --continue are mutually exclusive` and stop.
   - `--manual` → CHAIN_MODE = `off`
   - `--once` → CHAIN_MODE = `once`
   - `--continue` → CHAIN_MODE = `continue`
   - none → CHAIN_MODE = `auto` (the default)

   Strip the matched flag from the token list before going further.

2. **Phase extraction** — the first remaining token is the phase name. Everything after the first
   whitespace is the argument string for that phase.

3. **Empty arguments** — if no tokens remain after flag parsing (or `$ARGUMENTS` was empty to start
   with), render the **Workflow overview** below and stop. Do not pick a phase yourself.

## Phase index

| Phase             | Reference                   | One-liner                                                                       |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `specify`         | `phases/specify.md`         | Create or update the feature spec from a natural-language description.          |
| `clarify`         | `phases/clarify.md`         | Resolve ambiguities in the spec via structured questioning.                     |
| `plan`            | `phases/plan.md`            | Generate the technical plan, research, data model, contracts, quickstart.       |
| `tasks`           | `phases/tasks.md`           | Produce `tasks.md` from the plan.                                               |
| `analyze`         | `phases/analyze.md`         | Cross-artifact consistency check (spec ↔ plan ↔ tasks).                         |
| `implement`       | `phases/implement.md`       | Run the developer → review-coordinator → qa-tester pipeline against `tasks.md`. |
| `review`          | `phases/review.md`          | Final quality scan over the implementation.                                     |
| `merge`           | `phases/merge.md`           | Pre-merge validation and merge the feature branch.                              |
| `constitution`    | `phases/constitution.md`    | Edit the project's `constitution.md` rules.                                     |
| `checklist`       | `phases/checklist.md`       | Generate a quality checklist for the current spec.                              |
| `groom`           | `phases/groom.md`           | Backlog hygiene pass via the product-owner agent.                               |
| `tag-version`     | `phases/tag-version.md`     | Bump + create an annotated git tag using the project's versioning scheme.       |
| `release-version` | `phases/release-version.md` | Generate categorized release notes for a tag (default: latest).                 |

Chainable phases are: `specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`, `review`. The
others (`merge`, `constitution`, `checklist`, `groom`, `tag-version`, `release-version`) are
one-shot regardless of chain mode.

## Routing

1. **Read** the phase reference file (`phases/<phase>.md`) for the requested phase using the `Read`
   tool.
2. **Substitute** the stripped phase arguments for the phase's input.
3. **Execute** the procedure in the reference file end-to-end.
4. **Decide whether to chain** (see "Chain decision" below).

Unknown phase → print the phase index and stop.

## Chain decision

After the phase procedure completes successfully:

- `CHAIN_MODE == off` (the user passed `--manual`) → stop. Report the phase outcome and leave the
  next step to the user.
- Phase is not in the chainable list (e.g. `constitution`, `checklist`, `groom`, `tag-version`,
  `release-version`) → stop.
- `CHAIN_MODE == once` → stop.
- `CHAIN_MODE == continue` → read `phases/auto-chain.md` and chain through the remaining phases
  regardless of downstream-artefact state.
- `CHAIN_MODE == auto` (the default) → read `phases/auto-chain.md`. For `specify`, the chain always
  continues. For any other chainable phase, apply the artefact-detection table in that file — chain
  if downstream artefacts are absent, one-shot if present.

## Workflow overview
```

specify → clarify → plan → tasks → analyze → implement → review → merge ▲ STOP for pre-merge
validation

```
Default behavior: `/specflow specify "..."` runs the entire chain in one
session, pausing only at STOP #1 (if clarifications are needed) and
STOP #2 (pre-merge confirmation). See `phases/auto-chain.md` for the
chain mechanics.

`constitution`, `checklist`, `groom`, `tag-version`, and `release-version` are out-of-band utilities, not part of the linear flow.

## Typical flow
```

/specflow specify "Add OAuth2 login" → drafts the spec, then auto-chains: → /specflow clarify (STOP
#1 only if [NEEDS CLARIFICATION] markers remain) → /specflow plan → /specflow tasks → /specflow
analyze → /specflow implement → /specflow review → STOP #2 — summary + "Ready to merge?"
confirmation → /specflow merge (on "yes")

```
To run a single phase only (no chain), pass `--manual`:
```

/specflow specify --manual "Add OAuth2 login"

```
To force or skip the chain mid-flow:
```

/specflow plan 042 --once # regenerate plan.md only, do not cascade /specflow plan 042 --continue #
regenerate plan.md AND cascade tasks → review

```
```

- [ ] **Step 3: Mirror to `plugin/skills/specflow/SKILL.md`**

```bash
cp /Users/kevin/Sites/specflow/templates/core/skills/specflow/SKILL.md \
   /Users/kevin/Sites/specflow/plugin/skills/specflow/SKILL.md
```

- [ ] **Step 4: Verify byte-identical**

```bash
diff /Users/kevin/Sites/specflow/templates/core/skills/specflow/SKILL.md \
     /Users/kevin/Sites/specflow/plugin/skills/specflow/SKILL.md
```

Expected: no output.

- [ ] **Step 5: Run unit tests**

```bash
cd /Users/kevin/Sites/specflow
deno task test
```

Expected: `594 passed | 0 failed` (no template-content tests in the suite; the bundle regen happens
in pre-commit and the suite reads the bundled string).

- [ ] **Step 6: Commit**

```bash
git add templates/core/skills/specflow/SKILL.md \
        plugin/skills/specflow/SKILL.md \
        .claude/skills/test-sandbox/scripts/smoke-features.sh
git commit -m "feat(specflow): /specflow specify auto-chains by default

Router gains --manual / --once / --continue flag parsing and a
post-phase chain decision step. /specflow specify runs the full
chain by default; --manual is the one-shot opt-out. Chainable phases
also auto-chain mid-flow when downstream artefacts are absent
(artefact-detection default lives in phases/auto-chain.md). Plugin
mirror is byte-identical.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Phase doc drift fixes (analyze + review)

**Files:**

- Modify: `templates/core/skills/specflow/phases/analyze.md:190`
- Modify: `templates/core/skills/specflow/phases/review.md:84-85`
- Modify: `plugin/skills/specflow/phases/analyze.md` (mirror)
- Modify: `plugin/skills/specflow/phases/review.md` (mirror)

- [ ] **Step 1: Patch `templates/core/skills/specflow/phases/analyze.md` line 190**

Replace the literal string:

```
- Provide explicit command suggestions: e.g., "Run /specflow specify with refinement", "Run /specflow plan to adjust architecture", "Manually edit tasks.md to add coverage for 'performance-metrics'"
```

with:

```
- Provide explicit command suggestions: e.g., "Run /specflow specify --manual to refine the spec without re-cascading", "Run /specflow plan --once to regenerate the plan only, or /specflow plan to cascade through tasks → review", "Manually edit tasks.md to add coverage for 'performance-metrics'"
```

- [ ] **Step 2: Patch `templates/core/skills/specflow/phases/review.md` lines 84-85**

Replace the literal string:

```
If Overall = PASS, invoke `/specflow merge` (or hand back to `/specflow-auto`
for STOP #2). If FAIL, stop and report to the user.
```

with:

```
If Overall = PASS, surface the STOP #2 summary block defined in
`phases/auto-chain.md` and ask for merge confirmation, then invoke
`/specflow merge` on "yes". If FAIL, stop and report to the user.
```

- [ ] **Step 3: Mirror to plugin**

```bash
cp /Users/kevin/Sites/specflow/templates/core/skills/specflow/phases/analyze.md \
   /Users/kevin/Sites/specflow/plugin/skills/specflow/phases/analyze.md
cp /Users/kevin/Sites/specflow/templates/core/skills/specflow/phases/review.md \
   /Users/kevin/Sites/specflow/plugin/skills/specflow/phases/review.md
```

- [ ] **Step 4: Verify byte-identical**

```bash
diff /Users/kevin/Sites/specflow/templates/core/skills/specflow/phases/analyze.md \
     /Users/kevin/Sites/specflow/plugin/skills/specflow/phases/analyze.md && \
diff /Users/kevin/Sites/specflow/templates/core/skills/specflow/phases/review.md \
     /Users/kevin/Sites/specflow/plugin/skills/specflow/phases/review.md
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add templates/core/skills/specflow/phases/analyze.md \
        templates/core/skills/specflow/phases/review.md \
        plugin/skills/specflow/phases/analyze.md \
        plugin/skills/specflow/phases/review.md
git commit -m "fix(specflow): phase docs reflect auto-chain default

- analyze.md re-run hint now explicitly distinguishes --manual (refine
  spec, no cascade), --once (regen one phase, no cascade), and bare
  invocation (cascade through downstream phases)
- review.md drops the stale /specflow-auto handoff: STOP #2 is now
  owned by the router via phases/auto-chain.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Rewrite `/specflow-auto` as a deprecation alias

**Files:**

- Modify: `templates/core/skills/specflow-auto/SKILL.md` (full rewrite)
- Modify: `plugin/skills/specflow-auto/SKILL.md` (mirror)
- Modify: `.claude/skills/test-sandbox/scripts/smoke-features.sh` (replace the three current
  `specflow-auto` assertions with one deprecation-notice assertion)

- [ ] **Step 1: Replace the three current specflow-auto smoke assertions**

Edit `/Users/kevin/Sites/specflow/.claude/skills/test-sandbox/scripts/smoke-features.sh`. Replace
the entire block at lines 205-211:

```bash
echo "═══ #182  specflow-auto — mid-chain re-entry ═══"
check "specflow-auto SKILL.md documents mid-chain re-entry" \
  'grep -q "Mid-chain re-entry" .claude/skills/specflow-auto/SKILL.md'
check "specflow-auto SKILL.md describes the --continue flag" \
  'grep -q -- "--continue" .claude/skills/specflow-auto/SKILL.md'
check "specflow-auto SKILL.md describes the --once flag" \
  'grep -q -- "--once" .claude/skills/specflow-auto/SKILL.md'
```

with:

```bash
echo "═══ #182  specflow-auto — deprecation alias ═══"
check "specflow-auto SKILL.md carries the deprecation notice" \
  'grep -q "DEPRECATED" .claude/skills/specflow-auto/SKILL.md'
check "specflow-auto SKILL.md tells users to use /specflow instead" \
  'grep -q "auto-chains by default" .claude/skills/specflow-auto/SKILL.md'
```

- [ ] **Step 2: Rewrite `templates/core/skills/specflow-auto/SKILL.md`**

Replace the entire file content with:

```markdown
---
name: specflow-auto
description: DEPRECATED — /specflow now auto-chains by default since v1.5.0. This skill is kept as an alias for one release and will be removed in the next major version.
---

# /specflow-auto is deprecated

Auto-chain is now the default behavior of `/specflow`. Use:

- `/specflow specify "<feature>"` — runs the full chain automatically (specify → clarify → plan →
  tasks → analyze → implement → review → STOP #2 for merge confirmation).
- `/specflow specify --manual "<feature>"` — runs `specify` only, no chain.
- `/specflow <phase> <args>` — mid-chain re-entry with artefact detection (chain if downstream
  artefacts are absent, one-shot if present). Override with `--once` (force one-shot) or
  `--continue` (force chain).

See `phases/auto-chain.md` (in the `specflow` skill) for the full chain mechanics, including STOP #1
(clarification checkpoint) and STOP #2 (pre-merge confirmation).

This skill will be removed in the next major release. If you see this file in your project after
running `specflow upgrade`, it means muscle-memory invocations of `/specflow-auto` keep working —
but you should switch to the new entry point.
```

- [ ] **Step 3: Mirror to plugin**

```bash
cp /Users/kevin/Sites/specflow/templates/core/skills/specflow-auto/SKILL.md \
   /Users/kevin/Sites/specflow/plugin/skills/specflow-auto/SKILL.md
```

- [ ] **Step 4: Verify byte-identical**

```bash
diff /Users/kevin/Sites/specflow/templates/core/skills/specflow-auto/SKILL.md \
     /Users/kevin/Sites/specflow/plugin/skills/specflow-auto/SKILL.md
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add templates/core/skills/specflow-auto/SKILL.md \
        plugin/skills/specflow-auto/SKILL.md \
        .claude/skills/test-sandbox/scripts/smoke-features.sh
git commit -m "feat(specflow): deprecate /specflow-auto in favor of /specflow

Rewrites the skill body to a plain-prose redirect — no Skill-tool
chaining, works on every harness. The manifest entry stays for one
release; the next major release will drop it and upgrade_plan.ts will
emit a clean remove. Smoke now asserts the deprecation notice instead
of the (moved) chain mechanics.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Flip the specflow-expert agent description

**Files:**

- Modify: `templates/core/agents/specflow-expert.md:217-221`
- Modify: `plugin/agents/specflow-expert.md:217-221` (mirror)

- [ ] **Step 1: Patch `templates/core/agents/specflow-expert.md`**

Replace the literal multi-line string:

```
1. **Auto-chained pipeline** — `/specflow-auto` chains `clarify →
   plan → tasks → analyze → implement → review → merge` in one
   session. Upstream stops at every step and asks the human; Specflow
   stops only when clarification is genuinely required and once
   before the merge.
```

with:

```
1. **Auto-chained pipeline** — `/specflow specify "<feature>"` runs
   `specify → clarify → plan → tasks → analyze → implement → review`
   in one session, stopping only when clarification is genuinely
   required and once before the merge. Upstream Spec Kit stops at every
   step and asks the human. The `/specflow-auto` slash command is kept
   for one release as a deprecation alias.
```

- [ ] **Step 2: Mirror to plugin**

```bash
cp /Users/kevin/Sites/specflow/templates/core/agents/specflow-expert.md \
   /Users/kevin/Sites/specflow/plugin/agents/specflow-expert.md
```

- [ ] **Step 3: Verify byte-identical**

```bash
diff /Users/kevin/Sites/specflow/templates/core/agents/specflow-expert.md \
     /Users/kevin/Sites/specflow/plugin/agents/specflow-expert.md
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add templates/core/agents/specflow-expert.md plugin/agents/specflow-expert.md
git commit -m "docs(specflow-expert): point newcomers at /specflow specify

The expert agent's 'what's different from upstream Spec Kit' section
now uses /specflow specify as the canonical auto-chain entry point;
/specflow-auto is mentioned only as a deprecation alias.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Harness-specific drift fixes (Cursor + Claude command shim)

**Files:**

- Modify: `templates/harness-specific/cursor/specify-rules.mdc:32`
- Modify: `templates/harness-specific/claude/commands/specflow.md:18`

- [ ] **Step 1: Patch `templates/harness-specific/cursor/specify-rules.mdc`**

Replace the literal line 32:

```
- `/specflow-auto` — auto-chain dispatcher invoked by `/specflow specify`
```

with:

```
- `/specflow-auto` — deprecated alias of `/specflow`; will be removed in the next major release
```

- [ ] **Step 2: Patch `templates/harness-specific/claude/commands/specflow.md`**

Replace the literal line 18:

```
This command is a thin slash-command shim so users can type `/specflow specify "..."` directly. The skill itself has `disable-model-invocation: true`; this command makes the explicit `/` form available alongside the `specflow-review` auto-invoke alias.
```

with:

```
This command is a thin slash-command shim so users can type `/specflow specify "..."` directly. The router auto-chains the rest of the workflow by default; pass `--manual` to opt out, or `--once` / `--continue` to override the mid-chain artefact-detection heuristic.
```

- [ ] **Step 3: Commit**

```bash
git add templates/harness-specific/cursor/specify-rules.mdc \
        templates/harness-specific/claude/commands/specflow.md
git commit -m "fix(harness): drop stale specflow-auto refs from cursor + claude shims

- cursor/specify-rules.mdc: mark /specflow-auto as deprecated
- claude/commands/specflow.md: drop the stale disable-model-invocation
  claim (the flag was lifted in a prior change) and document the new
  --manual / --once / --continue surface

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Plugin README + plugin.json description

**Files:**

- Modify: `plugin/README.md:3-5, 12, 60`
- Modify: `plugin/.claude-plugin/plugin.json:3`

- [ ] **Step 1: Patch `plugin/README.md` line 3-5**

Replace:

```
This is the Claude Code plugin distribution of [Specflow](https://specflow.makerlabs.dev). It ships
the same slash-commands, sub-agents, and the specflow-auto skill that the `specflow` binary
scaffolds into projects — just as a user-scope plugin instead.
```

with:

```
This is the Claude Code plugin distribution of [Specflow](https://specflow.makerlabs.dev). It ships
the same slash-commands and sub-agents that the `specflow` binary scaffolds into projects — just as
a user-scope plugin instead. `/specflow specify "<feature>"` auto-chains the full workflow by
default; pass `--manual` to opt out.
```

- [ ] **Step 2: Patch `plugin/README.md` line 12**

Replace:

```
| `skills/specflow-auto/SKILL.md`                                                                                                             | Auto-chain skill — `/specflow-plugin:specflow-auto`                   |
```

with:

```
| `skills/specflow-auto/SKILL.md`                                                                                                             | Deprecated alias (removed in next major) — kept one release for muscle memory |
```

- [ ] **Step 3: Patch `plugin/README.md` line 60**

Replace:

```
Then invoke any plugin skill: `/specflow-plugin:specflow-auto specify "…"`.
```

with:

```
Then invoke any plugin skill: `/specflow-plugin:specflow specify "…"`.
```

- [ ] **Step 4: Patch `plugin/.claude-plugin/plugin.json` line 3**

Replace the existing `"description"` value:

```
"description": "Specflow's specflow-auto skill, slash commands, and sub-agents for Claude Code — the same content the binary scaffolds, available as a versioned plugin.",
```

with:

```
"description": "Specflow's auto-chained spec-driven workflow, slash commands, and sub-agents for Claude Code — the same content the binary scaffolds, available as a versioned plugin.",
```

- [ ] **Step 5: Commit**

```bash
git add plugin/README.md plugin/.claude-plugin/plugin.json
git commit -m "docs(plugin): flip marketing to /specflow auto-chain default

README and plugin manifest description no longer market /specflow-auto
as the primary entry point — that's now /specflow's default behavior.
The auto skill is noted as a deprecated alias slated for removal in
the next major release.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Rewrite the auto-chain section in `docs/llms.md`

**Files:**

- Modify: `docs/llms.md:63, 71, 358-413, 563`

- [ ] **Step 1: Patch `docs/llms.md` line 63**

Open `/Users/kevin/Sites/specflow/docs/llms.md`. Replace the literal substring:

```
(with 11 phase docs), the `specflow-review` auto-invoke alias, the `specflow-auto` skill, and 9
```

with:

```
(with 11 phase docs, the `specflow-review` auto-invoke alias, and the deprecated `specflow-auto` skill), and 9
```

- [ ] **Step 2: Patch `docs/llms.md` line 71**

Replace the literal line:

```
/specflow-plugin:specflow-auto specify "<feature description>"
```

with:

```
/specflow-plugin:specflow specify "<feature description>"
```

- [ ] **Step 3: Patch `docs/llms.md` lines 358-413** (the auto-chain subsection)

Replace the entire block starting at line 358
(`The chain is invoked through the bundled \`/specflow-auto\`
skill:`) and ending at line 413 (the line`\`/specflow-auto <phase> N --once\` — force one-shot
regardless.`) with the following:

```markdown
The chain is invoked through the bundled `/specflow` skill:
```

/specflow specify "<feature description>"

```
Two checkpoints inside the chain:

- **STOP #1 — clarify** runs after `clarify`. If `spec.md` still has `[NEEDS CLARIFICATION]`
  markers, the model surfaces the top 3 questions and waits. Once you answer, the chain resumes
  automatically. If there are no markers, the chain continues silently.
- **STOP #2 — pre-merge** runs after `review`. The model summarises the work (files changed, tests,
  open risks, business outcome) and asks `Ready to merge?` before invoking `merge`. Reply `yes` to
  finish.

#### Linking a feature to a backlog issue

Pass `--issue <id>` to `/specflow specify` (or to the bundled `create-new-feature.sh`) to record the
originating backlog issue in `.specflow/feature.json`:
```

/specflow specify "Fix the off-by-one in pagination" --issue 42

```
After `/specflow merge` fast-forwards the branch onto `main` and you push, the merge phase reads
`feature.json.linked_issue`, runs `cascade-check.sh` (github / gitlab) to confirm no sub-issues
block the close, asks `Close issue #42 on the board now? (yes/no)`, and on `yes` flips the project
column to `Done` via `move.sh` then dispatches the `product-owner` agent to post a close comment
with the merged commit range and `gh issue close --reason completed`. The board stays in sync with
`main` instead of drifting.

`--issue` is opt-in; existing feature trees without the field skip the auto-close silently.

To opt out of the chain entirely (run only `specify` and stop):
```

/specflow specify --manual "<feature description>"

```
#### Mid-chain re-entry

Any phase other than `specify` can also enter the chain when invoked mid-flow — useful for two real
workflows:

- **Manual review between early phases** — read `spec.md` after `specify` lands, then
  `/specflow clarify N` resumes the chain through `plan → tasks → … → STOP #2`.
- **Context-budget recovery** — open a fresh session after compaction and run
  `/specflow implement N` to pick up the tail (`→ review → STOP #2`).

The default is **context-aware**: if downstream artefacts under `.specflow/specs/<feature>/` are
missing, the chain fires; if they exist, the invocation is treated as a single-phase re-run (so
regenerating `plan.md` doesn't accidentally cascade through the rest). Two explicit overrides when
the default guesses wrong:

- `/specflow <phase> N --continue` — force the chain regardless of artefact state.
- `/specflow <phase> N --once` — force one-shot regardless.

The `/specflow-auto` slash command is kept for one release as a deprecation alias and will be
removed in the next major version.
```

- [ ] **Step 4: Patch `docs/llms.md` line 563**

Replace the literal substring:

```
`specflow-auto` skill, and 10 sub-agents) are namespaced under `/specflow-plugin:*` so they coexist
```

with:

```
deprecated `specflow-auto` alias, and 10 sub-agents) are namespaced under `/specflow-plugin:*` so they coexist
```

- [ ] **Step 5: Commit**

```bash
git add docs/llms.md
git commit -m "docs(llms): /specflow auto-chains by default

Rewrites the public auto-chain section to lead with /specflow specify
as the canonical entry point; /specflow-auto is now a one-release
deprecation alias. Updates the three scattered references in the
plugin-distribution intro to match.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Final test sweep + smoke audit

**Files:** (none — verification only)

- [ ] **Step 1: Run the full Deno test suite**

```bash
cd /Users/kevin/Sites/specflow
deno task test
```

Expected: `594 passed | 0 failed` (no new tests added; suite verifies the bundle still typechecks).

- [ ] **Step 2: Regenerate the bundle one last time and verify clean tree**

```bash
deno task bundle
git status
```

Expected: working tree clean (every commit already ran the bundle via pre-commit).

- [ ] **Step 3: Run the smoke-coverage audit**

```bash
bash /Users/kevin/Sites/specflow/.claude/skills/test-sandbox/scripts/audit.sh
```

Expected: `0 coverage gaps` (the new `#251` smoke block covers the auto-chain.md content and the
chain-mode router behavior; the rewritten `#182` block covers the deprecation notice).

- [ ] **Step 4: Run the sandbox smoke pass**

```bash
bash /Users/kevin/Sites/specflow/.claude/skills/test-sandbox/scripts/smoke-features.sh
```

Expected: every numbered block prints `✓`. If a `✗` appears for `#251` or `#182`, the template edits
in earlier tasks are out of sync with the smoke assertions — re-check.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feat/specflow-auto-default
gh pr create --repo mkrlabs/specflow --base main --head feat/specflow-auto-default \
  --title "feat(specflow): /specflow auto-chains by default; /specflow-auto deprecated" \
  --body "$(cat <<'EOF'
## Why

Two slash-skills (`/specflow` for manual flow, `/specflow-auto` for the auto-chain) means end users and AI agents default to `/specflow specify` and copy-paste every subsequent phase by hand. The auto-chain feature is hidden behind a noisier alias.

## What

Auto-chain becomes the default behavior of `/specflow specify`. The router owns flag parsing (`--manual`, `--once`, `--continue`) and reads `phases/auto-chain.md` to drive the chain.

- `/specflow specify "X"` → full chain → STOP #2 (merge approval)
- `/specflow specify --manual "X"` → spec only, no chain
- `/specflow plan 042` mid-flow → artefact-detection (chain if downstream missing, one-shot otherwise)
- `/specflow plan 042 --once` / `--continue` → explicit overrides
- `/specflow-auto <anything>` → deprecation alias (one release), removed in next major

## Drift fixes bundled

- `phases/review.md` no longer hands STOP #2 to `/specflow-auto`
- `phases/analyze.md` now explicitly distinguishes `--manual` / `--once` / cascade in its re-run hint
- `commands/specflow.md` drops the stale `disable-model-invocation: true` claim
- `cursor/specify-rules.mdc` marks `/specflow-auto` as deprecated
- `plugin/README.md` + `plugin.json` description flipped to lead with the new default
- `docs/llms.md` auto-chain section rewritten + three scattered references fixed

## Verification

- Architect validation: completed 2026-05-16 (in [`docs/superpowers/specs/2026-05-16-specflow-auto-merge-design.md`](docs/superpowers/specs/2026-05-16-specflow-auto-merge-design.md))
- \`deno task test\` 594/0 ✓
- Smoke audit (`audit.sh`) 0 gaps ✓
- Smoke sandbox pass (`smoke-features.sh`) all ✓ (incl. new `#251` block on chain mechanics and updated `#182` block on the deprecation notice)

## Release classification

**Minor.** Behavior change with backward compatibility preserved via the one-release deprecation alias.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Watch CI to completion**

```bash
gh pr checks $(gh pr view --json number -q .number) --repo mkrlabs/specflow --watch
```

Expected: every check ✓ (lint-test, docs-drift, cross-smoke ×3, CodeQL, Analyze).

---

## Self-review checklist (run before declaring the plan done)

1. **Spec coverage**
   - Behavior matrix row "`/specflow specify "X"`" → Task 2 router edit ✓
   - "`/specflow specify --manual "X"`" → Task 2 flag parsing ✓
   - "`/specflow clarify` mid-flow" → Task 2 chain decision + Task 1 artefact-detection table ✓
   - "`/specflow plan --once 042`" → Task 2 chain decision ✓
   - "`/specflow plan --continue 042`" → Task 2 chain decision ✓
   - "`/specflow-auto <phase>`" → Task 4 deprecation alias ✓
   - All five "Files in scope" entries → mapped to Tasks 1–8 ✓
   - "Migration story" → no code change required (covered by existing upgrade machinery; documented
     in design doc, no plan task needed)
   - "Release classification: minor" → outside-this-PR (release skill will run minor bump) — covered
     as the next pipeline step in the parent session

2. **Placeholder scan** — no TBD / TODO / placeholder text in any task; all `Edit` operations
   specify exact old/new strings; the new file's content is given verbatim.

3. **Type consistency** — `CHAIN_MODE` values (`off` / `once` / `continue` / `auto`) used
   consistently in Task 2's chain-decision block; flag names (`--manual` / `--once` / `--continue`)
   consistent across Tasks 2, 3, 6, 8; the deprecation message wording ("auto-chains by default")
   used in Task 4 matches the smoke assertion in Task 4 Step 1.
