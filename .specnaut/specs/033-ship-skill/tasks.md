# Tasks — Extract release concerns into a top-level `/ship` skill

- **Feature:** `033-ship-skill` · **Branch:** `033-ship-skill`
- **Backlog item:**
  [#598 — Extract release concerns into a top-level /ship skill](https://github.com/specnaut/specnaut-cli/issues/598)
- **Plan:** `.specnaut/specs/033-ship-skill/plan.md` — read it whole before starting.

## How this breakdown is shaped

**Two commits, decided at the plan stop.** Phase 2 is the `phase`/`backlog-doc` convergence and
lands **alone**, with no user-visible change: 21 manifest renames, seven adapter branches collapsed,
three mirrors reduced to one derivation. Phases 3–6 are the `/ship` extraction on top. A reviewer
reads a mechanical rename separately from a behaviour change.

**The 🔒 decision table is binding.** Where a task touches a rule from `plan.md` §5, the task names
that rule's home. A task that puts a decision anywhere else is a plan violation, not a style
question — amend the plan first.

**Tests are not optional here.** Two of the plan's findings are about gates that break or silently
narrow (§10 A-1, A-6), so the gates are the deliverable, not the scaffolding around it.

---

## Phase 1 — Setup: close the audit's three unverified surfaces

The architecture audit flagged these as unconfirmed rather than asserting them. They are cheap, they
are independent, and each can change a later task's shape — so they run first and their answers are
written into `plan.md` §10.

- [x] T001 [P] Determine whether CI re-runs `deno task bundle` and fails on a dirty committed
      `src/templates_bundle.ts`; record the answer in `.specnaut/specs/033-ship-skill/plan.md` §10
      under "Unverified". Check `.github/workflows/ci.yml` and any sibling workflow.
- [x] T002 [P] Determine whether the Antigravity and Copilot distribution manifests enumerate skills
      individually or point at a directory; record in `.specnaut/specs/033-ship-skill/plan.md` §10.
      Check `plugin/.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
      `.cursor-plugin/plugin.json` and any Antigravity/Copilot equivalent.
- [x] T003 [P] Determine whether `tests/plugin/mirror-exclusions.txt` and
      `tests/plugin/source-exclusions.txt` need a `/ship` entry for the sync gate to pass; record in
      `.specnaut/specs/033-ship-skill/plan.md` §10.

---

## Phase 2 — Foundational: converge `phase` onto the `backlog-doc` shape

**Blocking prerequisite for every user story, and its own commit.** Goal: one sub-document category
shape, one destination helper, one coverage derivation — with zero change to any scaffolded file.
That last clause is the test: the generated `src/templates_bundle.ts` destinations must be
byte-identical before and after this phase.

### The safety net comes first

- [x] T004 Capture a destination baseline: write a throwaway script that maps `CORE_BUNDLE` through
      every harness adapter and dumps `<harness> <destination>` sorted, saving it to
      `/tmp/dest-baseline.txt`. This is the oracle for T015 — do not skip it, and do not commit it.

### The shape change

- [x] T005 In `src/domain/core_bundle.ts`, define the converged sub-document contract: `name` holds
      the **owning skill**, `suffix` holds the document, and the subdirectory is a property of the
      category. Update the `CoreCategory` doc comment so the convention is stated where the type is,
      not in seven adapters.
- [x] T006 Add `skillDocDestination(entry, opts)` in `src/infrastructure/harness/skill_folder.ts` —
      the **single home** for "where a skill sub-document lands for a harness" (`plan.md` §5). It
      takes the nested-vs-flat shape and the optional subdirectory, and it is the only function
      composing a `skills/<owner>/…` path.
- [x] T007 Rewrite the 21 `phase` entries in `templates/manifest.json` to the converged shape:
      `name` becomes `specnaut`, `suffix` keeps the document filename. Verify the count is 21 and
      that no `phase` entry retains a document name in `name`.

### Collapse the adapters — each is independent

- [x] T008 [P] In `src/infrastructure/harness/claude_harness.ts`, collapse `case "phase"` and
      `case "backlog-doc"` into one branch calling `skillDocDestination`. Delete the comment that
      says the two branches are "the same shape" — it is no longer describing a duplication, it is
      describing the code.
- [x] T009 [P] Same collapse in `src/infrastructure/harness/codex_harness.ts` (note: this adapter
      builds `out[dest]` inline in `mapBundle` rather than via a `destinationFor`).
- [x] T010 [P] Same collapse in `src/infrastructure/harness/cursor_harness.ts`.
- [x] T011 [P] Same collapse in `src/infrastructure/harness/opencode_harness.ts`.
- [x] T012 [P] Same collapse in `src/infrastructure/harness/antigravity_harness.ts`.
- [x] T013 [P] Same collapse in `src/infrastructure/harness/windsurf_harness.ts` — the flat case.
      Its `case "phase"` currently inlines `` `specnaut-${suffix}` ``; that prefix rule moves into
      `skillDocDestination` so the flat naming has one home too (`plan.md` §5).
- [x] T014 [P] Same collapse in `src/infrastructure/harness/copilot_harness.ts` — the other flat
      case, `instructions/specnaut-<suffix>.instructions.md`.

### Prove the collapse changed nothing

- [x] T015 Re-run the T004 baseline script and `diff` against `/tmp/dest-baseline.txt`. **It must be
      empty.** A non-empty diff at this point means the convergence moved a scaffolded file, which
      this phase exists not to do.

### Delete the third mirror rather than gate it

- [x] T016 In `src/domain/plugin_coverage.ts`, derive `PLUGIN_COVERED_PATHS_CLAUDE` from
      `CORE_BUNDLE` through `ClaudeHarness`'s own destination function, and reduce
      `isPluginCoveredPath` to membership in that derived set (FR-013). Delete the hand-maintained
      name list and the two composed path literals — they are what `plan.md` §5 names as the
      duplication to eliminate.
- [x] T017 Update `tests/domain/plugin_coverage_parity_test.ts`: the phase assertion currently
      compares `coveredNames(".claude/skills/specnaut/phases/")` against `bundleNames("phase")`, an
      invariant that dies with the category shape. Replace it with an assertion that the derivation
      and the bundle agree **without restating any prefix**. Removing this test is not an option —
      it is the gate that made the mirror tolerable.
- [ ] T018 Extend `tests/domain/plugin_coverage_test.ts` with a case proving a sub-document owned by
      a skill other than `specnaut` is covered. **Observe it red first** against the pre-T016 code —
      a green assertion here proves nothing until the code under test has been neutered and seen to
      fail.

### Close the two gate defects the audit found

- [x] T019 Add a duplicate-destination guard at the adapters' shared write site so `out[dest] = …`
      refuses a second write to the same key (FR-006). This is the **home** of the invariant; a test
      alone is the detector, not the home (`plan.md` §5).
- [x] T020 Add `tests/infrastructure/harness/destination_uniqueness_test.ts`: for every harness, map
      the full `CORE_BUNDLE` and assert no destination collides. Prove it red by temporarily giving
      two entries the same destination.
- [x] T021 In `tests/integration/phase_wiring_test.ts`, replace the hardcoded
      `.claude/skills/specnaut/phases/` prefix in `phaseDest` and in T012's `dest.startsWith` filter
      with a derivation from the bundle through the adapter (§10 A-6). A gate whose coverage can
      shrink without failing is worse than one that goes red.
- [x] T022 Run `deno task test`. Then commit Phase 2 alone:
      `git commit -m "refactor: converge phase and backlog-doc onto one sub-document shape"`. The
      body must record that no scaffolded destination changed, citing the T015 diff.

### What Phase 2 actually cost, recorded against what it predicted

Three things the breakdown did not foresee, all found by building it:

- **The convergence breaks every lookup-by-phase-name.** `name` is the owner now, so
  `CORE_BUNDLE.find((e) => e.category === "phase" && e.name === "merge")` silently matches nothing.
  Ten test files did exactly that, and the fix is not ten suffix-stripping expressions — that is the
  duplication §5 forbids — but one accessor: `skillDocName` / `findSkillDoc` in `core_bundle.ts`.
  Added as part of T005 rather than as its own task, because a shape change that leaves callers no
  way to address the thing is not finished.
- **Written-reason allow-lists are keyed on the old name.** `removed_artefacts` and
  `response_style_contract` record exemptions as `tasks|tasks.md` and `phase/plan/plan.md`. Their
  keys had to follow the shape; their _entries_ did not change, and none was deleted.
- **T004's oracle cannot see a collision.** It reads `Object.keys()` of the finished bundle, so a
  duplicate destination has already been absorbed by the time it looks. That is precisely why
  FR-006's home is the write site and not a test — and it was only visible once the oracle existed.

The sweep with `addUnique` live across all 32×7 combinations throws nowhere, so no collision exists
today and the guard is safe to add rather than a behaviour change.

---

---

## Phase 3 — US1 (P1): a user ships a release

**Goal:** `/ship` exists, is bundled for all seven harnesses, and carries the tag and release
content. **Independent test:** scaffold a fresh project for each harness and confirm `/ship` and its
sub-documents are present and within limits.

**These two open Phase 3, before anything else.** An architecture review of the Phase 2 commit found
them; both need a signature or a semantics decision rather than a correction, and both stop being
cheap the moment a non-`specnaut` document exists.

- [x] T022a [US1] `harness_commands.ts` hardcodes `/specnaut ${name}` in `NESTED_PHASES` /
      `FLAT_PHASES`, and `HarnessCommands.phase` has signature `(name: string) => string` — **no
      parameter can carry an owner**. Change it to take the owner, thread `entry.name` through the
      call site in `init_handler.ts`, and cover the flat case: on Windsurf the current code would
      emit `/specnaut-release-version` for a file written at `specnaut-ship-release-version.md`,
      which is a broken command string rather than a wrong label.
- [x] T022b [US1] `plugin_coverage_parity_test.ts` compares document names against
      `coveredNames(".claude/skills/specnaut/phases/")` — a list hardcoded to one owner. The moment
      `/ship` owns a document the test goes red, and the obvious way to green it is to add a
      `specnaut/phases/<ship-doc>.md` path that is never scaffolded — which is bug #455 exactly, the
      bug that file's docstring exists to prevent. Compare `(owner, document)` pairs, or derive the
      covered set through the adapter the way `phase_wiring_test.ts` already does. **Settle this
      before T023**, or the wrong entry is already in the list.

- [x] T023 [US1] Create `templates/core/skills/ship/SKILL.md` — the router. It carries the
      frontmatter (`name`, `description`, `argument-hint`, `when_to_use` with the tag/release
      trigger phrases moved off `/specnaut`), the three operational paths (tag only · tag and
      release · release an existing tag) and the disambiguation prompt from #598.
- [x] T024 [US1] Move `templates/core/skills/specnaut/phases/tag-version.md` to
      `templates/core/skills/ship/phases/tag.md` with `git mv`, so the history follows the content.
      Rewrite its internal references from `/specnaut tag-version` to `/ship`.
- [x] T025 [US1] Move `templates/core/skills/specnaut/phases/release-version.md` to
      `templates/core/skills/ship/phases/release.md` the same way, rewriting its self-references.
- [x] T026 [US1] Add the three `/ship` entries to `templates/manifest.json` — one `skill`
      (`name: ship`) and two sub-documents (`name: ship`, `suffix: tag.md` / `release.md`) — plus
      repoint the five `phase-script` sources to `core/skills/ship/scripts/`. Per `plan.md` §5,
      `phaseScriptDestination` **must not** be touched: the scripts' runtime address is
      owner-independent by design.
- [x] T027 [US1] `git mv` the five release scripts from `templates/core/skills/specnaut/scripts/` to
      `templates/core/skills/ship/scripts/`. Confirm with the T004 baseline technique that their
      **destinations** are unchanged — only the source directory moves.
- [x] T026a [US1] Add `skill/ship` to `POINTED_BY_DECISION` in
      `tests/templates/response_style_contract_test.ts` with a written reason. `/ship` points at the
      response-style contract, and that test fails any surface doing so without a recorded reason.
      The reason is not boilerplate: unlike `/board` — which is in `WITHHELD_BY_DECISION` because
      its worst-case Windsurf render leaves 38 characters and the pointer costs 98 — `/ship` has
      ~6,500 characters of headroom AND asks a genuine disambiguation question, so the contract's
      questions-as-selections rule is load-bearing for it rather than incidental.
- [x] T027a [US1] Move the `core/skills/specnaut/scripts/` entry in
      `tests/plugin/source-exclusions.txt` to `core/skills/ship/scripts/` and rewrite its reason —
      it currently names `/specnaut tag-version` and `/release-version`, which T033 retires. Found
      by T003: that file reports an entry naming a path that no longer exists as stale, so leaving
      it behind turns the plugin sync gate red for the wrong reason.
- [x] T028 [US1] Mirror the new skill into `plugin/skills/ship/` (FR-009) and add the pair to
      `SYNC_PAIRS` in `tests/plugin/plugin_sync_test.ts`.
- [x] T029 [US1] Add a Windsurf size assertion for every `/ship` document, measured with
      `workflowLength` and **not** `String.length` (FR-007, `plan.md` §5). The two documents are
      2,591 and 9,599 code points against a 12,000 cap — each passes alone, and the test exists to
      keep it that way.
- [x] T030 [US1] Run `deno task bundle`, then verify the generated `src/templates_bundle.ts` carries
      `/ship` for all seven harnesses.
- [x] T031 [US1] Extend `scripts/smoke/smoke-tag-release.sh` to assert the scaffolded `/ship` paths
      rather than the retired `/specnaut` phase paths, for both versioning schemes.
- [x] T032 [US1] Add `/ship` to the surface map in `scripts/smoke/audit.sh` so a future `/ship`
      document with no smoke coverage is reported rather than shipped silently.

---

## Phase 4 — US2 (P2): the old address retires loudly

**Goal:** nobody reaching for `/specnaut tag-version` gets a bare "unknown phase". **Independent
test:** invoke the retired names and read the output.

- [x] T033 [US2] Strip every release concern from `templates/core/skills/specnaut/SKILL.md` — the
      two phase-index rows, the `tag-version`/`release-version` trigger phrases in `when_to_use`,
      the `description` and `argument-hint` (FR-003, SC-002).
- [x] T034 [US2] Add the retirement branch to the router's phase-extraction step: the two names are
      **retired**, not unknown, and the message names `/ship` (FR-004). Per `plan.md` §5 this lives
      in the router's own step — not as a note repeated at each removed document's former location.
- [x] T035 [US2] ~~Update `templates/core/skills/specnaut/phases/auto-chain.md` so the chain
      contract carries no release phase.
- [x] T036 [US2] Sync `plugin/skills/specnaut/` to match (`SKILL.md`, the removed phase docs,
      `auto-chain.md`).
- [ ] T037 [US2] Add a test asserting both retired names produce a message naming `/ship`, and that
      neither routes silently.

---

## Phase 5 — US3 (P3): an existing project upgrades cleanly

**Goal:** a pre-change scaffold upgrades to the same file set as a fresh one, and a customised
release document survives the move. **Independent test:** scaffold at the previous version, upgrade,
diff against a fresh scaffold.

- [ ] T038 [US3] Implement rename-in-lock — settled at the plan stop (`plan.md` §12). A document
      whose address changed carries its lock identity to the new path so its customised bytes travel
      with it. Home: the lock's rename handling (`plan.md` §5).
- [ ] T039 [US3] Extend `tests/integration/upgrade_removed_phases_test.ts` — the closest existing
      analogue — rather than writing a new test: add the two `/ship` documents to `REMOVED_PHASES`
      and cover the **customised** case explicitly.
- [ ] T040 [US3] Add an upgrade test for the FR-010 boundary: an **unmodified** orphan is removed, a
      **customised** one is not (it keeps the `wasCustomized` treatment — deleted only under
      `--force`, with a backup). Prove the customised half red by making the code delete
      unconditionally.
- [ ] T041 [US3] Add the test that closes §11 finding 1 end to end: scaffold, customise a release
      document, upgrade, and assert the customisation is what the agent now reads at the new
      address. A test that only checks the file exists somewhere would pass against the exact defect
      this is for.
- [ ] T042 [US3] Update the per-harness assertions in
      `tests/infrastructure/harness/{claude,codex,copilot,cursor,opencode,windsurf}_harness_test.ts`
      and the integration scaffolding tests that assert literal `.claude/skills/specnaut/phases/*`
      paths. These are `plan.md` §5's named duplicate and are pre-existing — fix the assertions, and
      do not expand scope into rewriting them all to call the adapter.

---

## Phase 6 — Polish & cross-cutting

- [ ] T043 [P] Update `README.md` so the three-skill model is what a reader meets first.
- [ ] T044 [P] Update `src/domain/plugin_coverage.ts`'s module doc comment — it currently describes
      the specnaut-only phase convention in prose that T016 makes false.
- [ ] T045 Run the full smoke suite: `bash scripts/smoke/run-all.sh`.
- [ ] T046 Run `deno task test` and
      `cd apps/specnaut-cli && deno run --allow-run scripts/check-adoption.ts --from main --to HEAD`
      — this is a `feat`, so the `## Agent adoption` section is a landing gate.
- [ ] T047 Commit Phase 3–6 as the second commit, then hand to `review`.

---

## Dependencies

```
Phase 1 (T001-T003)  ─── independent, informs later shapes
        │
Phase 2 (T004-T022)  ─── BLOCKING: its own commit, zero scaffolded change
        │
        ├─→ Phase 3 (US1, T023-T032)  ── /ship exists
        │         │
        │         ├─→ Phase 4 (US2, T033-T037)  ── old address retires
        │         └─→ Phase 5 (US3, T038-T042)  ── upgrade path
        │
        └─────────────→ Phase 6 (T043-T047)  ── after all stories
```

US2 and US3 both depend on US1 (there is nothing to retire toward, and nothing to upgrade to, until
`/ship` exists) but are independent of each other.

## Parallel opportunities

- **T001–T003** — three independent reconnaissance questions.
- **T008–T014** — the seven adapter collapses touch seven different files.
- **T043–T044** — two unrelated documentation files.

Phases 2's test tasks are deliberately **not** parallel with its implementation tasks: T018, T020
and T021 each require observing a red state against code that must still exist when the probe runs.

## MVP scope

**Phase 2 + Phase 3 (US1).** That is a converged bundle contract and a working `/ship` on every
harness. It is shippable in the sense that the new skill works — but note it is _not_ landable
alone: until Phase 4 runs, `/specnaut` still advertises two phases whose documents have moved, which
is a worse state than either end. Phases 2–5 land together in the second commit.

## Format validation

47 tasks. Every task carries a checkbox, a sequential `T0NN` id, a `[P]` marker where
parallelisable, a `[US*]` label in the three user-story phases only, and an explicit file path.
