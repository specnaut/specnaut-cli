# Plan — groom and next audit `Ready` and `In progress` (cli#673)

Issue:
[cli#673 "board: groom and next never audit Ready / In progress — WIP drifts silently"](https://github.com/specnaut/specnaut-cli/issues/673)

## 1. Why this exists

`/task groom` grooms the intake column only; `/task next` recommends from `Ready` without counting
work in progress. Nothing re-reads `Ready` or `In progress`, so both drift. One board had 63 cards
`In progress` while one item was actually being worked on. The rest were work that had landed but
was not closed, epics with one started child, items blocked on an operator step, and moves with
nothing behind them. `sweep-closed.sh` only sees CLOSED issues outside Done, so an open issue whose
work landed is invisible to it.

## 2. User scenarios

- **P1, groom audits WIP.** Given cards in `In progress` whose work landed, never started, or is
  blocked, when the user runs `/task groom`, then each audited card is classified from git evidence
  and handled per one table. The report lists every card moved, commented on or left, with the
  reason.
- **P1, next counts WIP first.** Given more `In progress` cards than the WIP limit, when the user
  runs `/task next`, then it reports the count and recommends finishing or unblocking those before
  any `Ready` item.
- **P2, merge stops leaving cards behind.** Given a branch whose push was refused, or a delivery
  that went out as a PR (`--pr`), when `merge` ends, then the card is in the review column.
- **P2, the audit is bounded.** Given 63 cards in `In progress`, a groom run audits at most the
  limit (default 20) and reports how many it deferred.

Edge cases:

- no `origin/<base>`;
- base branch unknown (`base-branch.sh` exit 3);
- a commit naming `#N` that is about something else (`owner/repo#N`, `#N0`, a PR number, history
  older than the item);
- an epic;
- a board with no review column;
- a card a human moved back by hand;
- the local and cloud backends.

## 3. Requirements

- **FR-001** A read-only script, `.specnaut/scripts/bash/wip-audit.sh [--limit N] <num>[@<epoch>]…`,
  classifies each item from git alone. It prints one line per item, then a summary line. The first
  match wins, in this order:
  - `ACTIVE <n> <sha>`: a ref under `refs/heads/` or `refs/remotes/origin/` (not `origin/HEAD`) that
    is **not** merged into the base, and where either (a) a commit on it that is not on the base
    names `#<n>` in its **subject**, or (b) its committed `.specnaut/feature.json` has
    `linked_issue == <n>` (read with `git show <ref>:.specnaut/feature.json`, the way
    `epic-status.sh` does). `<sha>` is that ref's tip.
  - `UNPUSHED <n> <sha>`: a commit on the local base that is not on `origin/<base>` names `#<n>` in
    its subject.
  - `LANDED <n> <sha>`: a commit on the published base (`origin/<base>`, or the local base when
    there is no origin ref) names `#<n>` in its subject.
  - `IDLE <n>`: none of the above.
  - `DEFERRED <n>`: beyond `--limit`.
  - The summary line: `audited <A>, active <C>, unpushed <U>, landed <L>, idle <I>, deferred <D>`.

  With `@<epoch>` (the item's creation time), commits whose committer date is older are ignored.
- **FR-002** `#<n>` matches only as a whole reference within one subject line. It is not preceded by
  `[[:alnum:]_/.-]` and not followed by a digit. The pattern is built from validated digits only. No
  closing keyword is read: groom never closes (FR-005), so the forge's grammar is not the script's
  business.
- **FR-003** Inputs: `<num>` and `--limit` must match `^[1-9][0-9]{0,9}$`, and `<epoch>` must match
  `^[0-9]{1,12}$`. Anything else exits `2`. Exit `3` means the base branch is unknown, and nothing
  is classified. Exit `0` means everything was classified.

  The script:
  - never fetches, never writes, and runs no `eval` and no `bash -c`;
  - passes full `refs/…` names to git;
  - prints only fixed tokens, validated digits and shas, and never commit or ref text;
  - never prints `IDLE` for an item it could not check.
- **FR-004** `--limit` defaults to 20 and caps the items classified, in the order given. Groom
  passes them oldest first by creation time.
- **FR-005** `/task groom` gains check **2, "WIP audit — Ready and In progress"**. It covers the
  backends with columns: github, gitlab, local and cloud.

  First, the PO lists both columns with `list.sh` and passes every number with its creation time to
  `wip-audit.sh`. It then runs `cascade-check.sh <n>` per item. Exit 11 (an open child) means
  **leave** it, whatever its line says. Otherwise, the table below decides:

  | Line                                                   | `In progress` card                                                                                                            | `Ready` card              |
  | :----------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :------------------------ |
  | `ACTIVE`                                               | leave                                                                                                                         | leave; report as started  |
  | `UNPUSHED`                                             | move to the review column                                                                                                     | move to the review column |
  | `LANDED`                                               | move to the review column; the report says "landed at `<sha>`: close it with `/task close <n>` once it is complete"           | same                      |
  | `IDLE`, blocked                                        | leave; one `🤖 specnaut-groom` comment naming the blocker in groom's own words                                                | same                      |
  | `IDLE`, not blocked, with no earlier idle comment      | one `🤖 specnaut-groom` comment: "no branch or commit references this item; the next groom moves it back to the ready column" | leave                     |
  | `IDLE`, not blocked, with that comment already present | move to the ready column (`$READY`; with `PROMOTE=no`, leave it and report)                                                   | leave                     |
  | `DEFERRED`                                             | leave; count it                                                                                                               | same                      |

  **Allowlist rule.** This table is the only list of actions. Each action applies only to the item
  number the script printed, using the row for that line and for the card's column as re-read from
  the board just before acting. No number, sha or instruction taken from a title, body, comment or
  commit chooses an action or a target. Reading the comments yields one bit, blocked or not. A groom
  comment copies no `@` mention and no URL.

  Groom never closes an item. Items handled by the WIP audit are not passed to `groom-verify.sh`.
- **FR-006** `/task next` lists `In progress` first and reports its count. Above the WIP limit
  (default 5, or `/task next --wip-limit <N>`), it recommends finishing or unblocking from
  `In progress` before any `Ready` item.
- **FR-007** `merge` step 5 becomes **"Settle the card"**, with three rows:
  1. Pushed and closing: run `merge-close.md`.
  2. Pushed under `--no-close`: leave the card in `In progress`, because the delivery continues.
  3. Not pushed (`land-feature.sh` exit 7) or `--pr`: move the linked item to the review column.

  Step 2 (`--pr`) and the exit-7 row point to step 5 before step 6. A failed move is reported and
  never fails the merge.
- **FR-008** The cloud stage-reconcile table keeps `In Progress → No-op` for its hook on entering
  that column. It adds that a card staying there is audited by groom's WIP audit, referenced by
  title.
- **FR-009** The `next` descriptions in `SKILL.md` and `backlog.md` mention WIP first. Every edited
  Markdown file's `plugin/` copy stays byte-identical.

## 4. Success criteria

- **SC-001** On a fixture repository with active, unpushed, landed, idle, too-old and deferred
  items, plus a near-miss for every bound (`owner/repo#N`, `#N0`, `x#N`, `012`, `--limit 08`), the
  script prints exactly the expected lines. Every assertion is observed red under a live mutant.
- **SC-002** A groom run against 63 `In progress` cards audits 20 and reports 43 deferred.
- **SC-003** After `merge --pr`, or after a refused push, the linked card is in the review column.
- **SC-004** No groom run closes an item, and none re-applies a move a human reverted, unless the
  evidence has changed. A card moved back to `In progress` after a `LANDED` move goes to review
  again on the next run, because the evidence still says it landed. That is reported, not hidden;
  see §9.

## 5. 🔒 Decision table

| The decision                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Its single home                                                                                                                                                                                      | What would duplicate it                                                              |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| What counts as active, unpushed, landed or idle                                                                                                                                                                                                                                                                                                                                                                                                              | `templates/core/specnaut/scripts/bash/wip-audit.sh`                                                                                                                                                  | a `git log --grep` in groom.md, product-owner.md or merge.md                         |
| What `#<n>` looks like in a subject                                                                                                                                                                                                                                                                                                                                                                                                                          | `wip-audit.sh`, one `names_item()` function. `epic-status.sh:76,106` matches its own strict `Epic: #` trailer format, a different owner and a different reason to change, so this is not a duplicate | a third matcher in a script or in prose                                              |
| Which branch works on item N                                                                                                                                                                                                                                                                                                                                                                                                                                 | the committed `.specnaut/feature.json` `linked_issue` on that branch, read by `wip-audit.sh`                                                                                                         | a branch-name pattern; an issue-number lookup in `branch-naming.sh`                  |
| The audit cap, 20                                                                                                                                                                                                                                                                                                                                                                                                                                            | the `wip-audit.sh` `--limit` default                                                                                                                                                                 | "20" in groom.md or product-owner.md                                                 |
| What groom does with each line (FR-005, allowlist included)                                                                                                                                                                                                                                                                                                                                                                                                  | `templates/core/skills/task/groom.md`, check 2                                                                                                                                                       | the table restated in product-owner.md or groom-report.md                            |
| An epic with an open child is left alone                                                                                                                                                                                                                                                                                                                                                                                                                     | `cascade-check.sh` exit 11, asked before the table                                                                                                                                                   | a child count in groom.md                                                            |
| Which column is "ready"                                                                                                                                                                                                                                                                                                                                                                                                                                      | `groom-columns.sh` (`$READY`, `PROMOTE`)                                                                                                                                                             | a literal `Ready` in the table                                                       |
| Which column is "review"                                                                                                                                                                                                                                                                                                                                                                                                                                     | each backend's `move.sh` status list (`In review`; cloud `In Review`)                                                                                                                                | a literal list in groom.md or merge.md                                               |
| Who closes an item                                                                                                                                                                                                                                                                                                                                                                                                                                           | unchanged: `merge` (merge-close.md) and the `close` verb. Groom never does                                                                                                                           | a close row in groom.md                                                              |
| The WIP limit for `next`, 5                                                                                                                                                                                                                                                                                                                                                                                                                                  | product-owner.md, the `next` bullet                                                                                                                                                                  | "5" in backlog.md, SKILL.md or groom.md                                              |
| When merge moves a card (FR-007)                                                                                                                                                                                                                                                                                                                                                                                                                             | `templates/core/skills/task/phases/merge.md` step 5                                                                                                                                                  | the rule restated in step 2, the exit table or merge-close.md (they point to step 5) |
| Which items `groom-verify.sh` judges                                                                                                                                                                                                                                                                                                                                                                                                                         | groom.md, "Before the report"                                                                                                                                                                        | a WIP exception in `groom-rules.sh`                                                  |
| New helper. **(a) Inventory:** `sweep-closed.sh` is board-side and closed-only; `epic-status.sh` reads one branch's trailers; `cascade-check.sh` reads children; none reads git per item. **(b) Recurrence:** cli#673's 63-card board, and the hand sweeps for landed-but-open cards in this workspace's 2026-11-02 groom. **(c) Outcome:** add a new helper. It takes digits and an optional epoch, nothing executable, and keeps `base-branch.sh`'s exit 3 | `wip-audit.sh`                                                                                                                                                                                       | a per-backend copy under `skills/task/scripts/<backend>/`                            |

## 6. Technical context

- Bash and git only, with no network. Git is the one evidence source every backend shares, so the
  script is backend-neutral and sits beside `epic-status.sh`.
- The PO lists the columns with its backend's `list.sh`, gets creation times from `view.sh` (or the
  front-matter `created` on local), and moves cards with `move.sh`. All four backends have one.
- Tests are Deno tests in `tests/scripts/wip_audit_test.ts`, built on `git_sandbox.ts` with a bare
  `origin`, and run with the task's permissions.

## 7. Constitution check

- § I (halves): CLI only, with no private name.
- § XI (consumers): the issue's anecdote is described, never attributed.
- Size: `wip-audit.sh` must stay under 160 lines (amended at review: telling a failed git read apart
  from an empty one took 30 lines; the default target is 300).

| File                                                                                                                                                             | Lines now | Change                                                                                |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | :------------------------------------------------------------------------------------ |
| `templates/core/specnaut/scripts/bash/wip-audit.sh`                                                                                                              |       new | ≈ 110                                                                                 |
| `templates/core/skills/task/groom.md` (+ plugin copy)                                                                                                            |       217 | + ≈ 35: check 2, renumbering, "five checks", §2→§3 cross-refs, the groom-verify scope |
| `templates/core/skills/task/groom-report.md` (+ plugin copy)                                                                                                     |       106 | + ≈ 8: the WIP section                                                                |
| `templates/core/agents/product-owner.md` (+ plugin copy)                                                                                                         |       155 | + ≈ 3: the `next` and `groom` bullets                                                 |
| `templates/core/skills/task/phases/merge.md` (+ plugin copy)                                                                                                     |       103 | ≈ 10 lines rewritten: step 2, the exit-7 row, step 5, Output                          |
| `templates/core/skills/task/backlog.md` (+ plugin copy)                                                                                                          |       276 | the `next` row and the cloud row                                                      |
| `templates/core/skills/task/SKILL.md` (+ plugin copy)                                                                                                            |       138 | the `next` row                                                                        |
| `templates/manifest.json`; `src/templates_bundle.ts`                                                                                                             |    exempt | one entry; regenerated                                                                |
| `tests/scripts/wip_audit_test.ts`                                                                                                                                |       new |                                                                                       |
| `tests/templates/*`: groom_delegates_orphan_specs (section count), ship_backlog_groom_keep_list (§2 pins), plus a new guard for FR-005, FR-007 and the allowlist |           |                                                                                       |
| `scripts/smoke/smoke-features.sh`                                                                                                                                |           | the script ships, and groom calls it; then `audit.sh --since main` before landing     |

## 8. Surface impact

One surface: the shipped skill bundle (every harness, every backend), plus one new script. There is
no API and no front end. Existing projects receive it through `specnaut upgrade`.

## 9. Risks

- **A mention that does not finish the item** (a partial delivery, or a plan commit). Groom only
  moves the card to review, never closes it. An ongoing `--no-close` delivery keeps a live branch
  linked through `feature.json`, so `ACTIVE` wins.
- **A false `IDLE` sends real work back.** The move needs two runs with a visible warning comment in
  between, `ACTIVE` reads `feature.json`, exit 3 stops everything, and the move is reversible.
- **A human moves a `LANDED` card back to `In progress`, and groom moves it to review again.**
  Accepted: the evidence says it landed. The comment trail and the report name the sha, so the human
  closes the item or reverts the commit. It never closes.
- **The ready column is unset (`PROMOTE=no`).** The IDLE move is reported, not made.

## 10. Architecture audit

`architect-expert` returned **fail** on the first draft: 3 HIGH, 4 MEDIUM, 4 LOW. Each finding was
checked against the tree and accepted.

- **HIGH, IDLE ignored `feature.json`.** Confirmed: cli#673 had 0 commits naming `#673` while
  `feature.json` linked it. Fixed: `ACTIVE` reads the committed `linked_issue`, and the IDLE move
  now takes two runs.
- **HIGH, groom closing items reverses groom.md:153-154 and restates the order owned by
  `_close_shipped.sh`.** Fixed by removal: groom never closes. Who closes keeps its one home.
- **HIGH, a closing keyword would re-close a reopened issue every hour.** Fixed by the same removal.
- **MEDIUM, FR-007's home could not be reached from `--pr` or exit 7.** Fixed: step 5 is a three-row
  gate that steps 2 and 4 point to. `--no-close` keeps `In progress`.
- **MEDIUM, literal column names.** Fixed: the ready column comes from `groom-columns.sh`, the
  review column from each backend's `move.sh`. The Blocked column is dropped, because no backend has
  one; a blocked item gets a comment.
- **MEDIUM, `### 1b.` would be invisible to the section-count test.** Fixed: the new check is
  `### 2.`, the later checks are renumbered, the text says "five", and backlog.md refers to it by
  title.
- **MEDIUM, `groom-verify` would fail WIP items.** Fixed: they are not passed to it.
- **LOW items.** Accepted:
  - the files-touched table is completed;
  - the test moves to `tests/scripts/`;
  - the `epic-status.sh` matcher row is reworded;
  - the forge-keyword finding is moot now that no keyword is read;
  - cascade-check runs before the table.

## 11. Security audit

`security-expert` returned **fail** on the first draft: 1 HIGH, 3 MEDIUM, 3 LOW. All were accepted.

- **F1 HIGH, attacker-writable comments steer an unattended agent that could close and move items.**
  Fixed:
  - the allowlist rule in FR-005;
  - comments yield a single bit (blocked or not), and that bit can only _suppress_ a move;
  - groom never closes;
  - no copied mentions or URLs.

  §12 records that FR-005 widens groom.md:153-154 for open items only, and that "do not close
  autonomously" still stands.
- **F2 MEDIUM, a bare number loses its namespace and its age.** Fixed: `<num>@<epoch>` ignores older
  history, and the worst remaining effect is a move to review, never a close. PR numbers on the
  local backend are noted as a residual risk: the move is reversible and reported.
- **F3 MEDIUM, a commit outranks a human reopen.** Fixed by removal: there is no close, so there is
  no re-close.
- **F4 MEDIUM, an unbounded closing keyword.** Fixed by removal: no keyword is read.
- **F5 LOW, the refname was printed on stdout.** Fixed: the sha is printed instead, and full
  `refs/…` names are passed.
- **F6 LOW, every ref was read.** Fixed: only `refs/heads` and `refs/remotes/origin`, excluding
  `origin/HEAD`.
- **F7 LOW, unpinned numbers.** Fixed: `^[1-9][0-9]{0,9}$` for both inputs.
- **Quoting.** The script has no `eval` and no `bash -c`, quotes every expansion, and never echoes
  commit text. Its header says so.

## 12. Open questions

None for the user: the defaults (20 and 5) come from the issue, and every fork above was technical
and is settled by the seats. These decisions were taken here:

- **Groom never closes, against the issue's "close it if already on the remote"** (security F1–F4,
  architecture HIGH-2/3). A landed item goes to review with its sha, and closing stays with `merge`
  and `/task close`.
- **groom.md §2's "report, never move" keeps applying to closed-item drift.** The new check moves
  open cards only, as grooming's promotion already does.
- **FR-008 reinterprets acceptance criterion 4.** That cloud row is a hook on entering a column,
  where a no-op is right.
- **"Oldest-moved first" became "oldest created first".** Boards expose no uniform move date.
- **The `Blocked` column move is dropped,** because no backend has one. A blocked item gets one
  comment.
- **This workspace's root `.claude/` copies are root-authored** and out of scope.

## 13. Review (2026-11-02)

- **code-reviewer: fail, 1 HIGH.** A failed `feature.json` read could print `IDLE` and lazy-fetch.
  Fixed: `ls-tree` before `show`, every failure goes to `unread`, and `GIT_NO_LAZY_FETCH=1`.
- **The MEDIUM and LOW findings were fixed in the branch:**
  - an inherited `feature.json` gave a false `ACTIVE`; only a branch's own change counts now;
  - a branch merged locally is now `UNPUSHED`;
  - the `cascade-check` exits are all mapped;
  - the ready column is `$READY`;
  - wip-audit exits not in the table are now handled;
  - the report gained tokens;
  - `--pr` is now the first row of merge step 5, which validates `linked_issue`;
  - every git read takes `--`;
  - the guards were widened.
- **security-expert: needs_followup, no HIGH.** A stranger's "blocked" comment, and a forged idle
  marker, could steer a card. Fixed: a block counts only from a team member, and groom's own
  comments never count as evidence. The idle warning counts only when posted by groom's own account.
  Groom posts fixed sentences only, once per move.
- **test-reviewer: needs_followup, no HIGH.** Fixed:
  - exit 3 is tested through each git read separately;
  - the shas are asserted exactly;
  - an `origin`-only branch is covered;
  - boundary characters and lengths are covered;
  - precedence and order are tested;
  - the bundle-level guard covers every harness × option set;
  - FR-008 and FR-009 are asserted;
  - the allowlist cells are pinned.

  Every new assertion was observed red under a live mutant.
- **Not fixed: `create-new-feature.sh` reads `linked_issue` with a parser of its own**
  (code-reviewer LOW). It is outside this branch's surface and is noted here. Its contract stays "a
  bare number".
