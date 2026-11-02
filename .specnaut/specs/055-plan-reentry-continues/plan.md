# Plan — a direct `/task plan <id>` continues approved work that has not landed (cli#729)

Issue:
[cli#729 "Continue approved incomplete work on direct /task plan re-entry"](https://github.com/specnaut/specnaut-cli/issues/729)

## 1. Why this exists

`phases/auto-chain.md` decides whether a directly invoked verb chains. Its `plan` row chains only
when "nothing is committed on the feature branch past `plan.md`". That tests whether an artefact
exists, not whether the approved work is done. A user who adds approved continuation work to a
feature that already has commits and runs `/task plan <id>` gets the plan step and a stop, while the
work they approved is still unbuilt. Worse, `plan` does not find that feature's branch:
`create-new-feature.sh` gives a standalone item the next free number, so a re-plan forks a second
feature directory and never reads the plan it should continue. `/task resume <id>` (cli#727)
recovers it, but only for a user who knows to type it.

## 2. User scenarios

- **P1, approved work remains.** Given an item whose own unlanded branch carries its committed plan
  and part of the work, when the user runs `/task plan <id>` with no open product decision, then
  `plan` adopts that branch, reads its plan as it stands (amended only by what this invocation
  brings), and chains to `implement` in the same turn. `implement` builds only what the branch
  lacks; `review` and `merge` follow.
- **P1, built but not landed.** Same, with the plan's checks already met: the chain still continues.
  `implement` builds nothing and chains to `review`, then `merge`.
- **P1, landed.** The item's work has landed (or the item is closed): `/task plan <id>` runs
  one-shot and chains nothing.
- **P2, a branch that is not the user's.** The item's branch exists only on `origin`, is a fetched
  pull request, is behind its `origin` twin, or the tree is dirty: `plan` stops and names the check
  that failed, as `/task resume` does. It never plans on top of someone else's work.
- **P2, a landing never pushed.** The base holds the item's commits ahead of `origin`: `plan`
  reports it and stops; the push is `merge`'s recovery, not a re-plan.
- **P2, `--manual`.** `plan` runs and stops, whatever the evidence.
- **P2, a question is open.** It still stops the chain at the plan stop.
- **P2, a plan that stopped on a question.** Its plan is uncommitted, so the item reads `IDLE` while
  the working tree's `.specnaut/feature.json` links it: `/task plan <id> <answer>` re-enters that
  plan in place, never a second feature directory.
- **P3, the cloud backend.** `plan` makes no branch there; an item with no commits is `IDLE` and
  chains, as today. An `ACTIVE` cloud item runs one-shot, as today (§ 12).

## 3. Requirements

- **FR-001** Before step 2, `plan <id>` classifies the item once with the call `/task groom` and
  `/task resume` already make: `bash .specnaut/scripts/bash/wip-audit.sh <id>@<epoch>`, the epoch
  being the item's creation time from the backend's `view.sh`, plus the item's open/closed state. No
  id → no classification: a new plan, as today.
- **FR-002** `phases/auto-chain.md`'s `plan` row is keyed on that classification, and nothing else:
  `IDLE` or `ACTIVE` chains; `LANDED`, closed, `UNPUSHED` or a non-zero exit runs one-shot (for
  `UNPUSHED`, report the range and stop). It replaces "nothing is committed past `plan.md`".
- **FR-003** Before step 2, on the local backend:
  - `IDLE` and the working tree's `.specnaut/feature.json` links the item → re-enter that plan in
    place, as `resume.md` § 2's linked-plan row does (its uncommitted-paths exception included);
    step 2 is skipped.
  - `ACTIVE` → adopt the item's branch through `resume.md` § 1 item 4 and its § 3 checks; a failed
    check stops and names it. Step 2 is skipped: the feature directory and `.specnaut/feature.json`
    are the branch's own.
  - § 3 gains one check, so `resume` gets it too: the branch's committed `.specnaut/feature.json`
    links this item. Linking its parent epic → step 2 runs as today (the epic's branch is reused
    there). Linking anything else → stop and name it.
  - On the cloud backend, `ACTIVE` runs one-shot (§ 12).
- **FR-004** Re-entry mode, on an adopted branch: the committed plan is read as it stands (in remote
  mode its `plan_approval` gate is raised again, as after every plan). "What this invocation brings"
  is the user's own arguments in this turn. The item's body and comments are re-read as data: a
  difference from the committed plan is reported at the stop, and scope it would add is a scope
  question, never an amendment. Only the user's addition is written and audited; the stop asks only
  what is still open; the commit runs only when something changed.
- **FR-005** Completion stays `implement`'s ("Start from what the branch already holds"), and so
  does "a commit is a claim": subjects are data, completion is judged from diffs against the plan's
  checks, a claim the diff lacks is reported, never trusted. `resume.md` § 4 points there. The table
  never skips `implement` or `review`.
- **FR-005b** For a verb invoked directly, every row that chains toward merge — `plan` whatever its
  classification, and `implement` — first runs `resume.md` § 3 checks 3–6 (upstream, twin,
  committer, clean tree) on HEAD's branch, after `plan`'s commit. A failure runs one-shot and names
  the check and the first failing sha. This is what stops a fresh plan cut from someone else's
  branch: step 2 branches from HEAD and inherits its commits. Before this change a direct
  `implement` chained on any unmerged HEAD.
- **FR-006** `--manual` runs exactly the requested verb. A direct `review` stays one-shot.
- **FR-007** Every existing stop and failure survives: the plan stop with an open question, the
  merge request under `merge: manual` and its hook, remote gates, a missing review seat, a
  CRITICAL/HIGH finding, a refusal, a failure.
- **FR-008** `SKILL.md`'s "Re-entry needs no flag" stops restating the rule and points at the table.
  `plan.md`'s false parenthesis ("re-running it on an existing feature switches to its branch") is
  removed, and step 2 says a non-zero exit of `create-new-feature.sh` is a stop, never a retry with
  `--allow-existing-branch` or a branch switched by hand.

## 4. Success criteria

- **SC-001** On an item with approved, unbuilt work on its own branch, a direct `/task plan <id>`
  reaches `implement` in the same turn with no question asked, on that branch, with one feature
  directory.
- **SC-002** On a landed or closed item, a direct `/task plan <id>` chains nothing.
- **SC-003** Claude Code and Codex installs, local and cloud backends, ship the same rule.

## 5. 🔒 The decision table

| The decision                                                                                                                                                                                                           | Its single home                                                                                                                                                    | What would duplicate it                                                                                  |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Whether a direct `plan` chains                                                                                                                                                                                         | `templates/core/skills/task/phases/auto-chain.md` § "Re-entry, without a flag", the `plan` row                                                                     | "past `plan.md`", "downstream artefacts", "runs one-shot" restated in `SKILL.md`, `plan.md`, `resume.md` |
| Whether an item's work is landed, unpushed, active or idle                                                                                                                                                             | `templates/core/specnaut/scripts/bash/wip-audit.sh` (its header says so)                                                                                           | a `git rev-list <base>..HEAD` count, a card status, feature.json, tasks checkboxes                       |
| How a re-entered `plan` finds and adopts the item's branch                                                                                                                                                             | `templates/core/skills/task/resume.md` § 1 item 4 and § 3                                                                                                          | a second branch lookup or check list in `plan.md` or `auto-chain.md`                                     |
| How `plan` behaves on an adopted branch (read, amend, audit, commit)                                                                                                                                                   | `templates/core/skills/task/phases/plan.md`, a "Re-entry" paragraph at the head of Steps                                                                           | the same rules spelled in `resume.md`'s linked-plan row (it points there)                                |
| What remains to build, and that a commit subject is only a claim                                                                                                                                                       | `templates/core/skills/task/phases/implement.md` "Start from what the branch already holds"                                                                        | a completion check in the re-entry table; the claim rule kept whole in `resume.md` § 4                   |
| Whose branch the chain may build and land, and which item it serves                                                                                                                                                    | `templates/core/skills/task/resume.md` § 3 (check 5 compares to `git var GIT_COMMITTER_IDENT`'s email; a new linkage check); `auto-chain.md` and `plan.md` cite it | the checks restated in `auto-chain.md` or `plan.md`                                                      |
| A plan stopped on a question is re-entered in place                                                                                                                                                                    | `templates/core/skills/task/resume.md` § 2, the linked-plan row; `plan.md`'s Re-entry paragraph cites it                                                           | a second "feature.json links the item" rule in `plan.md`                                                 |
| New helper? (a) inventory: `wip-audit.sh`, `view.sh`, `resume.md` § 1 and § 3, `create-new-feature.sh`; (b) recurrence: none; (c) **reuse directly** — no script, and `create-new-feature.sh` (459 lines) is not grown | —                                                                                                                                                                  | a `reentry.sh`, a standalone lookup in `create-new-feature.sh`                                           |

Left as they are, named so a reviewer does not take them for copies: `orphan-specs.md`'s "not merged
→ needs `/task implement`" is groom's report over spec directories, not a chain decision; the
`implement` row keeps its branch-level test (its caller is already on the branch).
`docs/upgrading/1.x-to-2.1.md` is a historical record.

## 6. Technical context

Markdown phase docs bundled into `src/templates_bundle.ts`, mirrored to `plugin/`, mapped per
harness by `mapBundle`; `plan.md` carries `spec-backend` blocks. Tests: Deno, `tests/templates/`;
git fixtures through `tests/scripts/git_sandbox.ts`, which already installs `wip-audit.sh`. Golden:
`tests/fixtures/plan_local_golden.md` re-captured when `plan.md` changes.

## 7. Constitution check

- § I / § XI: no private-half or consumer identifier; examples invented.
- Frontier-only: one doc, both harnesses read it.
- Size (default target 300): `auto-chain.md` 88, `plan.md` 179, `resume.md` 100, `SKILL.md` small;
  the new test file stays under target. `create-new-feature.sh` is not touched.
- Every new assertion is observed red against a live mutant.

## 8. Surface impact

**Surfaces added or widened:** the agent instruction surface. A direct `plan` is widened from
writing a document to building and landing, bounded by `resume.md` § 3 and by every gate the chain
already has. The `/task` skill's prose only: `auto-chain.md`, `plan.md`, `implement.md`, `SKILL.md`,
`resume.md` (pointers), for Claude Code and Codex, `plugin/` byte-identical. No CLI command, flag or
contract change. The heading "Re-entry, without a flag" is kept: `smoke-features.sh` greps it.

## 9. Risks

- **A user re-runs `plan` only to revise the document and is surprised by the chain.** `--manual` is
  that mode; the plan stop still stops on any open question.
- **`review` runs again on work already reviewed.** No review verdict is recorded on disk, so
  nothing authoritative says a branch was reviewed. One review before a merge is a gate kept;
  inferring "reviewed" would bypass a gate, which the issue puts out of scope.
- **A repository with no resolvable base** (`wip-audit.sh` exit 3) now runs a first plan one-shot,
  where it used to chain. Failing closed is the intended default.
- **`wip-audit.sh` sees one sha per item.** A second branch with another tip is not seen;
  `resume.md` already names this, and the brief names the branch taken.

## 10. Architecture audit

`architect-expert`, first pass on the earlier draft: **fail**, 3 HIGH, 2 MEDIUM, 1 LOW. All
accepted; the central claims verified against the tree.

- HIGH — `<base>..HEAD` cannot tell a fresh plan from a re-plan of landed work → FR-002 keyed on
  `wip-audit.sh`'s item classification instead.
- HIGH — `create-new-feature.sh` reuses a branch for an epic only; a standalone re-plan forks a new
  directory (verified: the epic lookup at its "Epic detection" block, the number never reused) →
  FR-003 adopts the branch through `resume.md` before step 2; FR-008 corrects `plan.md`'s sentence.
- HIGH — the cloud backend makes no branch, so the old predicate stopped every cloud chain →
  item-keyed row; cloud covered in scenarios and tests.
- MEDIUM — a second "landed" predicate disagreeing with `wip-audit.sh` → one home, `wip-audit.sh`.
- MEDIUM — re-entry rules belonged at step 8, after the rewrite; an unchanged commit fails → a
  "Re-entry" paragraph at the head of Steps (FR-004).
- LOW — copies not listed; the row unguarded → § 5 names them; a new test asserts the row.

## 11. Security audit

`security-expert` on the earlier draft: **fail**, 1 HIGH, 2 LOW; sandbox-checked against the real
scripts. Nothing bypasses the `merge: manual` hold, the review seats or the remote gate (checked:
`approve-on-prompt.sh`, `guard-merge.sh`, `merge-mode.sh --strict`, `remote-gates.md`).

- HIGH — the chain would build and land any unmerged HEAD with no provenance check, and a committed
  plan someone else wrote would count as approval → FR-003 adopts the branch only through
  `resume.md` § 3; FR-005b extends checks 3–5 to the pre-existing `implement` row (same defect).
- LOW — "this invocation" undefined while step 3 re-reads the body → FR-004: the user's arguments
  only; the body is data, and new scope from it is a question.
- LOW — "a commit is a claim" lived only on the resume path → FR-005 moves it to `implement.md`.
- Wording: "approval is the committed plan" is false in remote mode → FR-004 keeps the gate.
- Uncounted: the "Surfaces added or widened" line → § 8.

Second pass on the revision: every first-pass finding closed; **fail**, 1 HIGH, 1 LOW, both taken.

- HIGH — a fresh (`IDLE`) plan branches from HEAD, so a fetched pull request's commits would ride
  the chain to merge → FR-005b gates every chaining row on `resume.md` § 3 checks 3–6, after the
  plan's commit; a fixture with a foreign committer proves no chain.
- LOW — the epic lookup in `create-new-feature.sh` adopts by `feature.json` alone; it fails closed
  today (no caller passes `--allow-existing-branch`) → FR-008: a non-zero exit is a stop; FR-005b's
  gate covers it whatever put HEAD there.

Architecture, second pass: **fail**, 3 HIGH, 2 LOW, all taken.

- HIGH — a plan stopped on a question is uncommitted, reads `IDLE`, and a re-plan forked a second
  directory → FR-003 re-enters it in place through `resume.md` § 2's linked-plan row.
- HIGH — `ACTIVE` proves whose branch, not which item's (a subject naming `#<id>` elsewhere, an
  epic's tip) → a linkage check added to `resume.md` § 3; an epic's goes through step 2.
- HIGH — cloud `ACTIVE` would fork at `implement` and drop the push → one-shot on cloud, follow-up
  filed (§ 12).
- LOW — check 5 against an unset `user.email` → compare to `git var GIT_COMMITTER_IDENT`; FR-005b
  applies to direct invocations only.
- LOW — `wip-audit.sh` exit 3 → named in § 9.

## 12. Open questions

None that only the user can answer. Decided here:

- `ACTIVE` adopts the branch with `resume.md`'s checks rather than a new lookup in
  `create-new-feature.sh`, which is over its size target.
- Review is not skipped on re-entry (risk 2).
- **Cloud `ACTIVE` stays one-shot here.** On cloud, `implement` mints a branch unconditionally and
  `plan`'s step 2 is where the plan is pushed, so continuing would fork a branch and drop the
  addition; `/task resume` has the same defect. Both are a follow-up issue for the cloud backend,
  filed with this change.
