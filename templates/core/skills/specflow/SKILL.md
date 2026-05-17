---
name: specflow
description: Specflow workflow router — entry point for the spec-driven pipeline. `/specflow <phase> [args]` dispatches to a single phase (specify, clarify, plan, tasks, analyze, implement, review, merge, constitution, checklist, groom, tag-version, release-version, list-skills, audit). `/specflow` with no args prints the workflow overview.
argument-hint: <specify|clarify|plan|tasks|analyze|implement|review|merge|constitution|checklist|groom|tag-version|release-version|list-skills|audit> [args]
when_to_use: |
  Trigger phrases that should route here:
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
  - audit: "audit security / performance / accessibility", "scan the codebase for X issues"
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

2. **Phase extraction** — the first remaining token is the phase name.
   Everything after the first whitespace is the argument string for
   that phase.

   **Compound `audit` phase exception** — when the first token is exactly
   `audit` AND the next token is one of `security`, `performance`, or
   `accessibility`, treat the pair as a single hyphenated phase name
   `audit-<axis>` (matching the file `phases/audit-<axis>.md`). The
   remaining tokens after the axis become the argument string. Examples:
   `audit security` → phase `audit-security`, args ``; `audit security --severity medium` → phase `audit-security`, args `--severity medium`.
   Users may also invoke the hyphenated form directly
   (`/specflow audit-security`); both forms route to the same phase doc.

3. **Empty arguments** — if no tokens remain after flag parsing (or
   `$ARGUMENTS` was empty to start with), render the **Workflow overview**
   below and stop. Do not pick a phase yourself.

## Phase index

| Phase | Reference | One-liner |
|-------|-----------|-----------|
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

Chainable phases are: `specify`, `clarify`, `plan`, `tasks`, `analyze`,
`implement`, `review`. The others (`merge`, `constitution`,
`checklist`, `groom`, `tag-version`, `release-version`, `list-skills`,
`audit security`)
are one-shot regardless of chain mode.

`audit <axis>` is dispatched as a two-token phase: the router reads
`phases/audit-<axis>.md` (e.g. `phases/audit-security.md`). Today only
`security` is wired; `performance` and `accessibility` land in #304 / #305.
Until then, `/specflow audit performance` and `/specflow audit accessibility`
fall through to the unknown-phase branch.

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
  `specify`, the chain always continues. For any other chainable phase,
  apply the artefact-detection table in that file — chain if downstream
  artefacts are absent, one-shot if present.

## Workflow overview

```
specify → clarify → plan → tasks → analyze → implement → review → merge
                                                                    ▲
                                                          STOP for pre-merge validation
```

Default behavior: `/specflow specify "..."` runs the entire chain in one
session, pausing only at STOP #1 (if clarifications are needed) and
STOP #2 (pre-merge confirmation). See `phases/auto-chain.md` for the
chain mechanics.

`constitution`, `checklist`, `groom`, `tag-version`, `release-version`, `list-skills`, and `audit <axis>` are out-of-band utilities, not part of the linear flow.

## Typical flow

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
