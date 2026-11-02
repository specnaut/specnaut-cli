# Plan — a cloud re-entry continues on the item's branch (cli#730)

Issue:
[cli#730 "Cloud backend: re-entering an ACTIVE item forks a second branch and drops the plan amendment"](https://github.com/specnaut/specnaut-cli/issues/730)

**Full plan (step 4b).** It started as a brief. The security seat answered "crosses the threshold":
a newly committed `.specnaut/feature.json` is written in cloud projects, and untrusted file content
(a committed `feature.json`, a pulled cloud plan) now takes part in choosing the branch the chain
builds on. Accepted.

## 1. Why this exists

On the cloud spec backend, `/task plan <id>` on an item whose branch already exists (`ACTIVE`) runs
one-shot, cli#729's stopgap, because continuing was unsafe. Two defects caused that, and the audits
found a third:

- **A second branch.** `implement`'s cloud block always ran `create-new-feature.sh --branch-only`,
  so every re-entry minted another branch for the same task.
- **A lost amendment.** Cloud `plan` pushed the plan at step 2. A re-entry skips step 2, so the
  amendment was never pushed.
- **Lost audits and answers, even on a fresh plan.** Steps 4 to 7 write the brief's body, the audit
  findings and the user's answers after step 2's push. `implement` begins with a pull, and a pull
  replaces the cache (`SpecCacheWriter.write` clears it first). So every cloud plan lost them.

## 2. User scenarios

- **P1, cloud `ACTIVE` re-entry.** The item's branch holds part of the work. `/task plan <id>`, with
  or without an amendment, adopts the branch through `resume.md` § 3, pulls the plan, and chains to
  `implement`. `implement` continues on that branch and creates no second one.
- **P1, an amendment is kept.** The amendment is written into the pulled `1-plan.md`, audited, and
  pushed at step 8 with the plan's audits and answers.
- **P1, a fresh cloud plan keeps its audits.** The push happens once, at step 8, after steps 4–7.
- **P2, the cloud plan changed since approval.** The pulled plan's `git hash-object` differs from
  the branch's committed `plan_blob`: step 7 reports it as an open question, and the chain stops
  there.
- **P2, a stale pull.** `spec pull` fails, or falls back to "reusing the existing cache": re-entry
  stops, since a push from a stale cache overwrites every tab.
- **P2, `implement` started on the base** while the task's branch is unlanded: it stops, names the
  sha (never a branch name) and points to `/task resume <task>`.
- **P2, the next slice after a landing.** The base still carries the landed `feature.json`, and
  every branch cut from it inherits the link. That inheritance never makes a branch `ACTIVE`.
  `implement` cuts a new branch and commits the link with `--allow-empty`.
- **P3, an epic's child.** An epic is one plan: the task pulled, pushed and matched is the epic.

## 3. Requirements

- **FR-001** The `plan <id>` row of `auto-chain.md` chains `IDLE`, `ACTIVE` and `LANDED` on both
  backends.
- **FR-002** Cloud Re-entry in `plan.md`:
  - The pull runs first. `✓ materialised` means a plan exists, `no spec for task` means none does,
    and anything else stops.
  - `IDLE` with a plan is adopted. `ACTIVE` is adopted through `resume.md` § 1 item 4 and § 3.
    `IDLE` with no plan, or `LANDED`, runs step 2.
  - An epic's child uses the epic as its task.
- **FR-003** Cloud step 2 writes the plan to the cache, does not push, and writes no `feature.json`.
  The task is the item's id; with none, the product-owner creates one first. (The old "push
  auto-creates a task" was false: `spec push` requires a task number.)
- **FR-004** Cloud step 8 decides the one push, before the run ends or hands off (step 8, or the
  step-7 stop); a failed push stops. On an adopted plan it pushes only when something changed. On
  the item's branch it then pulls again and commits `feature.json`'s `plan_blob` as the cloud
  returns the plan.
- **FR-005** `implement` stops on a pulled plan whose blob differs from the branch's `plan_blob`;
  `plan` re-entry reports it at step 7 and step 8 records the approved blob.
- **FR-006** Cloud `implement` takes its task from the chain, or else from HEAD's committed
  `linked_issue` if it is a whole number; with neither, it stops. It decides the branch from
  `wip-audit.sh <task>@<epoch>`:
  - `ACTIVE` at HEAD's tip, HEAD's branch alone pointing there, and check 8 passing: continue.
  - `ACTIVE` anywhere else: stop with the sha. `UNPUSHED`: stop.
  - `IDLE` or `LANDED`: `create-new-feature.sh --branch-only --issue <task>`, then write
    `{ linked_issue, plan_blob }` and commit it alone with `--allow-empty`, as
    `plan(<task>): link the branch to its task`.
- **FR-007** `plugin/` mirrors are byte-identical, and the bundle is regenerated.

## 4. Decision table — binding

| The decision                                                                                                                                                                                                             | Its single home                                                                         | What would duplicate it                                                                                                      |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| Whether a direct `plan <id>` chains                                                                                                                                                                                      | `phases/auto-chain.md`, the `plan <id>` row                                             | a backend condition in `plan.md`, `SKILL.md` or `resume.md`                                                                  |
| How a cloud re-entered `plan` reads the cloud and adopts                                                                                                                                                                 | `phases/plan.md`, Re-entry `spec-backend=cloud` block                                   | a re-entry branch in cloud step 2 or in `implement.md`                                                                       |
| When the cloud plan is pushed, and the recorded `plan_blob`                                                                                                                                                              | `phases/plan.md`, step 8 `spec-backend=cloud` block                                     | a push in step 2 or in the Re-entry block; a blob written anywhere else                                                      |
| Which branch cloud `implement` builds on                                                                                                                                                                                 | `phases/implement.md`, cloud setup block, keyed on `wip-audit.sh`                       | `git show HEAD:feature.json` or a `for-each-ref` scan as its own predicate; a reuse rule in `create-new-feature.sh` / `.ps1` |
| What "a branch serves the item" means                                                                                                                                                                                    | `wip-audit.sh` (its LINK rule diffs against the fork point) and `resume.md` § 3 check 8 | an inherited-link test anywhere else                                                                                         |
| Whose branch it is                                                                                                                                                                                                       | `resume.md` § 3, unchanged                                                              | a restated check in a phase doc                                                                                              |
| **New helper?** (a) inventoried `create-new-feature.sh` (epic reuse, card move via `--issue`), `wip-audit.sh`, `base-branch.sh`, `specnaut spec pull/push`, `git hash-object`; (b) no recurrence; (c) **reuse directly** | —                                                                                       | a new script, or a reuse rule added to `create-new-feature.sh` and its `.ps1` twin                                           |

**Rejected:** extending `create-new-feature.sh --branch-only` to reuse HEAD. The rule would land in
both the script and its PowerShell twin, and the script's own epic reuse already reads
`feature.json` in a way `wip-audit.sh` does not. **Rejected:** a sha256 tool for the fingerprint.
`git hash-object` gives the same answer on every platform, with no new dependency.

## 5. Constitution check

- **§ I, the two halves.** The change touches only public prose about the public CLI's own
  `spec pull/push`. It names no Cloud internal.
- **§ XI, no consumer traces.** Test items are invented (62–67).
- **One home per rule.** See § 4. The cloud exception leaves the row; nothing mirrors it.

## 6. Surfaces

- `templates/core/skills/task/phases/{auto-chain,plan,implement}.md`, their `plugin/` mirrors, and
  `src/templates_bundle.ts`.
- Tests: `tests/templates/plan_reentry_test.ts`, `tests/scripts/plan_reentry_evidence_test.ts`.

**Surfaces added or widened:**

- (1) Cloud projects get a committed `.specnaut/feature.json` on each feature branch:
  `{ linked_issue, plan_blob }`, fixed fields. It reaches their base when the branch lands, and
  `remove-spec.sh` leaves it there, because it has no `feature_directory`.
  - It is harmless there: `wip-audit.sh` only counts a link a branch's own commits changed.
  - Local projects already commit the same file.
- (2) Committed `feature.json` and the pulled plan now feed the branch choice and the approval
  check:
  - `linked_issue` is accepted only as a whole number.
  - The branch decision rests on `wip-audit.sh`, which prints validated digits and shas only.
  - A branch is named only by sha.
  - The pulled plan is compared with the recorded blob, never trusted silently.

## 7. Risks

- **The cloud may not return the plan byte for byte.** Both sides of the blob comparison are
  computed on pulled content: `implement` hashes the pulled file, and step 8 pulls again before
  hashing.
- **Old cloud branches.** A branch created before this change carries no committed link and no blob:
  - its commits have no `plan(<task>)` subject, so it reads `IDLE` unless a subject names the task;
  - check 8 refuses it and names the check.

  Both are safe failures.
- **Size.** Every touched doc stays under its ceiling (§ 8).

## 8. Done, as runnable checks

- `deno task test` (`--allow-read --allow-write --allow-run --allow-env`),
  `bash scripts/smoke/audit.sh`, `bash scripts/smoke/run-all.sh`, `scripts/check-adoption.ts`,
  `size-ratchet.sh --report`.
- `plan_reentry_test.ts`:
  - the row carries no backend;
  - the cloud plan and implement sentences appear in the cloud render only, on every harness and
    option set;
  - the cloud plan has exactly one push, located after step 8's heading;
  - the plan test checks its adopt-through-§ 3 sentence;
  - plugin parity holds.
- `plan_reentry_evidence_test.ts`, cloud cases on real git:
  - `ACTIVE` at HEAD's tip, with HEAD's branch alone → continue;
  - on the base, `ACTIVE` elsewhere → the sha;
  - after a landing, the base and a fresh branch inherit the link and read `LANDED`;
  - the next slice's link commit is empty and reads `ACTIVE`.
- The amendment push mechanics: `tests/integration/spec_push_pull_test.ts` ("edit a materialised tab
  → push → cloud reflects it").
- Red-probe, 6 live mutants, all red:
  - `--allow-empty` dropped;
  - a push moved back into step 2;
  - the ACTIVE adoption dropped;
  - check 8 dropped from implement's continue rule;
  - the row's local-only exception restored;
  - `wip-audit.sh`'s fork-point diff removed.

## 9. Audit findings

### Architecture (`architect-expert`, pass 1: fail, 4 HIGH · 3 MEDIUM · 2 LOW)

- **HIGH: the push came before the content it saves.** Verified: `spec_cache_writer.ts` clears
  before writing, and only step 2 pushed. **Fixed:** FR-003 and FR-004, guarded by the one-push-
  after-step-8 test.
- **HIGH: the branch rule restated check 8, more weakly.** Verified: the base keeps the cloud link
  (`remove-spec.sh` needs `feature_directory`), and `wip-audit.sh` diffs against the fork point.
  **Fixed:** FR-006 keys on `wip-audit.sh`'s `ACTIVE` sha, guarded by the inherited-link test.
- **HIGH: epic children forked.** Verified: there was no `--issue`. **Fixed:** `--issue <task>`, and
  the epic is the task (FR-002, FR-006).
- **HIGH: the link commit failed on an unchanged `feature.json`, and read a shared file.**
  **Fixed:** `--allow-empty`, the task taken from the chain or from HEAD's committed link, and
  `plan` no longer writes `feature.json` on the base.
- **MEDIUM: fixtures vacuous without a base that carries the link.** **Fixed:** two landing
  fixtures.
- **MEDIUM: a stale-cache push.** **Fixed:** that pull outcome stops (FR-002).
- **MEDIUM: cloud `plan` dirtied the base's tree, which failed the chain gate's check 6.** Verified:
  `feature.json` is not ignored. **Fixed:** FR-003 writes none.
- **LOW: "push auto-creates a task" is false.** **Fixed:** FR-003.
- **LOW: the inventory said "reuse" while the draft reused nothing.** **Fixed** with the HIGHs.

### Architecture, pass 2 (fail, 2 HIGH · 3 MEDIUM · 2 LOW; all nine pass-1 findings confirmed closed)

- **HIGH: a run that stops at step 7 never pushed, and the re-entry pull or step 2 then destroyed
  the plan; `spec-autogen.md` relied on that flow.** **Fixed:** one push rule in step 8's cloud
  block, "once, before the run ends or hands off: here, or at step 7". `spec-autogen.md` ends with
  that push and invokes nothing. An existing plan is a materialised `1-plan.md`, not the pull's
  message.
- **HIGH: the `plan_blob` check lived only in `plan`, so `/task resume` and a direct `implement`
  built a changed plan unchecked.** **Fixed:** the check is decided in `implement`'s ACTIVE-continue
  bullet (stop, `/task plan <task>` re-approves). `plan` re-entry points to that rule, and step 8
  records the approved plan's blob whenever it differs.
- **MEDIUM: the fallback task on the base was the landed item.** **Fixed:** the fallback applies
  only when HEAD is not the base.
- **MEDIUM: a failed step-8 push did not stop.** **Fixed:** "A non-zero push is a stop".
- **MEDIUM: `create-new-feature.sh`'s epic scan can pick the base**, which inherits the epic's link.
  Verified: the scan walks every `refs/heads` entry. It fails safe (exit 1), and the fix belongs in
  the script and its `.ps1` twin, which this plan leaves out of scope. **Backlog** follow-up.
- **LOW: an IDLE child of an ACTIVE epic stops at `implement` on cloud** instead of continuing. It
  stops safely and creates no second branch. **Backlog**, with the item above.
- **LOW: "commit it alone" was not enforced.** **Fixed:** anything already staged is a stop.

### Security (`security-expert`: needs_followup, 0 HIGH · 2 MEDIUM · 3 LOW, crosses the threshold)

- **Threshold.** Accepted; this is now the full plan, and § 6 lists both widened surfaces.
- **MEDIUM: an inherited link counted as "links the task".** Same as the architecture HIGH; fixed.
- **MEDIUM: a pulled plan was built as approved with no check.** **Fixed:** `plan_blob` (FR-004,
  FR-005); a changed plan is a step-7 question.
- **LOW: a stale pull with push.** Fixed (FR-002). A distinct exit code for the cache fallback,
  sturdier than reading the warning, goes to the backlog.
- **LOW: unvetted branch names and a raw link read.** **Fixed:** only shas are named, and
  `linked_issue` must be a whole number. The brief's "jq by check 8" was inaccurate and has been
  dropped.
- **LOW: no test on the cloud adopt-through-§ 3 sentence.** **Fixed:** asserted and red-probed.

## 10. Open questions

None. The issue's criteria fix the behaviour, and every fork above is technical, settled by the
seats.
