---
name: specflow
description: Specflow workflow router — entry point for the spec-driven pipeline. `/specflow <phase> [args]` dispatches to a single phase (brainstorm, specify, clarify, plan, tasks, analyze, implement, review, merge, constitution, checklist, groom, tag-version, release-version, list-skills, audit). `/specflow` with no args prints the workflow overview.
argument-hint: <brainstorm|specify|clarify|plan|tasks|analyze|implement|review|merge|constitution|checklist|groom|tag-version|release-version|list-skills|audit> [args]
when_to_use: |
  Trigger phrases that should route here:
  - brainstorm: "I have a rough idea", "help me figure out what to build", "let's brainstorm a feature", "I don't know exactly what I want yet"
  - specify: "spec out a feature", "write a spec", "create a specification"
  - clarify: "clarify requirements", "fill in gaps in the spec"
  - plan: "plan a feature", "build a technical plan"
  - tasks: "generate tasks", "break down the plan"
  - analyze: "check consistency", "analyze artifacts"
  - implement: "implement the feature", "start coding"
  - review: "review the implementation", "run quality gates"
  - merge: "merge the branch", "ship the feature"
  - constitution: "update the constitution", "edit project rules"
  - checklist: "generate a checklist"
  - groom: "groom the backlog", "run a hygiene pass"
  - tag-version: "tag a version", "create a release tag", "bump the version"
  - release-version: "release", "publish a release", "create release notes"
  - list-skills: "list installed skills", "show skill aliases", "what overlays are active"
  - audit: "audit security / performance / accessibility / architecture / dependencies", "scan the codebase for X issues"
---

# Specflow router

`$ARGUMENTS` carries the user's input. Parse it as `[<flag>...] <phase> [rest]`:

1. **Chain mode parsing** — scan the tokens for at most one of
   `--manual`, `--once`, `--continue`. They are mutually exclusive; if
   more than one is present, report `error: --manual, --once, and --continue are mutually exclusive` and stop.
   - `--manual` → CHAIN_MODE = `off`
   - `--once`   → CHAIN_MODE = `once`
   - `--continue` → CHAIN_MODE = `continue`
   - none      → CHAIN_MODE = `auto` (the default)

   Strip the matched flag from the token list before going further.

   **Chain shape parsing** — additionally scan the tokens for at most
   one of `--lite`, `--full`. They are mutually exclusive with each
   other; if both are present, report `error: --lite and --full are mutually exclusive`
   and stop. They **compose** with the pace flags above (e.g. `--once --lite`
   is valid).
   - `--lite` → CHAIN_SHAPE = `lite` (force the lite chain — `specify
     → plan → analyze → implement → review`, skipping `clarify` and
     `tasks`; see `phases/lite-heuristic.md` and the "Lite chain"
     section in `phases/auto-chain.md`)
   - `--full` → CHAIN_SHAPE = `full` (force the full chain even when
     the specify-phase heuristic would otherwise propose lite)
   - none → CHAIN_SHAPE = `auto` (the default; `phases/specify.md`
     applies the heuristic and may prompt the user once)

   Strip the matched flag from the token list before going further.

2. **Phase extraction** — the first remaining token is the phase name.
   Everything after the first whitespace is the argument string for
   that phase.

   **Compound `audit` phase exception** — when the first token is exactly
   `audit` AND the next token is one of `security`, `performance`,
   `accessibility`, `architecture`, or `dependencies`, treat the pair
   as a single hyphenated phase name `audit-<axis>` (matching the file
   `phases/audit-<axis>.md`). The remaining tokens after the axis become
   the argument string. Examples:
   `audit security` → phase `audit-security`, args ``;
   `audit performance --severity medium` → phase `audit-performance`, args `--severity medium`;
   `audit accessibility` → phase `audit-accessibility`, args ``;
   `audit architecture` → phase `audit-architecture`, args ``;
   `audit dependencies` → phase `audit-dependencies`, args ``.
   Users may also invoke the hyphenated form directly
   (`/specflow audit-security`, `/specflow audit-performance`,
   `/specflow audit-accessibility`, `/specflow audit-architecture`,
   `/specflow audit-dependencies`); both forms route to the same
   phase doc.

3. **Empty arguments** — if no tokens remain after flag parsing (or
   `$ARGUMENTS` was empty to start with), render the **Workflow overview**
   below and stop. Do not pick a phase yourself.

## Phase index

| Phase | Reference | One-liner |
|-------|-----------|-----------|
| `brainstorm` | `phases/brainstorm.md` | Optional step 0 — discover a fuzzy idea through dialogue, then hand the agreed brief to `specify`. |
| `specify` | `phases/specify.md` | Create or update the feature spec from a natural-language description. |
| `clarify` | `phases/clarify.md` | Resolve ambiguities in the spec via structured questioning. |
| `plan` | `phases/plan.md` | Generate the technical plan, research, data model, contracts, quickstart. |
| `tasks` | `phases/tasks.md` | Produce `tasks.md` from the plan. |
| `analyze` | `phases/analyze.md` | Cross-artifact consistency check (spec ↔ plan ↔ tasks). |
| `implement` | `phases/implement.md` | Run the developer → review-coordinator → qa-tester pipeline against `tasks.md`. |
| `review` | `phases/review.md` | Final quality scan over the implementation. |
| `merge` | `phases/merge.md` | Pre-merge validation and merge the feature branch. |
| `constitution` | `phases/constitution.md` | Edit the project's `constitution.md` rules. |
| `checklist` | `phases/checklist.md` | Generate a quality checklist for the current spec. |
| `groom` | `phases/groom.md` | Backlog hygiene pass via the product-owner agent. |
| `tag-version` | `phases/tag-version.md` | Bump + create an annotated git tag using the project's versioning scheme. |
| `release-version` | `phases/release-version.md` | Generate categorized release notes for a tag (default: latest). |
| `list-skills` | `phases/list-skills.md` | List installed skills, flagging aliases and overlay hooks. |
| `audit security` | `phases/audit-security.md` | Read-only project-wide security sweep; emits a findings report. |
| `audit performance` | `phases/audit-performance.md` | Read-only project-wide performance sweep; emits a findings report. |
| `audit accessibility` | `phases/audit-accessibility.md` | Read-only project-wide WCAG 2.1 AA sweep; skips when no FE surface is detected. |
| `audit architecture` | `phases/audit-architecture.md` | Read-only project-wide architectural sweep — hex-layer violations, circular deps, god files, bounded-context leaks. |
| `audit dependencies` | `phases/audit-dependencies.md` | Read-only multi-manifest dependency-hygiene sweep — unbounded ranges, missing lockfiles, unused deps, license violations, typosquats. |

Chainable phases are: `brainstorm`, `specify`, `clarify`, `plan`, `tasks`,
`analyze`, `implement`, `review`. The others (`merge`, `constitution`,
`checklist`, `groom`, `tag-version`, `release-version`, `list-skills`,
`audit security`, `audit performance`, `audit accessibility`,
`audit architecture`, `audit dependencies`) are one-shot regardless
of chain mode.

`audit <axis>` is dispatched as a two-token phase: the router reads
`phases/audit-<axis>.md`. Five axes are wired (`security`,
`performance`, `accessibility`, `architecture`, `dependencies`). The
accessibility phase is FE-gated — projects without front-end source
receive a one-line "skipped — no FE surface" response instead of an
empty report. The dependencies phase aborts with "skipped — no
dependency manifest detected" when zero recognised manifests are
present. The architecture phase is always-on (universal applicability);
axes that don't match the codebase's structure go to "Out of scope" in
the report rather than skipping the whole run.

## Routing

1. **Read** the phase reference file (`phases/<phase>.md`) for the requested phase using the `Read` tool.
2. **Substitute** the stripped phase arguments for the phase's input.
3. **Execute** the procedure in the reference file end-to-end.
4. **Decide whether to chain** (see "Chain decision" below).

Unknown phase → print the phase index and stop.

## Chain decision

After the phase procedure completes successfully:

- `CHAIN_MODE == off` (the user passed `--manual`) → stop. Report the
  phase outcome and leave the next step to the user.
- Phase is not in the chainable list (e.g. `constitution`, `checklist`,
  `groom`, `tag-version`, `release-version`) → stop.
- `CHAIN_MODE == once` → stop.
- `CHAIN_MODE == continue` → read `phases/auto-chain.md` and chain
  through the remaining phases regardless of downstream-artefact state.
- `CHAIN_MODE == auto` (the default) → read `phases/auto-chain.md`. For
  `brainstorm` and `specify`, the chain always continues. For any other
  chainable phase, apply the artefact-detection table in that file — chain
  if downstream artefacts are absent, one-shot if present.

## Workflow overview

```
(brainstorm) → specify → clarify → plan → tasks → analyze → implement → review → merge
    ▲                                                                              ▲
    optional step 0 — only when the idea is still fuzzy            STOP for pre-merge validation
```

Default behavior: `/specflow specify "..."` runs the entire chain in one
session, pausing only at STOP #1 (if clarifications are needed) and
STOP #2 (pre-merge confirmation). See `phases/auto-chain.md` for the
chain mechanics.

`brainstorm` is an **optional front-end**: when the user doesn't yet have a
clear enough idea to spec, `/specflow brainstorm "<rough idea>"` runs a
discovery dialogue (one question at a time, 2–3 approaches, design approval)
and then chains into `specify` with the agreed brief. When the brief is
already clear, start at `/specflow specify` and skip it.

`constitution`, `checklist`, `groom`, `tag-version`, `release-version`, `list-skills`, and `audit <axis>` (any of `security`, `performance`, `accessibility`, `architecture`, `dependencies`) are out-of-band utilities, not part of the linear flow.

## Typical flow

When the idea is still fuzzy, start one phase earlier:

```
/specflow brainstorm "let users monitor agent runs from their phone"
  → discovery dialogue (one question at a time, 2–3 approaches, design approval)
  → on approval, auto-chains into /specflow specify with the agreed brief
```

When the brief is already clear, start at `specify`:

```
/specflow specify "Add OAuth2 login"
  → drafts the spec, then auto-chains:
    → /specflow clarify  (STOP #1 only if [NEEDS CLARIFICATION] markers remain)
    → /specflow plan
    → /specflow tasks
    → /specflow analyze
    → /specflow implement
    → /specflow review
    → STOP #2 — summary + "Ready to merge?" confirmation
    → /specflow merge  (on "yes")
```

To run a single phase only (no chain), pass `--manual`:

```
/specflow specify --manual "Add OAuth2 login"
```

To force or skip the chain mid-flow:

```
/specflow plan 042 --once       # regenerate plan.md only, do not cascade
/specflow plan 042 --continue   # regenerate plan.md AND cascade tasks → review
```

To opt in or out of the **lite chain** (skip `clarify` and `tasks` —
calibrated for small single-file features like markdown docs, README
tweaks, agent definitions):

```
/specflow specify --lite "Document the OSS/proprio boundary in AGENTS.md"
/specflow specify --full "Add OAuth2 login"   # opt out of auto-detected lite
```

Without an explicit flag, `phases/specify.md` scores the brief
against `phases/lite-heuristic.md` and either prompts the user once or
commits to a shape silently. See `phases/auto-chain.md` for how the
chain sequence adapts to the chosen shape.
