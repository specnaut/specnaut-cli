# Plan — `/task resume <id>`: rebuild where a chain stopped, from git (cli#727)

Issue:
[cli#727 "Add a /task resume verb that rebuilds where a chain stopped from git, then re-enters it"](https://github.com/specnaut/specnaut-cli/issues/727)

## 1. Why this exists

A `/task` chain often stops partway: the context is compacted, a more urgent ask interrupts it, or
the session ends. The work survives on disk and in git. What is lost is **where the chain stopped**.
A fresh session rebuilds it from a summary or from the plan's prose. That is how a finished phase
runs twice and an unfinished one is skipped, and both look like progress while they happen.

`phases/epic-loop.md` already rebuilds an epic's progress from git, and `phases/auto-chain.md`
re-enters one verb from what is on disk. No entry point re-enters the chain as a whole.

## 2. User scenarios

- **P1, a task stopped mid-chain.** Given an item whose own local branch carries commits, when the
  user runs `/task resume <id>`, then resume reports where the chain stopped and re-enters
  `implement` on that branch in the same turn, without asking. `implement` builds what remains and
  chains to `review` and `merge` as usual.
- **P1, a plan written but not past its stop.** Given an item with no commit yet whose working tree
  links it in `.specnaut/feature.json`, when it is resumed, then resume re-enters `plan` at "The
  plan stop". That stop asks what is still open, or proceeds. It never rewrites the plan, and it
  never assumes approval.
- **P2, an epic.** Given an epic branch, resume re-enters `implement` there, and `epic-loop.md`
  picks the first child with no commit.
- **P2, not mine.** Given a branch that exists only on `origin`, a PR checkout, a branch behind its
  `origin` twin, or a dirty tree, resume stops, names what it found by sha, and never checks
  anything out.
- **P3, already done or half-landed.** For a closed item, an item that landed but is still open, or
  a landing that was never pushed, resume reports the sha and the recovery, then stops.

## 3. Requirements

- **FR-001** `/task resume <id>` and its alias `/task continue <id>` are documented in one file:
  `skills/task/resume.md`, beside `groom.md`, not under `phases/`.
  - `resume` reads no addendum and is not in `ROUTABLE_PHASES`.
  - It re-enters other verbs through the router's normal routing, which reads their addenda.
  - The bare `/task <id>` keeps showing the item; when the item is in progress, the show output
    points to `/task resume <id>`.
- **FR-002** Evidence comes from scripts and git only. Nothing comes from the item's body or
  comments.
  - **The id:** it must match `^[1-9][0-9]{0,9}$`, else stop.
  - **The item:** read only its state and creation time from the backend's `view.sh`.
  - **The evidence:** run `wip-audit.sh <id>@<epoch>`, the same form groom passes.
  - **The candidate branch, for `ACTIVE`:**
    `git for-each-ref --points-at <sha> --format='%(refname)' refs/heads`.
  - **The working tree:** its `.specnaut/feature.json` and `git status --porcelain`.
- **FR-003** **One table, in `resume.md`. The first matching row decides:**

  | Evidence                                                           | Re-enter at                                                                                                                                  |
  | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
  | the id is malformed, or `wip-audit.sh` exits anything but `0`      | nothing: report it and stop                                                                                                                  |
  | the item is closed                                                 | nothing: name the `LANDED` sha (or "closed without a landing commit") and stop                                                               |
  | `UNPUSHED`                                                         | nothing: list `origin/<base>..<base>` (sha and whether each names `#<id>`), point at `merge.md`'s refused-push recovery, and stop            |
  | `LANDED`, item open                                                | nothing: name the sha and stop. It may be a delivery across several branches; settling it is `/task close <id>` or the next branch's `merge` |
  | `IDLE`, the working tree's `.specnaut/feature.json` links the item | `plan`, at "The plan stop", reading the plan as it stands                                                                                    |
  | `IDLE`                                                             | `plan <id>`                                                                                                                                  |
  | `ACTIVE`, the provenance gate fails                                | nothing: name the sha and which check failed, and stop                                                                                       |
  | `ACTIVE`, the gate passes                                          | check out the branch, then `implement`                                                                                                       |
- **FR-004** **The provenance gate.** Every check runs before any checkout, and every failure stops
  resume:
  1. Exactly one ref under `refs/heads` points at the sha. If none does, the branch exists only
     elsewhere. If several do, they are ambiguous.
  2. Its full name matches `^refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]*$` and contains no `..`.
  3. Its upstream, if any, is not under `refs/pull/` (a PR checkout).
  4. It is not behind and not diverged from its `origin` twin, if one exists. Otherwise someone else
     pushed to it.
  5. The tree is clean: `git status --porcelain` prints nothing.
  6. No delegated child from the interrupted run is still alive. One is closed through the harness's
     lifecycle when `AGENTS.md` names one. One that cannot be closed is a stop.

  The checkout is `git switch --end-of-options '<name>'`. These checks guard against mistakes and
  against adopting someone else's work by accident, not against a determined adversary. That case is
  the protected base on the forge.
- **FR-005** **A commit is a claim.** Before re-entering `implement`, compare the last three commits
  off the base with their diffs. A subject that claims work its diff lacks goes first in the brief;
  `implement` then fixes it.
- **FR-006** **A four-line brief, then re-entry in the same turn:**
  1. where the chain stopped, with the evidence lines;
  2. what is done and confirmed in the code;
  3. what remains;
  4. the verb being re-entered, and the HEAD sha it starts from.

  No question comes in between. Only the chain's own stops halt it: the plan stop, and the merge
  request under `merge: manual`.
- **FR-007** `epic-loop.md`'s "Resuming" section points to `resume.md` for the whole chain and keeps
  its own child rule. It restates no row.
- **FR-008** Every edited file's `plugin/` copy stays byte-identical.

## 4. Success criteria

- **SC-001** Each row of the FR-003 table and each check of the FR-004 gate is pinned by a guard,
  and the table exists only in `resume.md`.
- **SC-002** On fixture repositories, the commands `resume.md` names print exactly the evidence each
  row keys on, using the real scripts. The fixtures cover: idle, idle with a linked working tree,
  active with a local branch, active on origin only, active behind its twin, two local branches on
  one sha, unpushed, and landed.
- **SC-003** The guard pins the sentence that forbids "shall I proceed?".

## 5. 🔒 Decision table

| The decision                                                                                                                                                                                                    | Its single home                                                                                                                   | What would duplicate it                                                          |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| Where a stopped chain re-enters (FR-003)                                                                                                                                                                        | `templates/core/skills/task/resume.md`                                                                                            | the rows restated in `auto-chain.md`, `epic-loop.md`, `SKILL.md` or the PO agent |
| Whether a branch may be adopted (FR-004)                                                                                                                                                                        | `resume.md`, "The provenance gate"                                                                                                | a second gate in `implement.md`                                                  |
| What git says about an item                                                                                                                                                                                     | `wip-audit.sh` (existing), called with `<id>@<epoch>`                                                                             | a `git log --grep` in `resume.md`                                                |
| Which child an epic resumes at                                                                                                                                                                                  | `phases/epic-loop.md` with `epic-status.sh` (existing)                                                                            | a child rule in `resume.md`                                                      |
| Whether the re-entered verb chains                                                                                                                                                                              | `phases/auto-chain.md` "Re-entry, without a flag" (existing): `implement` chains on an unmerged branch, `plan` chains at its stop | a chaining rule in `resume.md`                                                   |
| Plan approval                                                                                                                                                                                                   | "The plan stop" in `phases/plan.md`, re-entered by heading, never inferred                                                        | an "approved" marker; a step number                                              |
| Recovering a refused push                                                                                                                                                                                       | `phases/merge.md`, step 4 exit 7 (existing), pointed to                                                                           | the recovery copied into `resume.md`                                             |
| What may be done to uncommitted changes: nothing; dirty means stop                                                                                                                                              | `resume.md`, FR-004 check 5                                                                                                       | a stash or reset in the resume path                                              |
| New helper? **(a) Inventory:** `wip-audit.sh`, `epic-status.sh`, `base-branch.sh`, `view.sh`, `git for-each-ref`. **(b) Recurrence:** one downstream occurrence, below the bar. **(c) Outcome:** reuse directly | `resume.md` names the commands                                                                                                    | a `resume-state.sh`                                                              |

## 6. Technical context

Markdown phase prose plus guard tests. The evidence tests reuse `tests/scripts/git_sandbox.ts` with
the real scripts. There is no new shell code. Row selection is checked as a mapping from script
tokens to verbs: each row keys on one token or git fact the fixtures produce, so no row needs
judgement to select.

## 7. Constitution check

- § I and § XI: CLI only. The issue's downstream origin is not named anywhere.
- Size: `resume.md` stays under 120 lines.

| File                                                                           | Lines now | Change                                                         |
| :----------------------------------------------------------------------------- | --------: | :------------------------------------------------------------- |
| `templates/core/skills/task/resume.md` (+ plugin)                              |       new | ≈ 100                                                          |
| `templates/core/skills/task/SKILL.md` (+ plugin)                               |       138 | the verb row, `argument-hint`, a `when_to_use` phrase          |
| `templates/core/skills/task/phases/epic-loop.md` (+ plugin)                    |        46 | + 2: the pointer                                               |
| `templates/core/skills/task/backlog.md` (+ plugin)                             |       276 | the `<id>` row: the in-progress pointer                        |
| `src/domain/addendum_audit.ts` `ROUTABLE_PHASES`                               |           | unchanged: resume reads no addendum                            |
| `templates/core/root/AGENTS.md` addenda table                                  |           | unchanged, for the same reason                                 |
| `phases/auto-chain.md`                                                         |           | unchanged: re-entry goes only through verbs that already chain |
| pinned tests (verb table, `argument-hint`, retired addresses, phase mentions)  |           | re-run; updated where they enumerate the verbs                 |
| `templates/manifest.json`, `src/templates_bundle.ts`                           |    exempt | the new file                                                   |
| `tests/templates/task_resume_test.ts`, `tests/scripts/resume_evidence_test.ts` |       new |                                                                |
| `scripts/smoke/smoke-features.sh`                                              |           | the verb ships                                                 |

## 8. Surface impact

One surface: the `/task` router for every harness. A new verb is additive and touches no existing
behaviour, except the `<id>` show hint.

## 9. Risks

- **Re-entering `implement` on finished work.** Its own completion check finds nothing left and it
  goes on to `review`. The cost is a read, not a rebuild.
- **Adopting the wrong branch.** The provenance gate stops on anything that is not a single local
  branch that is clean and current.
- **Only the first linking branch is seen.** `wip-audit.sh` prints one sha per item, so a second
  branch with a different tip goes unseen. The brief names the branch taken, and the gap is recorded
  in `resume.md` rather than closed with a new script mode.
- **Losing uncommitted work.** Resume never touches it, and a dirty tree stops it.

## 10. Architecture audit

`architect-expert` returned **fail**: 5 HIGH, 5 MEDIUM, 1 LOW. All were checked against the tree and
accepted.

- **HIGH: the plan-only row cannot fire.** The plan commit comes after the stop and touches
  `feature.json`, and `plan(727)` names no `#727`. Fixed: the row is gone. A linked working tree
  with no commit re-enters at "The plan stop", and a branch with commits goes to `implement`.
- **HIGH: code commits → review could land half a feature.** `review` also commits fixes. Fixed:
  `implement`.
- **HIGH: a resumed review is one-shot (`auto-chain.md`).** Fixed: re-entry goes only through verbs
  that chain.
- **HIGH: UNPUSHED → merge hits `land-feature.sh` exits 2, 5 and 6.** Fixed: stop, and point at the
  exit-7 recovery.
- **HIGH: LANDED and open → merge step 5 closes `--no-close` deliveries, and a missing `@epoch`
  gives a false LANDED.** Fixed: stop. `<id>@<epoch>` is passed.
- **MEDIUM: the epic rows misread the evidence.** Fixed: an epic goes to `implement`, and
  `epic-loop.md` decides the child.
- **MEDIUM: twins counted as several branches.** Fixed: only `refs/heads` is counted.
- **MEDIUM: rows entered phases by step number.** Fixed: whole verbs only, and the plan stop is
  named by its heading.
- **MEDIUM: row selection is untested.** Accepted, through SC-002: every row keys on one token or
  git fact that the fixtures produce.
- **MEDIUM: §7 omissions.** Fixed above.
- **LOW: exit 2 was unmapped.** Fixed: any non-zero exit stops.

## 11. Security audit

`security-expert` returned **fail**: 2 HIGH, 5 MEDIUM, 2 LOW. All were accepted.

- **F1 HIGH: any ref naming the item could be adopted and pushed.** Fixed by the FR-004 gate:
  `refs/heads` only, no `refs/pull/` upstream, not behind its twin, and every check runs before any
  checkout.
- **F2 HIGH: the epic row skipped review.** Fixed: `implement`, then the chain's own review.
- **F3 MEDIUM: the several-branches stop misfired.** Fixed for twins. The unseen second branch is
  recorded in §9.
- **F4 MEDIUM: ref names reached shell lines.** Fixed: the allowlist and `--end-of-options`.
  Failures are named by sha only.
- **F5 MEDIUM: the creation date was dropped.** Fixed: `@<epoch>` is passed.
- **F6 MEDIUM: the body and comments entered the session.** Fixed: state and creation time only.
- **F7 MEDIUM: a dirty tree was handed to phases that commit.** Fixed: a dirty tree stops resume.
- **F8 LOW: a live child that cannot be closed.** Fixed: it is a stop, and the brief names the HEAD
  sha.
- **F9 LOW: UNPUSHED pushed the whole local base.** Fixed: resume never lands, and it lists the
  range.

## 12. Open questions

None for the user. These decisions were taken here:

- **The bare `/task <id>` does not resume.** A read-only verb must not start writing; it gains a
  pointer instead.
- **There is no `resume-state.sh`,** because the recurrence bar is not met.
- **Every adoptable branch goes to `implement`, never straight to `review` or `merge`.** It is the
  one verb that can tell finished from unfinished work, and it chains.
- **Resume never lands, closes or pushes on its own.** Those stay with `merge`, after a review.
- **A branch that exists only on `origin` is not adopted, even when it is the user's own on another
  machine.** Check it out by hand first. This is decided now, because widening it later is easy and
  narrowing it would be a break.

## 13. Review (2026-11-02)

- **code-reviewer: fail, 4 HIGH.** Three were real and are fixed. The fourth, "files missing", came
  from a checkout switch during the read and was a false positive.
  - **The chain writes `feat(<id>):`, and `wip-audit.sh` matched only `#<id>`.** On real history,
    UNPUSHED and LANDED never fired, a plan-only branch read IDLE, and a refused push read IDLE.
    Fixed at the script's home: it now matches the anchored `<type>(<id>)[!]:` scope too, in its own
    `fix(task)` commit, because the same defect hid real work from groom's WIP audit (cli#673).
  - **MEDIUM/LOW, all fixed:**
    - the closed row names whatever line was printed;
    - `implement` gains "Start from what the branch already holds";
    - the twin is named;
    - a plan that is already committed has nothing to add at its stop;
    - the epic-loop pointer is shortened;
    - a non-empty `origin/<base>..<base>` stops before the IDLE rows.
- **security-expert: fail, 1 HIGH, reproduced.** A fetched pull request had no upstream and no twin,
  so it passed every check. Fixed:
  - check 5, every commit on the branch is the user's (committer e-mail);
  - check 3 now stops on any upstream remote other than `origin`.

  F1 is narrowed, not closed: an e-mail can be forged, and that case belongs to the forge. MEDIUM:
  subjects were promoted to tasks. Fixed: they are data, and a mismatch is reported, never built.
  The INFO items are fixed too: the checkout uses the short name, the recovery row warns that the
  local base may hold other landings, and the clean-tree and live-child checks apply on every row.
- **test-reviewer: fail, 1 HIGH.** The behind-twin fixture skipped `wip-audit.sh`. Fixed: it now
  asserts that the reported sha is the local tip and that check 4's count is right. The MEDIUM items
  are fixed too:
  - fixtures commit the chain's real shapes;
  - a plain IDLE fixture;
  - fixtures for a PR, a `refs/pull` upstream, a same-sha twin and a refused push;
  - a guard for FR-005;
  - the single-home scan covers `implement.md` and `merge.md`;
  - the destructive-command scan is wider.

  Every new guard was observed red under a live mutant.
