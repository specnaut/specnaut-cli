---
name: specnaut
description: Specnaut workflow router — entry point for the spec-driven pipeline. `/specnaut <phase> [args]` dispatches to a single phase (plan, tasks, implement, review, merge, constitution, audit). `/specnaut` with no args prints the workflow overview.
argument-hint: <plan|tasks|implement|review|merge|constitution|audit> [args]
when_to_use: |
  Trigger phrases that should route here:
  - plan: "plan a feature", "spec out a feature", "write a spec", "build a technical plan", "I have a rough idea", "help me figure out what to build", "I don't know exactly what I want yet", "clarify requirements"
  - tasks: "generate tasks", "break down the plan"
  - implement: "implement the feature", "start coding"
  - review: "review the implementation", "run quality gates"
  - merge: "merge the branch", "ship the feature"
  - constitution: "update the constitution", "edit project rules"
  - audit: "audit security / performance / accessibility / architecture / dependencies", "scan the codebase for X issues"
---

# Specnaut router

**Response style** — brevity, visual order, questions as selections, badge colours — follows the `response-style-contract` skill; read it, never restate it here.

`$ARGUMENTS` carries the user's input. Parse it as `[--manual] <phase> [rest]`:

1. **Chain mode parsing** — scan the tokens for `--manual`. It is the only chain flag.
   - `--manual` present → CHAIN_MODE = `off` (run this one phase, then stop)
   - absent → CHAIN_MODE = `auto` (the default)

   Strip it from the token list before going further.

2. **Phase extraction** — the first remaining token is the phase name. Everything after the first
   whitespace is the argument string for that phase.

   **Compound `audit` phase exception** — when the first token is exactly `audit` AND the next token
   is one of `security`, `performance`, `accessibility`, `architecture`, or `dependencies`, treat
   the pair as a single hyphenated phase name `audit-<axis>` (matching `phases/audit-<axis>.md`).
   The remaining tokens become the argument string. Users may also invoke the hyphenated form
   directly (`/specnaut audit-security`); both forms route to the same phase doc.

3. **Empty arguments** — if no tokens remain after flag parsing (or `$ARGUMENTS` was empty to start
   with), render the **Workflow overview** below and stop. Do not pick a phase yourself.

## Phase index

| Phase | Reference | One-liner |
|-------|-----------|-----------|
| `plan` | `phases/plan.md` | The feature's **one** document: why, scenarios, requirements, criteria, the binding decision table, constitution check, surfaces, risks — then a mandatory architecture **and** security audit of the plan itself, then the stop. |
| `tasks` | `phases/tasks.md` | The dependency-ordered breakdown, derived from the **approved** plan. |
| `implement` | `phases/implement.md` | Build it. Ends by invoking `review` — an implementation not through review is not finished. |
| `review` | `phases/review.md` | The quality battery on a frozen tree. Its verdict is the merge request. |
| `merge` | `phases/merge.md` | Pre-merge validation and merge the feature branch. |
| `constitution` | `phases/constitution.md` | Edit the project's `constitution.md` rules. |
| `audit security` | `phases/audit-security.md` | Read-only project-wide security sweep; emits a findings report. |
| `audit performance` | `phases/audit-performance.md` | Read-only project-wide performance sweep; emits a findings report. |
| `audit accessibility` | `phases/audit-accessibility.md` | Read-only project-wide WCAG 2.1 AA sweep; skips when no FE surface is detected. |
| `audit architecture` | `phases/audit-architecture.md` | Read-only project-wide architectural sweep — hex-layer violations, circular deps, god files, bounded-context leaks. |
| `audit dependencies` | `phases/audit-dependencies.md` | Read-only multi-manifest dependency-hygiene sweep. |

## Which skill owns what

Specnaut gives a project **three** skills, and they divide by what they own:

| Skill | Owns |
| :--- | :--- |
| `/board` | the backlog — what we might do, and what we are doing |
| `/specnaut` | the specification — what a thing is, and whether it is built right |
| `/ship` | production — getting a built thing out the door |

`/specnaut` owns the **specification** phases tied to the project, and code
implementation, planning and review. It does **not** own going to production:
tagging a version and publishing a release are `/ship`. Shipping has a
different cadence, a different risk profile — irreversible, outward-facing, it
triggers live pipelines — and a different audience from writing a plan.

The line decides where a new capability lands, not where a file happens to sit
today. Grooming is backlog management, so it is reached only as `/board
groom` — this router does not carry a `groom` verb at all. Orphan
spec detection sits on this side and lives in `phases/auto-chain.md`, because it
reads spec artefacts and prescribes specnaut phases.

`phases/plan-audits.md`, `phases/merge-squash.md`, `phases/epic-commits.md`,
`phases/quality-gates.md`, `phases/epic-fixups.md`, `phases/merge-close.md`,
`phases/epic-loop.md` and `phases/auto-chain.md` are **contract docs, not routable phases** — `plan` loads the first at its
step 6, `merge` loads the second at its step 4, `implement` loads the third when the item is an epic,
`implement` and `merge` share the fourth, `merge` loads the fifth before an epic merge and the sixth
after any push, `implement` loads the seventh on an epic, and the router loads the eighth when it
chains. Naming any of them as a phase prints the index and stops.

Chainable phases are: `plan`, `tasks`, `implement`, `review`. The others (`merge`, `constitution`,
`audit <axis>`) are one-shot regardless of chain mode.

The accessibility phase is FE-gated — projects without front-end source receive a one-line "skipped
— no FE surface" response instead of an empty report. The dependencies phase aborts with "skipped —
no dependency manifest detected" when zero recognised manifests are present. The architecture phase
is always-on; axes that don't match the codebase's structure go to "Out of scope" in the report
rather than skipping the whole run.

## Removed phases — this is deliberate, not a gap

`brainstorm`, `specify`, `clarify` and `analyze` **no longer exist**, and neither do `checklist` and
`list-skills`. If the user names one, print this phase index and stop — do not improvise the old
behaviour, and do not route it silently.

**`tag-version` and `release-version` are RETIRED, not unknown — they moved to
`/ship`.** If the user names either, say so and name the new address:

> Release concerns moved out of `/specnaut` and into `/ship`.
> `tag-version` → `/ship tag` · `release-version` → `/ship release`

Then stop. Do not route it silently, and do not print a bare "unknown phase" —
that reads as a bug to someone following an instruction written before the
split, which is exactly who arrives here.

| Gone | Where its work happens now |
|------|----------------------------|
| `brainstorm` | `plan`, step 1 — the discovery dialogue when the input is too fuzzy to plan. |
| `specify` | `plan` — the same document, sections 1–4. |
| `clarify` | `plan`, step 8 — questions asked at the stop, before any code exists. |
| `analyze` | Replaced, not moved. With one document there are no artefacts to hold in agreement; the plan-time architecture and security audits are its successor and run *before* the code. |
| `checklist` | `plan`'s success criteria and decision table. |
| `list-skills` | `.specnaut/installed.lock` is readable directly. |

## Routing

1. **Read** the phase reference file (`phases/<phase>.md`) for the requested phase using the `Read`
   tool.
2. **Substitute** the stripped phase arguments for the phase's input.
3. **Execute** the procedure in the reference file end-to-end.
4. **Decide whether to chain** (see below).

Unknown phase → print the phase index and stop.

## Chain decision

After the phase procedure completes successfully:

- `CHAIN_MODE == off` (the user passed `--manual`) → stop. Report the phase outcome.
- Phase is not chainable (`merge`, `constitution`, `audit <axis>`) → stop.
- Otherwise → read `phases/auto-chain.md` and follow it.

**Re-entry needs no flag.** Invoking a phase whose downstream artefacts already exist runs one-shot
— the user is re-running a single step. Invoking one whose downstream artefacts are absent chains —
the user is resuming an interrupted flow. `phases/auto-chain.md` holds the detection table.

## Workflow overview

```
plan → tasks → implement → review → merge
  ▲                          │        ▲
  │                          └────────┘
  │                     review is implement's
  │                     mandatory last act
  │
  └── discovery (if fuzzy) → the one document
      → architecture + security audit OF THE PLAN
      → STOP 1
```

**There are exactly two stops in this chain**, and no third:

1. **The end of `plan`** — the architecture is presented with its alternatives, both audits' findings
   are presented separately, and the open questions are asked. Always.
2. **The review verdict** — which *is* the merge request. There is no separate pre-merge stop.

Every other boundary is crossed by invoking the next phase yourself, in the same turn. See
`phases/auto-chain.md`.

## Typical flow

```
/specnaut plan "Add OAuth2 login"
  → discovery dialogue only if the brief is too fuzzy to plan
  → writes plan.md (one document)
  → architecture + security audits run concurrently on the plan
  → STOP 1 — architecture proposal, audit findings, the open questions
  → /specnaut tasks       (same turn as the last answer)
  → /specnaut implement   (same turn)
  → /specnaut review      (same turn)
  → STOP 2 — verdict + "ready to merge?"
  → /specnaut merge       (on approval, or immediately if merge was already asked for)
```

To run a single phase only:

```
/specnaut plan --manual "Add OAuth2 login"
```
