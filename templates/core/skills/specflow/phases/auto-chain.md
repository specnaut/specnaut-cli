# Auto-chain control

This file carries the chain mechanics that the `/specflow` router follows
when chain mode is engaged. The router reads it after a chainable phase
(`specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`, `review`)
completes — unless `--manual` or `--once` was passed, or downstream
artefacts indicate one-shot intent.

## Default flow

```
specify → clarify → plan → tasks → analyze → implement → review → merge
          ▲                                                        ▲
          STOP #1 (only if clarifications needed)                  STOP #2 (pre-merge validation)
```

## Per-phase behavior

After each phase completes successfully, immediately invoke the next phase via
the `Skill` tool (or the platform equivalent). Do not emit a user-facing "ready
for next step?" prompt. A one-line `✓ <phase> complete — proceeding to <next>`
log is sufficient.

## STOP #1 — Clarification checkpoint

After `/specflow clarify` finishes:

- If zero `[NEEDS CLARIFICATION]` markers remain in `spec.md`, continue silently
  to `/specflow plan`.
- If markers remain, present the top 3 questions to the user (per the
  `/specflow clarify` format) and wait for answers. Once the spec is updated,
  resume the chain automatically.

## Silent gates

These phases run without user interruption unless they fail hard or surface
CRITICAL findings:

- `/specflow plan` — generates plan + research + data-model + contracts + quickstart.
- `/specflow tasks` — generates tasks.md.
- `/specflow analyze` — cross-artifact consistency check. On LOW/MEDIUM findings,
  log a summary and continue. On CRITICAL findings, stop and surface them.
- `/specflow implement` — runs the developer → review-coordinator → qa-tester
  pipeline. Has its own internal fix loop for review findings; do not intercept.
- `/specflow review` — final quality scan.

## STOP #2 — Pre-merge validation

After `/specflow review` passes, ALWAYS stop and present a compact summary
before invoking `/specflow merge`. The summary must include:

- Feature name and branch
- Files created / modified (count + key paths)
- Tests added and full-suite status
- Known deviations from tasks.md and rationale
- Open risks / deferred items
- One-line business outcome

Then ask explicitly: "Ready to merge? (yes to run /specflow merge, no to stay on
the branch)". Wait for explicit confirmation. On "yes", invoke
`/specflow merge`. After merge, the chain ends.

## Mid-chain re-entry

When the user invokes any phase other than `specify` directly (e.g.
`/specflow plan 042`, `/specflow implement 042`), apply this
context-aware default:

- **Downstream artefacts missing** → chain. The user is resuming an
  interrupted flow (long session, fresh shell after compaction, manual
  review between early phases). Continue through the remaining phases →
  STOP #2 with the same checkpoints as the entry-point flow.
- **Downstream artefacts present** → one-shot. The user is re-running a
  single phase (regenerate `plan.md` after a tweak, re-analyse after a
  spec edit). Do NOT cascade.

"Downstream artefacts" means files under `.specflow/specs/<feature>/`
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
  `/specflow clarify` quota; the rest can be asked later.

## Context budget

Long features (≥13 story points or ≥30 tasks) may exhaust context during
`/specflow implement`. If compaction occurs mid-chain, inform the user and
let them resume from a fresh session — the artefact-detection default
above will pick up where the previous run stopped, or they can pass
`--continue` explicitly.
