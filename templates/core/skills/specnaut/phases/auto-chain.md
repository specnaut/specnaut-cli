# Auto-chain control

This file carries the chain mechanics that the `/specnaut` router follows
when chain mode is engaged. The router reads it after a chainable phase
(`brainstorm`, `specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`,
`review`) completes — unless `--manual` or `--once` was passed, or downstream
artefacts indicate one-shot intent.

## Default flow

```
(brainstorm) → specify → clarify → plan → tasks → analyze → implement → review → merge
                         ▲                                                        ▲
                         STOP #1 (only if clarifications needed)                  STOP #2 (pre-merge validation)
```

`brainstorm` is the optional step 0 (see `phases/brainstorm.md`). It runs
only when the user invokes `/specnaut brainstorm` because the idea is still
fuzzy; on design approval it always chains into `specify`, which then drives
the rest of the flow. Entering at `specify` skips it.

## Lite chain

For small, single-file features (markdown documentation, agent
definitions, README/AGENTS/CLAUDE/CHANGELOG tweaks), the chain runs in
a lighter shape that skips `clarify` and `tasks`:

```
specify → plan → analyze → implement → review → merge
                                                  ▲
                                                  STOP #2 (pre-merge validation)
```

STOP #1 (clarification checkpoint) is **n/a in lite mode** — no
`clarify` phase runs, so there are no `[NEEDS CLARIFICATION]` markers
to resolve mid-chain. The `phases/specify.md` procedure makes informed
guesses for ambiguities and notes them in the spec's Assumptions
section rather than blocking on user questions. STOP #2 behaves
identically to the full chain.

**Shape selection** happens once, in `phases/specify.md`:
- The router's `--lite` / `--full` flag (parsed in `SKILL.md` step 1)
  forces the shape and skips any heuristic / prompt.
- Otherwise, `phases/specify.md` scores the brief against
  `phases/lite-heuristic.md`. If the score crosses the threshold, the
  user is prompted once; if not, full chain runs silently.
- The chosen shape is persisted to `.specnaut/feature.json` as
  `workflow_shape: "lite" | "full"`.

At every chain transition below, read `workflow_shape` from
`.specnaut/feature.json`. When the field is absent (legacy
`feature.json`), treat as `"full"`.

## Per-phase behavior

After each phase completes successfully, immediately invoke the next phase via
the `Skill` tool (or the platform equivalent). Do not emit a user-facing "ready
for next step?" prompt. A one-line `✓ <phase> complete — proceeding to <next>`
log is sufficient.

The **next phase** depends on the chain shape recorded in
`.specnaut/feature.json` (`workflow_shape`):

| Current phase | Next (full) | Next (lite) |
|---|---|---|
| `brainstorm` | `specify`   | `specify`   |
| `specify`   | `clarify`   | `plan`      |
| `clarify`   | `plan`      | n/a (lite never runs clarify) |
| `plan`      | `tasks`     | `analyze`   |
| `tasks`     | `analyze`   | n/a (lite never runs tasks)   |
| `analyze`   | `implement` | `implement` |
| `implement` | `review`    | `review`    |
| `review`    | STOP #2 → `merge` | STOP #2 → `merge` |

When `workflow_shape` is absent from `feature.json`, treat as `"full"`.

## STOP #1 — Clarification checkpoint

Applies only when `workflow_shape == "full"`. Lite mode does not run
`clarify`, so there is no STOP #1 in lite chains.

After `/specnaut clarify` finishes:

- If zero `[NEEDS CLARIFICATION]` markers remain in `spec.md`, continue silently
  to `/specnaut plan`.
- If markers remain, present the top 3 questions to the user (per the
  `/specnaut clarify` format) and wait for answers. Once the spec is updated,
  resume the chain automatically.

## Silent gates

These phases run without user interruption unless they fail hard or surface
CRITICAL findings:

- `/specnaut plan` — generates plan + research + data-model + contracts + quickstart.
- `/specnaut tasks` — generates tasks.md.
- `/specnaut analyze` — cross-artifact consistency check. On LOW/MEDIUM findings,
  log a summary and continue. On CRITICAL findings, stop and surface them.
- `/specnaut implement` — runs the developer → review-coordinator → qa-tester
  pipeline. Has its own internal fix loop for review findings; do not intercept.
- `/specnaut review` — final quality scan.

## Plan approval checkpoint (remote mode only)

After `/specnaut plan` completes and **before** chaining into `/specnaut tasks`, check remote mode
(`specnaut gate status`):

- **Exit 0** (remote on) — raise a plan-approval gate and suspend:
  `specnaut gate raise --type plan_approval --title "Approve the plan for <feature>" --payload '{"summary":"<plan summary>","planRef":"<plan.md path>","context":"<short>"}'`.
  exit 0 + `{"approved":true}` → resume into `/specnaut tasks`; exit 0 +
  `{"approved":false}` → halt and report the rejection + any `note` (revise);
  exit 3/4/1 → halt cleanly with the reason; exit 5 → report `specnaut cloud login`
  is needed and fall back to the default below. **Never proceed to `tasks` without
  an explicit approval.**
- **Non-zero** (remote off / not Cloud-linked — the default) — `plan` stays a
  silent gate: continue straight to `/specnaut tasks` exactly as today (no gate,
  no prompt, no behavioural change).

## STOP #2 — Pre-merge validation

After `/specnaut review` passes, ALWAYS stop and present a compact summary
before invoking `/specnaut merge`. The summary must include:

- Feature name and branch
- Files created / modified (count + key paths)
- Tests added and full-suite status
- Known deviations from tasks.md and rationale
- Open risks / deferred items
- One-line business outcome

Then resolve the approval:

- **Remote mode** (run `specnaut gate status`; exit 0 ⇒ on) — raise a
  `merge_approval` gate instead of a terminal prompt:
  `specnaut gate raise --type merge_approval --title "Approve merge of <feature>" --payload '{"summary":"<change summary>","prUrl":"<pr/diff ref>","context":"<short>"}'`.
  Branch on the result: exit 0 + `{"approved":true}` → invoke `/specnaut merge`;
  exit 0 + `{"approved":false}` → halt on the branch and report the rejection +
  any `note` (comment-and-revise); exit 3/4 (timeout/cancelled) or 1 → halt
  cleanly with the reason; exit 5 → report `specnaut cloud login` is needed and
  fall back to the local prompt below. **Never merge without an explicit approval.**
- **Local mode** (default, gate status non-zero) — ask explicitly:
  "Ready to merge? (yes to run /specnaut merge, no to stay on the branch)". Wait for
  explicit confirmation. On "yes", invoke `/specnaut merge`.

After merge, the chain ends.

## Mid-chain re-entry

When the user invokes any phase other than `specify` directly (e.g.
`/specnaut plan 042`, `/specnaut implement 042`), apply this
context-aware default:

- **Downstream artefacts missing** → chain. The user is resuming an
  interrupted flow (long session, fresh shell after compaction, manual
  review between early phases). Continue through the remaining phases →
  STOP #2 with the same checkpoints as the entry-point flow.
- **Downstream artefacts present** → one-shot. The user is re-running a
  single phase (regenerate `plan.md` after a tweak, re-analyse after a
  spec edit). Do NOT cascade.

"Downstream artefacts" means files under `.specnaut/specs/<feature>/`
produced by phases AFTER the one being invoked:

| Invoked phase | Downstream artefacts to check |
|---|---|
| `clarify`   | `plan.md`, `tasks.md` |
| `plan`      | `tasks.md`, `data-model.md`, `contracts/`, `quickstart.md` |
| `tasks`     | `tasks.md` markings beyond the initial generation, or any task marked done |
| `analyze`   | nothing (analyze is a read-only gate; treat as one-shot unless `--continue`) |
| `implement` | a merged PR, a `review.md`, or task completion past 50% |
| `review`    | nothing past review (chain-tail is just `merge`); treat as one-shot unless `--continue` |

If any listed artefact is present, infer one-shot intent. If all are
absent, chain.

### Explicit overrides

The router-level flags `--continue` and `--once` override the
artefact-detection default. They are mutually exclusive with each other
and with `--manual`:

- `--continue` — force the chain regardless of artefact state. Useful
  when you want to regenerate a phase AND cascade downstream work
  afterwards (e.g. tweak `plan.md`, then re-run `tasks → analyze →
  implement → review` from scratch).
- `--once` — force one-shot regardless. Useful when downstream
  artefacts haven't been generated yet but you only want to run this
  single phase right now (e.g. inspect the spec before authorising
  the rest of the chain).

## Failure handling

- Hard failure in a silent gate (plan/tasks/analyze/implement/review): stop,
  surface the error, ask the user how to proceed. Do not silently retry.
- Task-level blockers reported by the developer agent during `implement`: the
  implement workflow has its own fix loop; do not intercept.
- `clarify` producing more than 5 questions: present the top 3 per the
  `/specnaut clarify` quota; the rest can be asked later.

## Context budget

Long features (≥13 story points or ≥30 tasks) may exhaust context during
`/specnaut implement`. If compaction occurs mid-chain, inform the user and
let them resume from a fresh session — the artefact-detection default
above will pick up where the previous run stopped, or they can pass
`--continue` explicitly.
