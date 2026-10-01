# Auto-chain control

This file carries the chain mechanics the `/specnaut` router follows after a chainable phase
(`plan`, `tasks`, `implement`, `review`) completes — unless `--manual` was passed, or downstream
artefacts indicate the user is re-running a single step.

## The flow

```
plan → tasks → implement → review → merge → push
  ▲                                   ▲
  STOP 1                              STOP 2
  (always, at the end of plan)        (only under merge: manual)
```

## Autopilot is the default. There is ONE stop, and a second only on request.

1. **The end of `plan`.** Always — `phases/plan.md` step 8. **This is where the work is decided**;
   after it, the chain runs to a merged, pushed base branch without asking again.
2. **The review verdict — only under `manual`.** The merge mode is read **here and nowhere
   else**, per-run instruction first: `--manual-merge`, or "stop before merging" / "do not push",
   means `manual`; "merge it" means `auto`. Otherwise the project file decides:

   ```
   v=$(sed -n 's/^merge:[[:space:]]*\([^[:space:]#]*\).*/\1/p' .specnaut/workflow.yml 2>/dev/null | head -1)
   case "$v" in ""|auto) echo auto ;; manual) echo manual ;; *) echo "manual (unrecognised: $v)" ;; esac
   ```

   No file or no key means `auto`. An unrecognised value means `manual` — say so in one line: a
   setting that cannot be read resolves to the reading that does not push.

   - **`auto`** — no stop. A verdict with no unresolved CRITICAL or HIGH finding invokes `merge`
     in the same turn; `merge` pushes and closes.
   - **`manual`** — STOP 2: the verdict is triaged, then the merge is requested, once. That answer
     covers the merge, the push and the close.

Autopilot still halts, and says why: an unresolved CRITICAL/HIGH, a FAIL verdict, a missing review
seat, a merge that cannot fast-forward, a refused push. Those are failures, not stops.

## ⛔ NEVER stop at a boundary that is not one of these

It applies to **every** hand-off in the chain, not just one:

| Boundary | What happens |
| :--- | :--- |
| user answers the last question at STOP 1 → `tasks` | invoked in the same turn |
| `tasks` commits the breakdown → `implement` | invoked in the same turn |
| gates green, tree frozen → `review` | invoked in the same turn |
| `review` verdict, nothing CRITICAL/HIGH left → `merge` | same turn (`auto`) · **STOP 2** (`manual`) |
| `merge` lands on the base branch → push | pushed, never asked |

No question, no proposal, no menu, at any of those arrows.

None of these is a reason to stop, and each one gets used as one:

| The excuse | Why it is not a reason |
| :--- | :--- |
| "That's a lot of tasks — confirm first?" | The size was known when the chain started. The user chose the work at STOP 1. |
| "MVP only, or the whole thing?" | The plan states both. Build the full path; the MVP is a checkpoint inside it, not a fork to offer. |
| "This is where the real code gets written." | Yes. That is the point of the chain. |
| "The audits found a lot — re-confirm scope?" | The findings were folded into the plan and the plan was approved. That approval covers what the plan now says. |
| "The user has been checkpointing each step." | Answering a question is not a request to be asked another one. |
| "Someone should read the diff first." | Then the project sets `merge: manual`. |

Asking again after STOP 1 **re-litigates a decision the user already made**, and it costs them the
thing the chain exists to give: they approve an architecture once, and get an implemented, reviewed
branch back. A chain that halts at every phase boundary is a slower manual workflow wearing a
skill's name.

## Per-phase behavior

After each phase completes successfully, **invoke the next phase yourself, in the same turn**, via
the `Skill` tool (or the platform equivalent). Not a suggestion, not a command printed for the user
to paste — your own next action. A one-line `✓ <phase> complete — proceeding to <next>` log is
sufficient, and it is a **statement, never a question**.

| Current phase | Next |
|---|---|
| `plan` | `tasks` — invoked in the same turn as the user's last answer at STOP 1 |
| `tasks` | `implement` — invoked in the same turn as the dossier commit |
| `implement` | `review` — invoked in the same turn the gates go green and the tree is frozen |
| `review` | `merge` — same turn (`auto`) · **STOP 2** — triage, then the merge request (`manual`) |

## Plan approval checkpoint (remote mode only)

After `plan` completes and **before** chaining into `tasks`, check remote mode
(`specnaut gate status`):

- **Exit 0** (remote on) — raise a plan-approval gate and suspend:
  `specnaut gate raise --type plan_approval --title "Approve the plan for <feature>" --payload '{"summary":"<plan summary>","planRef":"<plan.md path>","context":"<short>"}'`.
  exit 0 + `{"approved":true}` → resume into `tasks`; exit 0 + `{"approved":false}` → halt and
  report the rejection + any `note`; exit 3/4/1 → halt cleanly with the reason; exit 5 → report
  `specnaut cloud login` is needed and fall back to the default below. **Never proceed to `tasks`
  without an explicit approval.**
- **Non-zero** (remote off / not Cloud-linked — the default) — STOP 1 is the local approval and the
  chain continues straight into `tasks`.

## The review verdict — STOP 2 under `manual`, a report under `auto`

After `review` completes, present a compact summary:

- Feature name and branch
- Files created / modified (count + key paths)
- Tests added and full-suite status
- Known deviations from `tasks.md` and the rationale
- Open risks / deferred findings
- One-line business outcome

Under `auto` with remote mode off it is a statement, not a question: invoke `merge` right after
it. Otherwise resolve the approval — **remote mode keeps its gate under either mode**:

- **Remote mode** (`specnaut gate status` exit 0) — raise a `merge_approval` gate instead of a
  terminal prompt:
  `specnaut gate raise --type merge_approval --title "Approve merge of <feature>" --payload '{"summary":"<change summary>","prUrl":"<pr/diff ref>","context":"<short>"}'`.
  exit 0 + `{"approved":true}` → invoke `merge`; exit 0 + `{"approved":false}` → halt on the branch
  and report the rejection + any `note`; exit 3/4 (timeout/cancelled) or 1 → halt cleanly with the
  reason; exit 5 → report `specnaut cloud login` is needed and fall back to the local prompt below.
  **Never merge without an explicit approval.**
- **Local mode, `manual`** — ask once: "Ready to merge? (yes to run `/specnaut merge`, no to stay on
  the branch)". On "yes", invoke `merge`.

### Triage, and the rule that ends the loop

**Only a CRITICAL or HIGH finding buys another fix cycle.** MEDIUM and LOW go to the backlog and the
branch ships.

Those fix cycles run **before** the merge, under either mode. Do not ask between rounds — the user
asked for a working branch, not for a vote on every round.

A reviewer reports **harm, not labels**: sort each finding into *"would hurt a user, a maintainer,
or the data if shipped"* versus *"should be better"*, and choose by the harm rather than the
severity word. **"Nothing here would hurt anyone" is a valid and valuable verdict**, not a failure
to find things.

Justifying another round with "the last one found something" is not a reason — it is always true,
and **a loop with no exit criterion does not terminate**. Two habits produce the runaway: treating a
severity as a label to be cleared rather than asking what harm it describes, and re-reviewing
because the previous review was not empty.

After merge, the chain ends.

## Re-entry, without a flag

When the user invokes a phase directly (`/specnaut implement`, `/specnaut review`), decide from what
is on disk:

- **Downstream artefacts missing** → chain. The user is resuming an interrupted flow (a long
  session, a fresh shell after compaction). Continue through the remaining phases.
- **Downstream artefacts present** → one-shot. The user is re-running a single phase (regenerating
  `plan.md` after a tweak).

"Downstream artefacts" means files under the feature directory produced by phases **after** the one
being invoked:

| Invoked phase | Downstream artefacts to check |
|---|---|
| `plan` | `tasks.md` |
| `tasks` | any task in `tasks.md` marked done |
| `implement` | the branch already merged into the base branch, or task completion past 50% |
| `review` | nothing past review (the chain tail is just `merge`) — treat as one-shot |

## Failure handling

- Hard failure in `tasks`, `implement` or `review`: stop, surface the error, ask how to proceed. Do not silently retry.
- Task-level blockers reported during `implement`: that phase has its own fix loop; do not
  intercept.
- **Genuinely blocked is not the same as stopped.** If something truly blocks part of the work, say
  what is blocked in one or two sentences, implement everything that is not blocked, and name the
  remainder. Stopping with nothing built is reserved for the case where proceeding under any
  assumption would be unsafe or would make the work useless if wrong.

## Context budget

Long features (≥13 story points or ≥30 tasks) may exhaust context during `implement`. If compaction
occurs mid-chain, say so and let the user resume from a fresh session — the re-entry detection above
picks up where the previous run stopped.

## Orphan spec detection — the chain, inspected at rest

The flow above is a chain moving forward in one session. This check reads the same chain across the
project at rest, and names the phase each stalled feature is missing. It reads spec artefacts and
prescribes specnaut phases, so it lives here rather than in `groom`.

Run it when asked to audit the spec pipeline, and from a grooming pass when the project keeps specs
locally — `board/groom.md` step 4 is the caller, under the same `.specnaut/specs/` condition.

Walk `.specnaut/specs/` (if present) and surface any feature directory
that is missing the next expected artefact.

**Current-pipeline artefacts** — a 3.x feature produces these in this order:

- Has `plan.md` but no `tasks.md` → flag as "needs `/specnaut tasks`".
- Has `tasks.md` but no `installed` markers in commits → flag as
  "needs `/specnaut implement`".

**Legacy, pre-3.x only** — kept deliberately, not an oversight:

- Has `spec.md` but no `plan.md` → flag as "needs `/specnaut plan`".

  **3.x writes no `spec.md`.** The artefact was removed in 2.0.0 and no phase
  produces one, so this rule can only ever match a feature directory left
  behind by a 1.x project — one that never shipped, so no merge ever removed
  it. It stays because a pre-migration spec that never got a plan is exactly
  the thing worth surfacing. Do not read it as
  evidence that the current pipeline emits `spec.md`, and do not delete it as
  dead code — `tests/templates/removed_artefacts_test.ts` carries a matching
  allowlist entry recording the same decision.

This is also read-only; never delete or modify spec files. A shipped feature's
directory IS removed — by `phases/merge-close.md` step 8, at the merge, under
the same authorisation that closed the issue and with the plan in git history.
Different actor, different moment, and it holds the authorisation this pass
does not have. A reporter that edits what it walks has no way to be trusted
about what it found.
