# Plan: three phase rules — a pointer, a product owner that decides, a standalone full gate

**Branch**: `068-phase-rules` (base `origin/main` at `e42e4910`) | **Date**: 2026-11-10

**Backlog items:**

- specnaut-cli#742 plan and implement give no pointer for an item with no creation time —
  https://github.com/specnaut/specnaut-cli/issues/742
- specnaut-cli#744 Let the product owner decide priority, size, type and split without asking the
  user — https://github.com/specnaut/specnaut-cli/issues/744
- specnaut-cli#746 The full gate never runs on a standalone item —
  https://github.com/specnaut/specnaut-cli/issues/746

**Shape:** full plan. Threshold line crossed: **an agent instruction surface**. All three items
rewrite shipped agent and skill instructions that consuming projects' harnesses run. #744 also lets
the product owner create an epic and its children without first asking. #746 makes the merge run the
project's declared `full_gate:` commands on a path that does not run them today.

**One commit per item, in this order:** #742, #744, #746. #742 must prove the local render of
`plan.md` byte-identical with no re-capture, so it lands before #744, which re-captures that golden
on purpose.

---

## 1. Why this exists

- **#742.** On the Cloud backlog against an older API, `view.sh` prints `—` on its `created:` line.
  `plan` and `implement` say to run `wip-audit.sh <id>@<epoch>`, and an agent following them writes
  `12@—`. That is exit 2, a usage error. The rule that resolves it already exists, in the
  `wip-audit.sh` header ("An item with no creation time to read … is passed as `<n>` alone, and the
  caller says the date filter was off for it"). `groom.md` and `resume.md` point at that header;
  `plan.md` and `implement.md` do not. A first attempt (`cf9b0e68`) was reverted (`f0e7e596`)
  because it broke the local golden and split a pinned literal.
- **#744.** The product owner's "Epic detection heuristic" says "Ambiguous split: ask once". A user
  who adds nothing to that call is asked anyway and usually picks the recommendation, so the
  question costs a turn and buys nothing. Priority, size, type, labels, splits, follow-up tickets
  and order are the product owner's calls: it decides, applies, reports in one line with its reason,
  and the user can overrule afterwards.
- **#746.** `quality-gates.md` promises the `full` tier "once, before the merge", with no epic
  restriction. `merge.md` runs it only under "Exit 0 — an epic". "Exit 14 — standalone" loads
  `merge-squash.md`, which runs no gate, and `land-feature.sh` runs none either (0 `run-gate`
  occurrences). Nothing reports the skip, so a project that declares an end-to-end suite under
  `full_gate:` ships standalone items without ever running it.

**Out of scope:**

- #742: making `wip-audit.sh` accept `12@—` (refusing anything but validated digits is deliberate);
  what `view.sh` prints (spec 059, `tests/scripts/view_sh_test.ts`); `groom.md` and `resume.md`,
  which already point at the header; any edit to `plan.md`.
- #744: the "ask once" occurrences that are correct and are not touched: `/ship` with no argument
  (`templates/core/skills/ship/SKILL.md`), the `merge: manual` question (`phases/auto-chain.md`),
  the untrusted-scripts question at `phases/merge.md` step 0, groom's one column-mapping question
  (`groom.md`, exit 4 of `groom-columns.sh`), and the product owner's "more than one backend signal"
  question, which is about configuration, not classification. Also out of scope: tag pushes, money
  and irreversible acts, and questions about what an item is for.
- #746: the epic path (it already runs the tier), what a project declares in its tiers, the
  impact-resolution work of #725, and whether the exit-5 rebase row re-runs the full tier (it
  already says "re-run the gates" for both paths).

## 2. User scenarios

### US1 — an item with no creation time (P3, #742)

**Given** a project on the Cloud backlog whose server omits `createdAt` **When** `plan 12` or (Cloud
specs) `implement` reaches the `wip-audit.sh` call **Then** the agent is led to the header's rule,
runs `wip-audit.sh 12`, and reports that the date filter was off. It does not stop on exit 2.

### US2 — the same, with Cloud backlog and local specs (P3, #742)

**Given** `init` resolved backlog `cloud` and spec backend `local`, so `plan.md` renders no
`spec-backend=cloud` block **When** `plan 12` writes `12@—` and gets exit 2 **Then** the usage
output it reads names the header as the place that says what to pass.

### US3 — an ambiguous split (P2, #744)

**Given** `/task add` with a request that could be one item or an epic of four children **When** the
product owner plans it **Then** it creates the split it would defend and reports it in one line with
its reason. Nobody asks the user first.

### US4 — the session does not pre-decide (P2, #744)

**Given** a user who stated no priority **When** the main session dispatches the product owner
**Then** the dispatch carries no priority, and the session asked the user none. A priority the user
did state is passed on as theirs.

### US5 — a standalone item with a declared end-to-end suite (P2, #746)

**Given** a project with `full_gate:` declared and a standalone item that passed review **When**
`merge` runs **Then** the `full` tier runs once before the landing, a failure is fixed on the branch
and the tier re-run, and nothing lands past a failure.

### Edge cases

- `wip-audit.sh --limit 08 1` or any other usage error also prints the pointer. It is static text,
  printed on every usage error, and that does no harm.
- A product-owner dispatch that carries a priority the user never stated: the product owner weighs
  it as input, not as an instruction.
- Groom's "1–3 scope decisions still need the user's input": these are about what the item is for,
  so they stay, and the sweep records them as fenced off.
- A standalone project with no `full_gate:`: `run-gate.sh full` prints that nothing ran (as on an
  epic today). The merge goes on, and reports that nothing ran rather than a pass.
- A standalone run under `--pr`: step 1 runs before step 2, so the tier runs before the PR opens, as
  it already does on an epic.
- A project with `.specnaut/impact.json`: the standalone run reads exits `3` and `4`, the `removed:`
  line and the `scope:` line exactly as the epic run does, because one paragraph serves both paths.

## 3. Requirements

### #742 — pointer for an item with no creation time

- **FR-001** On a usage error, `wip-audit.sh` prints a second stderr line after the usage line. It
  points at the script's header for an item with no creation time and does not restate the rule.
  Proposed text, ASCII only (AGENTS.md: a printed line is ASCII when written or changed, so the
  usage line's `…` becomes `...` in the same edit):
  `usage: wip-audit.sh [--limit <N>] <num>[@<epoch>]...`
  `an item with no creation time: see the header of .specnaut/scripts/bash/wip-audit.sh` Stdout
  stays empty and the exit stays 2. The accepted grammar does not change: `12@—` is still refused.
- **FR-002** `implement.md`'s `spec-backend=cloud` block gains one separate sentence before the
  call. It points at the header and splits no pinned literal. It goes after the sentence "For an
  epic's child it is the epic, and `<epoch>` is `<task>`'s creation time." — for example "If its
  `view.sh` printed `—`, the header of `wip-audit.sh` says what to pass." This is needed because
  that block also says "a non-zero exit stops", so a stderr pointer alone would arrive after the
  stop.
- **FR-003** `templates/core/skills/task/phases/plan.md` is not edited in this commit. Its local
  render, and `implement.md`'s, stay byte-identical: `plan_local_golden.md` and
  `implement_local_golden.md` are not re-captured. No string in
  `tests/templates/plan_reentry_test.ts` is edited.
- **FR-004** The rule's text has one home. Across the bundle, no file but `wip-audit.sh` contains
  "date filter was off". Search: every `CORE_BUNDLE` entry plus every `HARNESS_STATIC` file.
- **FR-005** Every harness × every `everyBundleOption()` combination ships the pointer in
  `.specnaut/scripts/bash/wip-audit.sh`. The test asserts that the set includes at least one
  `backlogBackend: "cloud"`, `specBackend: "local"` combination.

### #744 — the product owner decides classification

- **FR-010** `templates/core/agents/product-owner.md` gains a section that states the rule:
  - priority, size, type and labels; one item, several, or an epic with children; whether a finding
    becomes a follow-up item; what comes next and what depends on what — all are the product owner's
    to decide;
  - it decides, puts the decision in the plan, and reports each one in one line with its reason in
    its summary; the user overrules afterwards;
  - a value the dispatch carries outside the user's own request is input, not an instruction;
  - it asks the user only what an item is meant to do, when only the user can know.
- **FR-011** In the "Epic detection heuristic", "Ambiguous split: ask once — …" becomes "**Ambiguous
  split**: pick the split you would defend, create it, report it."
- **FR-012** `backlog.md`, "The session protocol", step 2: the dispatch carries no priority, size,
  type, split or order the user did not state, and the session asks the user none of them.
  `SKILL.md`, "All backlog writes go through the Product Owner", says so in one sentence that names
  the product owner as the decider and points at `backlog.md`.
- **FR-013** `phases/plan.md` step 7 says that priority, size, type, a split and a follow-up ticket
  are never open questions, and that they are reported under item 4, "anything you decided
  yourself". This keeps step 7's line count. Measured candidate: item 3 ends "… the answer that
  invalidates the most others first. Never priority, size, type, a split or a follow-up ticket;"
  (still 4 lines), and item 4 reads "anything you decided yourself, one line each, those five
  included." (still 1 line).
- **FR-014** **Every** scaffolded agent and skill is free of an instruction to ask the user about
  priority, size, type, split, follow-up tickets or order. The search that enumerates the set:
  `grep -rniE "\bask(s|ed|ing)?\b|confirm|question|clarify" templates/core/agents templates/core/skills src/infrastructure/harness`
  filtered for `priorit|size|type|label|split|sub-task|epic|follow-?up|order|estimate`. Each hit is
  either fixed or recorded as fenced off (§ 1, Out of scope). On this base the only offending hit is
  `product-owner.md`'s ambiguous-split line.
- **FR-015** On `init`, and on `upgrade` wherever upgrade rewrites the file, the project gets the
  rule. Both write `harness.mapBundle(...)` (`src/application/init_project.ts`,
  `src/application/upgrade_project.ts`), so a test over every harness × option set covers both. A
  customised copy that upgrade preserves keeps its text; that is upgrade's existing contract.
- **FR-016** A bundle test, scoped to the product owner's "Epic detection heuristic" section, fails
  if the old split wording returns (`/ask once|ask the user/i` in that section, or the new sentence
  missing). It is observed red with the old line restored.
- **FR-017** `tests/fixtures/plan_local_golden.md` is re-captured in this commit. Its diff is the
  step 7 lines alone, checked with `git diff --stat` and by reading the diff. The golden test's
  header comment records the re-capture.

### #746 — the full tier on a standalone merge

- **FR-020** `merge.md` step 1 holds **one** paragraph that runs the full tier and reads its exits:
  the call, exits `3` and `4`, `removed:`, `removed: none` run bare, and a `scope:` other than
  `full`. It is the epic bullet's present text, moved, never copied, and every literal the smoke
  scripts grep for stays on one line. "Exit 0 — an epic" runs it, then loads `epic-fixups.md`. "Exit
  14 — standalone" runs it, then loads `merge-squash.md`.
- **FR-021** In that paragraph, a failure is fixed on the branch and the tier is re-run; it is never
  escalated, and nothing lands past a failure. On an epic the fix is a `--fixup` of the child at
  fault. On a standalone item it is a commit on the branch, which the squash then groups by scope.
  On the standalone path the gate runs **before** the squash: the squash leaves the tree as it is,
  and a fix made after it would mean squashing again.
- **FR-022** `quality-gates.md`:
  - "A standalone item" names the merge row (the `full` tier, once, through `phases/merge.md`) as
    well as the work-done row;
  - the failure text in "`full` — once, before the merge" covers a standalone item as well as the
    child at fault on an epic;
  - the file's line count does not grow (269 now; the reflow slack in those paragraphs is measured).
- **FR-023** `merge.md` and `quality-gates.md` state the same behaviour for a standalone item. One
  test asserts both sides.
- **FR-024** A test pins the gate on the standalone path:
  - the Exit 14 bullet runs the full-tier paragraph before it loads `merge-squash.md`;
  - `run-gate.sh full --base` is spelled exactly once in `merge.md`. It is observed red with the
    Exit 14 pointer removed.
- **FR-025** Two places say `merge-squash.md` is loaded "at its step 4". They are corrected to "step
  1": the header of `merge-squash.md` and the contract-doc table in `SKILL.md`. The code wins, and
  the document is corrected in the same change (plan step 3).

### Every item

- **FR-030** The `plugin/` mirror of each edited `templates/core/` file and
  `src/templates_bundle.ts` (`deno task bundle`, never hand-edited) follow in the same commit.
  `wip-audit.sh` has no plugin copy; `plugin/` holds `agents/` and `skills/` only.

## 4. Success criteria

- **SC-001** On every render, an agent that wrote `12@—` is told where the answer is, and on a
  Cloud-spec `implement` it is told before the call.
- **SC-002** No bundled instruction asks the user to classify, split or order backlog work. The one
  that did is pinned against returning.
- **SC-003** A standalone merge in a project with `full_gate:` runs that suite once before landing,
  with the same exit handling as an epic merge.
- **SC-004** `deno task test` is green after each of the three commits taken alone, and the two
  goldens are untouched by #742.

## 5. 🔒 Decision table

| The decision                                                                                        | Its single home                                                                                                           | What would duplicate it                                                                                                                                                                  |
| :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An item with no creation time is passed as `<n>` alone, and the caller says the date filter was off | the header of `templates/core/specnaut/scripts/bash/wip-audit.sh`                                                         | "date filter", "`<n>` alone" or "`<num>` alone" in any phase, skill or agent; the rule written out in the usage line rather than pointed at                                              |
| Where a reader of a usage error is sent                                                             | `usage()` in `wip-audit.sh` (asks the header; decides nothing)                                                            | a second usage function; the pointer in `wip-audit.sh`'s callers                                                                                                                         |
| Implement on Cloud specs is told before the call                                                    | `implement.md`, `spec-backend=cloud` block, one sentence                                                                  | a parenthetical inside "`wip-audit.sh <task>@<epoch>`; a non-zero exit stops"; any sentence outside a `spec-backend=cloud` block of `implement.md` or `plan.md` (it would move a golden) |
| What the product owner decides without asking, and how it reports                                   | `templates/core/agents/product-owner.md`, the new section                                                                 | a list of the decisions in `backlog.md`, `SKILL.md`, `groom.md` or `plan.md`; "ask once" or "confirm" near a split anywhere in the bundle                                                |
| How an ambiguous split is resolved                                                                  | `product-owner.md`, "Epic detection heuristic"                                                                            | a split rule in `backlog.md` "Epics & sub-tasks" (it points at the heuristic and must keep only pointing)                                                                                |
| The main session neither asks the user these nor dictates them                                      | `templates/core/skills/task/backlog.md`, "The session protocol" step 2 (the protocol's one home)                          | a second session-side rule in `groom.md`, `plan.md` or `auto-chain.md`; `SKILL.md` saying more than one pointing sentence                                                                |
| What may be an open question at the plan stop                                                       | `templates/core/skills/task/phases/plan.md` step 7                                                                        | the five decisions restated in `auto-chain.md` or `plan-template.md` § 12                                                                                                                |
| Which merges run the `full` tier, and how often                                                     | `templates/core/skills/task/phases/quality-gates.md` (moments table, "`full`" and "A standalone item" sections, one file) | an "epic only" or "standalone skips" clause in `merge.md`, `merge-squash.md` or `epic-loop.md`                                                                                           |
| The full-tier call at merge, and how its exits are read                                             | `templates/core/skills/task/phases/merge.md`, step 1, one paragraph                                                       | a second `run-gate.sh full --base` in `merge.md`, `merge-squash.md` or `epic-fixups.md`; the exit handling copied into a bullet; exits restated in `quality-gates.md`                    |

**No new script, helper or automation.** (a) Inventoried: `wip-audit.sh` (extended in place: one
static stderr line, same exits, same accepted grammar), `run-gate.sh` (reused directly, unchanged),
`epic-status.sh`, `land-feature.sh`, the product-owner executor `apply-plan.sh` (unchanged). (b) No
recurrence is needed, because nothing is built. (c) Outcome: _reuse directly_.

## 6. Technical context

**Language/Version**: Markdown templates, one Bash script; Deno/TypeScript tests **Primary
Dependencies**: none added **Storage**: N/A **Testing**: `deno test` with the task's permissions;
the smoke suite under `scripts/smoke/`; `go
test ./...` (the Go port embeds `templates/` whole)
**Target Platform**: consuming projects' harnesses (Claude Code, Codex; others best-effort)
**Project Type**: CLI that scaffolds agent instructions **Performance Goals**: N/A. #746 adds one
run of a project's own declared suite per standalone merge, which is what the project declared it
for. **Constraints**: the local goldens (#742 must not move them); the smoke scripts' single-line
`grep
-F` literals on `merge.md` and `quality-gates.md`; the size ratchet (§ 7) **Scale/Scope**:
about 9 template files, their plugin mirrors, the bundle, 3 new test files, 1 fixture

### Domain model

No new entities. Vocabulary kept: _item_, _creation time_, _date filter_, _standalone item_, _epic_,
_full tier_, _the product owner decides / reports_.

### Tests, one per item, new files

- **#742** — one new file, `tests/templates/wip_audit_pointer_test.ts`. Both existing homes are over
  their 200-line target and may not grow: `tests/scripts/wip_audit_test.ts` is 389 lines and
  `tests/templates/wip_audit_docs_test.ts` is 233. The new file checks:
  - FR-001: through the `sandbox()` helper of `tests/scripts/git_sandbox.ts`,
    `wip-audit.sh
    '12@—'` exits 2, stdout is empty, stderr carries the pointer line, and the
    script's header still carries the rule's sentence;
  - FR-004, the single home: the "date filter was off" sweep;
  - FR-002 on the cloud render of `implement`;
  - FR-005, the harness × option loop, with the cloud-backlog + local-spec floor. The existing usage
    test (`"usage: anything but a plain number or epoch is exit 2, nothing
  printed"`) stays green
    unchanged, since it checks stdout only. Red-probes: drop the pointer line (the script test and
    FR-005 go red); drop the implement sentence (FR-002 goes red).
- **#744** — `tests/templates/po_decides_classification_test.ts`, written like
  `wip_audit_docs_test.ts`: read from `CORE_BUNDLE` and `harness.mapBundle(...)`, compare with
  `flat()` from `tests/templates/task_docs.ts`. It checks:
  - FR-016 on the "Epic detection heuristic" section;
  - FR-010's section, present in every harness × option render;
  - FR-012 in `backlog.md` step 2 and `SKILL.md`;
  - FR-013 in `phase("plan")` step 7. `SKILL.md`'s new sentence must keep `read-items.sh` reachable
    for `po_dispatch_reads_items_test.ts`; it already names it. Red-probes: restore "ask once"
    (FR-016 goes red); drop the step 7 sentence (FR-013 goes red).
- **#746** — `tests/templates/standalone_full_gate_test.ts`, on `phase("merge")` and
  `phase("quality-gates")`. It checks:
  - FR-024: slice the "**Exit 14 — standalone**" bullet up to the next `- **Exit`; it runs the
    full-tier paragraph before `merge-squash.md`; `run-gate.sh full --base` is counted exactly once
    in `merge.md`; the Exit 0 bullet runs the same paragraph;
  - FR-022 and FR-023 on `quality-gates.md`. Red-probe: remove the Exit 14 pointer (FR-024 goes
    red).

## 7. Constitution check

The CLI repository has no `docs/constitution.md` on this base. Its binding rules are `AGENTS.md`
("Consumer agnosticism", "Conventions for work on this repo"), plus the workspace's boundary
principles.

| Principle                                                                                                                                  | Verdict | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :----------------------------------------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size limits (`.specnaut/memory/size-limits.md`; the repo's `.specnaut/size-limits.yml` exempts only `*.lock`, the bundle and the manifest) | pass    | Three files are over the 200-line target and may not grow: `plan.md` 230 (step 7 edit is line-neutral, measured), `backlog.md` 268 (step 2 +2 lines paid by reflowing two paragraphs of the same file to its 100-column width, with no word changed: "Closing a parent" 3→2 and the second "When NOT to use" bullet 2→1, measured), `quality-gates.md` 269 (the edited paragraphs have reflow slack: "`full`" failure paragraph 3→2, "A standalone item" 4→3). Every other file stays under target. |
| Consumer agnosticism (AGENTS.md)                                                                                                           | pass    | Examples are synthetic (`12`, `12@—`, "four children"). No project, vendor or host is named.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Never hand-edit `src/templates_bundle.ts`; `plugin/` mirrors byte for byte                                                                 | pass    | `deno task bundle`; mirrors copied in each item's commit; `tests/plugin/plugin_sync_test.ts`                                                                                                                                                                                                                                                                                                                                                                                                        |
| A printed shell line is ASCII when written or changed                                                                                      | pass    | FR-001: the usage line's `…` becomes `...`; the pointer line is ASCII                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A new assertion is shown red by mutating what it guards                                                                                    | pass    | each test's red-probe is listed in § 6 and recorded in its commit body                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A `feat` carries `## Agent adoption`                                                                                                       | pass    | #744 is `feat`; #742 and #746 are `fix` (see § 8, "Commits")                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| One home per rule (the plan phase's binding table)                                                                                         | pass    | § 5; #746 moves the epic's exit handling into one shared paragraph rather than copying it                                                                                                                                                                                                                                                                                                                                                                                                           |
| OSS / proprietary boundary                                                                                                                 | pass    | nothing from a private half; the backends named are Specnaut's own                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Files touched

| File                                                                        | Lines now | Lines after (est.) | Over target?      | Responsibility of each new module (one line)                        |
| :-------------------------------------------------------------------------- | --------: | -----------------: | :---------------- | :------------------------------------------------------------------ |
| `templates/core/specnaut/scripts/bash/wip-audit.sh`                         |       157 |                158 | no                | —                                                                   |
| `templates/core/skills/task/phases/implement.md` (+ plugin)                 |        83 |                 84 | no                | —                                                                   |
| `templates/core/agents/product-owner.md` (+ plugin)                         |       175 |              ≤ 190 | no                | —                                                                   |
| `templates/core/skills/task/SKILL.md` (+ plugin)                            |       141 |                143 | no                | —                                                                   |
| `templates/core/skills/task/backlog.md` (+ plugin)                          |       268 |              ≤ 268 | yes, may not grow | —                                                                   |
| `templates/core/skills/task/phases/plan.md` (+ plugin)                      |       230 |                230 | yes, may not grow | —                                                                   |
| `templates/core/skills/task/phases/merge.md` (+ plugin)                     |       149 |              ≤ 155 | no                | —                                                                   |
| `templates/core/skills/task/phases/quality-gates.md` (+ plugin)             |       269 |              ≤ 269 | yes, may not grow | —                                                                   |
| `templates/core/skills/task/phases/merge-squash.md` (+ plugin)              |        64 |                 64 | no                | —                                                                   |
| `tests/fixtures/plan_local_golden.md`                                       |       178 |                178 | no                | re-captured by #744 alone; step 7 lines only                        |
| `tests/infrastructure/harness/spec_backend_filter_golden_test.ts`           |       109 |                110 | no                | —                                                                   |
| `tests/templates/wip_audit_pointer_test.ts`                                 |         0 |                ~80 | no                | that every path to the no-creation-time rule points at its one home |
| `tests/templates/po_decides_classification_test.ts`                         |         0 |                ~90 | no                | that classification is decided, not asked                           |
| `tests/templates/standalone_full_gate_test.ts`                              |         0 |                ~60 | no                | that a standalone merge runs the full tier                          |
| `tests/scripts/wip_audit_test.ts`, `tests/templates/wip_audit_docs_test.ts` |  389, 233 |          unchanged | yes, not touched  | —                                                                   |

### Complexity tracking

None. No size violation is accepted. The three over-target files are held line-neutral, by
measurement, before commit.

## 8. Surface impact

| Surface                                     | Touched?        | What changes                                                                 |
| :------------------------------------------ | :-------------- | :--------------------------------------------------------------------------- |
| `wip-audit.sh` stderr on exit 2             | yes             | one static pointer line; stdout, exits and grammar unchanged                 |
| `/task implement` (Cloud specs)             | yes             | one pointer sentence                                                         |
| `/task plan`                                | yes (#744 only) | step 7 names five decisions as never open; local golden re-captured for that |
| Product-owner agent                         | yes             | decides splits and classification without asking; reports each in one line   |
| `/task` backlog verbs, router               | yes             | the session neither asks nor dictates classification                         |
| `/task merge`                               | yes             | a standalone merge runs the declared `full` tier before the squash           |
| Binary, CLI flags, lock file, HTTP contract | no              | —                                                                            |

**Surfaces added or widened:**

1. On an ambiguous split, the product owner's plan now carries `create` and `link` lines without a
   user confirmation. Its grant is unchanged (`tools: Read, Grep, Glob`). The executor's `scope_for`
   and refusal classes are unchanged, and every write is reported and reversible (close
   `not_planned`).
2. A standalone merge now executes the project's own `full_gate:` commands from `gates.yml`. The
   epic merge already does, and `merge.md` step 0's `specnaut verify-scripts` has already checked
   the helper scripts before step 1.

Checked and unchanged: tool grants, permission allowlists, hooks, new inputs reaching a shell (the
usage line is static text; `view.sh`'s `—` is still refused, never passed through), dependencies,
network, the files written in a consuming project.

### Commits

1. `fix(742): plan and implement lead an item with no creation time to wip-audit's header`. Files:
   `wip-audit.sh`, `implement.md`, plugin `implement.md`, bundle, tests.
2. `feat(744): the product owner decides priority, size, type and split, and reports them`. Files:
   `product-owner.md`, `SKILL.md`, `backlog.md`, `plan.md`, their plugin copies, bundle, the
   re-captured `plan_local_golden.md`, the golden test's header comment, tests. **This is the one
   `feat`**, so its body carries `## Agent adoption` with a ```prompt block: run `specnaut upgrade`;
   the product owner no longer asks about classification, splits or order, and reports each
   decision; a customised `product-owner.md` that upgrade preserved keeps the old "ask once" line
   until it is merged by hand or `--force` is used. Gate:
   `deno run --allow-run
   scripts/check-adoption.ts --from main --to HEAD`.
3. `fix(746): a standalone item's merge runs the full tier once before landing`. Files: `merge.md`,
   `quality-gates.md`, `merge-squash.md`, `SKILL.md` (FR-025), plugin copies, bundle, tests.

### Documentation (this feature)

```text
.specnaut/specs/068-phase-rules/
└── plan.md    # This file
```

## 9. Risks

| Risk                                                                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                  |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #742 moves a golden, as `cf9b0e68` did                                                                                                                                           | `plan.md` is not touched; the sentence in `implement.md` sits inside `spec-backend=cloud`; `spec_backend_filter_golden_test.ts` runs unchanged and green                                                                                                                                                                                    |
| A plan agent ignores stderr and runs alone after exit 2 (`auto-chain.md`: "a non-zero exit runs alone")                                                                          | the usage line is the only surface that reaches the cloud-backlog + local-spec render without moving the golden; accepted at P3, and the item climbs to P2 if another backend starts printing `—`                                                                                                                                           |
| #746's refactor breaks the smoke scripts' one-line `grep -F` literals (`smoke-gates.sh` "merge.md passes the merge-base…", `smoke-merge.sh` "merge.md runs the full tier once…") | literals are moved whole: `Run the full gate tier once`, `run-gate.sh full --base "$(git merge-base HEAD <base>)"`, `say which commands left it`, `With \`removed: none\`, everything was omitted: run it bare`,`neither is ever reported as the full gate`,`never per child` each stays on one line; both smoke scripts run before landing |
| Reflow to pay lines breaks a pinned literal                                                                                                                                      | the pinned strings near the reflowed paragraphs are compared through `flat()` (`trim_safety_test.ts`'s "another project's backlog" line); `deno task test` is read before landing                                                                                                                                                           |
| The product owner makes a split the user did not want                                                                                                                            | it reports it in one line with its reason; the user overrules; children close `not_planned`; nothing is deleted                                                                                                                                                                                                                             |
| #744's golden re-capture hides an unintended change                                                                                                                              | the fixture diff is read and must be the step 7 lines only                                                                                                                                                                                                                                                                                  |
| A standalone merge now takes as long as the project's suite                                                                                                                      | the project chose that by declaring `full_gate:`; a project without one pays nothing                                                                                                                                                                                                                                                        |

## 10. Architecture audit

Ran 2026-11-10 on `e42e4910`. Every finding accepted; the "What was done" column is **binding on the
implementer** and overrides § 3–§ 9 where they differ.

| #   | Finding                                                                               | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :-- | :------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | HIGH — the product owner's decision set is listed in three places that already differ | The only list lives in the new `product-owner.md` section. `backlog.md` step 2 and `plan.md` step 7 name that section, never its contents ("none of the calls `product-owner.md` «<section>» gives the product owner is asked of the user / is an open question"). #744 AC 2 and AC 3 are met by those pointers. FR-012/FR-013 tests assert the pointer, and one test asserts the list appears only in `product-owner.md`. § 5 row 7 rewritten to match |
| A2  | MEDIUM — the gate-failure fix rule is spelled in `quality-gates.md` and `merge.md`    | `merge.md` step 1's shared paragraph is the one home; `quality-gates.md`'s failure paragraph becomes a one-line pointer; a § 5 row is added; FR-023 asserts the pointer                                                                                                                                                                                                                                                                                 |
| A3  | MEDIUM — `quality-gates.md` held its line count only by re-wrapping 80 → 100 columns  | A2's pointer pays the lines; `quality-gates.md` stays at 80 columns                                                                                                                                                                                                                                                                                                                                                                                     |
| A4  | MEDIUM — the FR-024 Exit 0 slice has no end once the paragraph moves                  | Each slice ends at the end of the list or at the paragraph's label; the Exit 0 pointer is red-probed as well as Exit 14                                                                                                                                                                                                                                                                                                                                 |
| A5  | LOW — the shared paragraph must name its exits                                        | It opens "exits 0 and 14 only"; the literals to protect are rebuilt with `grep -F` over `scripts/smoke` and `tests/`, not taken from § 9                                                                                                                                                                                                                                                                                                                |
| A6  | LOW — FR-002 must not re-wrap `implement.md:16-20`                                    | Break line 16 after "creation time.", new sentence on its own line, lines 17-20 untouched                                                                                                                                                                                                                                                                                                                                                               |
| A7  | LOW — the step number loading `merge-squash.md` is stated twice                       | Both refer to "Exit 14 — standalone", not a step number                                                                                                                                                                                                                                                                                                                                                                                                 |
| A8  | LOW — FR-004's search is narrower than § 5 row 1                                      | It searches all three spellings ("date filter was off", "`<n>` alone", "`<num>` alone")                                                                                                                                                                                                                                                                                                                                                                 |
| A9  | LOW — the new `SKILL.md` sentence must only point                                     | It names the product-owner section as the decider, nothing more; the test asserts the pointer                                                                                                                                                                                                                                                                                                                                                           |
| A10 | LOW — a fix commit after a standalone gate failure lands unreviewed                   | Accepted in § 9 as the epic path's existing behaviour, bounded by S3 below                                                                                                                                                                                                                                                                                                                                                                              |
| A11 | LOW — "Obvious" and "Ambiguous split" now prescribe the same action                   | One bullet: "Split, obvious or ambiguous: create the split you would defend, report it with its reason." The #744 test pins the absence of the old "ask once" split wording                                                                                                                                                                                                                                                                             |
| A12 | LOW — § 7 cites a missing size-limits path                                            | Cites `templates/core/specnaut/memory/size-limits.md`                                                                                                                                                                                                                                                                                                                                                                                                   |

**Verdict**: fail on A1, resolved by the pointers; A2–A12 folded. Coverage: all ten line counts, the
rule homes, the smoke literals, the three items' targets.

## 11. Security audit

Ran 2026-11-10 on `e42e4910`, separately. Every finding accepted. Threshold confirmed: an agent
instruction surface, **and** a widened command-execution context (a standalone merge now runs the
project's `full_gate:`).

| #  | Finding                                                                                                                 | What was done                                                                                                                                                                                                                                                                                                                                    |
| :- | :---------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 | MEDIUM — the product owner could file a security finding publicly without asking                                        | The new `product-owner.md` section adds: a finding from the security seat is never filed with its path or impact on a tracker the public can read — it is filed with the detail withheld, or through the project's private channel, and the report says so; one assertion in the #744 test                                                       |
| S2 | LOW — "every write is reversible" is wrong on a public tracker; grooming applies the no-ask split to items others wrote | § 8/§ 9 corrected ("reversible on the board; a create on a public tracker is visible and notifies"). The new authority covers create, classify and link only — it never closes, marks not planned, re-parents or rewrites an item someone else filed. Child titles and bodies are written by the product owner, never copied from an item's body |
| S3 | MEDIUM — without `impact.json`, a branch can edit the `full_gate:` list that judges it                                  | The shared step-1 paragraph: if `git diff --quiet <merge-base> HEAD -- .specnaut/gates.yml` is non-zero, stop on the branch and name the change; that run is never reported as the full gate. FR-021 adds "a fix never edits `.specnaut/gates.yml`". A red-probed assertion in the standalone full-gate test                                     |
| S4 | INFO — the #742 pointer stays a fixed literal                                                                           | FR-001's test asserts stderr does not contain the rejected argument                                                                                                                                                                                                                                                                              |

**Verdict**: needs_followup, nothing CRITICAL/HIGH; S1 and S3 folded before implement.

## 12. Open questions

None. All three items are engineering; the one product decision (#746) is already settled.

| Question                                                                                  | Answer                                                                                                                                                                         | Date       |
| :---------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------- |
| Does a standalone item's merge run the `full` tier, or is the document corrected instead? | Runs it. The document is right and the behaviour is wrong; correcting the document would silently remove a gate projects configured. Settled by the product owner on the item. | 2026-11-06 |

### Done, as runnable checks

- `deno task test`: it runs the bundle first, then every test with the task's permissions. Read the
  result in its own call before landing. In particular:
  `tests/infrastructure/harness/spec_backend_filter_golden_test.ts`,
  `tests/integration/upgrade_spec_backend_test.ts` (it reads `plan_local_golden.md`),
  `tests/templates/plan_reentry_test.ts`, `tests/scripts/wip_audit_test.ts`,
  `tests/templates/wip_audit_docs_test.ts`, `tests/templates/test_tiers_test.ts`,
  `tests/templates/script_gate_docs_test.ts`, `tests/templates/po_dispatch_reads_items_test.ts`,
  `tests/plugin/plugin_sync_test.ts`, and the three new files.
- Each new assertion's red-probe (§ 6), run and recorded in the commit body.
- After the #742 commit: `git diff e42e4910 -- tests/fixtures/` is empty.
- After the #744 commit: `git diff HEAD~1 -- tests/fixtures/plan_local_golden.md` shows step 7 only.
- `deno fmt --check`, `deno lint`, `deno check src/main.ts` (the pre-commit hook), and
  `shellcheck
  templates/core/specnaut/scripts/bash/wip-audit.sh`.
- `wc -l` on every file in § 7 against "lines now";
  `bash .specnaut/scripts/bash/size-ratchet.sh --since main --report` where the tree has it.
- `go test ./...`: the Go port embeds `templates/`.
- `bash scripts/smoke/run-all.sh --only smoke-gates.sh`, `--only smoke-merge.sh`,
  `--only
  smoke-features.sh`, then `bash scripts/smoke/audit.sh --since main`.
- `deno run --allow-run scripts/check-adoption.ts --from main --to HEAD` (the #744 `feat`).
- The FR-014 sweep, re-run on the final tree, its hits recorded in the #744 commit body.

### Decided without asking

- #742: the surface is the `usage()` stderr line of `wip-audit.sh`, plus one sentence in
  `implement.md`'s Cloud block. Rejected:
  - any text in `plan.md` — its Re-entry paragraph is backend-neutral and goldened, and a
    `spec-backend=cloud` sentence there misses the Cloud backlog with local specs;
  - a `backlog=cloud` marker in `plan.md` — the golden renders the raw entry, so it would move too;
  - accepting `12@—` in the script — out of scope by the item.
- #742: the usage line points at the header and does not restate the rule, so the header stays its
  one home.
- #742: `implement.md` gets its pointer **before** the call, because its block stops on any non-zero
  exit.
- #744: the main session's conduct is homed in `backlog.md`'s session protocol, the protocol's one
  home; `SKILL.md` carries one pointing sentence because the item's AC names both files.
- #744: the bundle test is scoped to the split rule, as the AC says. The broader FR-014 property is
  a named sweep, not a test, because a broad regex would hit the fenced-off "ask once" occurrences
  that are correct.
- #744: groom's "scope decisions" stay; they are about what an item is for.
- #746: one shared full-tier paragraph in `merge.md` step 1, instead of a second copy of the exit
  handling in the Exit 14 bullet. Two spellings of the same exits would drift, and that is the
  plan's two-homes defect.
- #746: on the standalone path the gate runs before the squash, because the squash keeps the tree
  and would have to be redone after a later fix.
- #746: the stale "at its step 4" in `merge-squash.md` and `SKILL.md` is corrected in this commit,
  because the standalone path it describes is the one this commit changes.
- #746: the commit is a `fix`. The item is a Bug, and an existing user needs to do nothing by hand
  after upgrading.
- `.specnaut/feature.json` is left alone by this brief. It still links spec 064; the plan phase's
  step 2 rewrites it when the chain runs.
