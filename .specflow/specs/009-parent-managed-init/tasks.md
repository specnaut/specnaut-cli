---
description: "Task list for parent-managed detection (init/upgrade)"
---

# Tasks: Parent-managed detection for init/upgrade

**Input**: Design documents from `.specflow/specs/009-parent-managed-init/` **Prerequisites**:
plan.md, spec.md, research.md, data-model.md, contracts/parent-managed-detection.md **Linked
issue**: mkrlabs/specflow#371

**Tests**: INCLUDED — the behavioural contract C1–C5 and the unit truth-tables are themselves
acceptance criteria (SC-001…SC-006). TDD: write the test, watch it fail, implement, watch it pass.

**Organization**: grouped by user story. US1 (suppress on init) + US2 (standalone unchanged) are the
MVP; US4 (upgrade no-resurrect) and US3 (override) layer on top.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1/US2/US3/US4 — Setup/Foundational/Polish carry no story label
- Paths are relative to `apps/specflow/`

## Path Conventions

Single project: `src/` and `tests/` at `apps/specflow/` root, hexagonal layers `domain/` →
`application/` → `infrastructure/` → `cli/`; tests mirror `src/`.

---

## Phase 1: Setup

- [x] T001 Confirm branch `009-parent-managed-init` is checked out in `apps/specflow/` and
      `deno task test` is green on a clean tree (baseline for SC-002 parity).

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**These are the pure/port primitives every story depends on. Complete before Phase 3.**

- [x] T002 [P] Write failing unit tests for the domain predicates in
      `tests/domain/parent_managed_test.ts`: `isParentManaged` truth table (standaloneOverride=true
      ⇒ false; ancestor=null ⇒ false; ancestor set & no override ⇒ true) and `isAgenticPath` prefix
      matrix (`.claude/skills/…`, `.claude/agents/…`, `.claude/commands/…` ⇒ true; `.specflow/…`,
      `AGENTS.md`, `.claude/settings.json` ⇒ false).
- [x] T003 Implement `src/domain/parent_managed.ts` with pure
      `isParentManaged(providingAncestor, standaloneOverride)` and `isAgenticPath(dest)` until T002
      passes. No `Deno.*` imports.
- [x] T004 [P] Add the `ParentWorkspaceReader` port interface to `src/application/ports.ts`
      (`findProvidingAncestor(targetDir): Promise<string|null>`,
      `hasStandaloneOverride(targetDir): Promise<boolean>`) per contracts §1.
- [x] T005 Write failing adapter tests in `tests/infrastructure/fs_parent_workspace_reader_test.ts`
      using `Deno.makeTempDir`: providing ancestor matched (has `.specflow/` + `deno.json` workspace
      member resolving to target); ancestor with `.specflow/` but non-matching member ⇒ null;
      ancestor with matching member but no `.specflow/` ⇒ null; relative/symlinked member path
      canonicalised (FR-004); `standalone.yml` present ⇒ `hasStandaloneOverride` true; walk stops at
      filesystem root ⇒ null.
- [x] T006 Implement `src/infrastructure/fs_parent_workspace_reader.ts` (`FsParentWorkspaceReader`)
      — upward `dirname` walk, per-ancestor `.specflow/` stat + `deno.json` parse, `@std/path`
      resolve + `Deno.realPath` canonicalisation, tolerate missing/unparseable `deno.json` — until
      T005 passes.
- [x] T007 [P] Extend `tests/domain/installed_lock_test.ts`: `parent_managed: true` round-trips
      through `serializeLock`/`parseLock`; absent key ⇒ `parentManaged` undefined; legacy lock (no
      key) parses cleanly.
- [x] T008 Add `readonly parentManaged?: true` to `InstalledLock` in `src/domain/installed_lock.ts`;
      emit `parent_managed: true` only when set in `serializeLock`; default to `undefined` in
      `parseLock` — until T007 passes.

---

## Phase 3: US1 — Suppress agentic files on init (Priority: P1) 🎯 MVP

**Goal**: `specflow init` inside a providing-workspace member provisions `.specflow/` but writes
zero `.claude/skills|agents|commands` files, and prints the notice once.

**Independent test**: integration fixture with a parent dir (`.specflow/` + `deno.json`
`workspace:["./child"]`) → `init` in child → assert 0 agentic files, `.specflow/` present, notice
shown.

- [x] T009 [US1] Write failing unit cases in `tests/application/init_project_test.ts` with a fake
      `ParentWorkspaceReader`/`parentManaged` input: assert `writer.written` and the built lock
      `entries` both exclude `isAgenticPath` dests when parent-managed; include all dests when not.
- [x] T010 [US1] Add `parentManaged: boolean` to `InitProjectInput` and apply the bundle filter in
      `InitProjectUseCase.execute()` immediately after `harness.mapBundle(...)` — build both
      `writeBundle` input and lock entries from the filtered bundle; set `lock.parentManaged` from
      the input — until T009 passes.
- [x] T011 [US1] Write failing integration test
      `tests/integration/init_parent_managed_test.ts::parent-managed suppresses agentic` (C1): build
      temp providing-workspace fixture, run `init` in the member, assert 0 files under
      `target/.claude/skills` & `target/.claude/agents`, `.specflow/` provisioned, notice line
      emitted.
- [x] T012 [US1] Wire detection into `cli/handlers/init_handler.ts` `runInit`: call
      `hasStandaloneOverride` + `findProvidingAncestor`, compute `isParentManaged`, pass
      `parentManaged` into `InitProjectInput`, and print exactly once
      `parent-managed workspace detected — skills/agents inherited from parent` when true — until
      T011 passes.

**Checkpoint**: US1 done — the core regression is closed. SC-001, SC-006 green.

---

## Phase 4: US2 — Standalone clone unaffected (Priority: P1)

**Goal**: no enclosing providing workspace (or a non-providing Deno workspace) ⇒ provisioning
byte-for-byte unchanged; CLI never special-cased.

**Independent test**: standalone temp dir → `init` → skills/agents written exactly as baseline.

- [x] T013 [US2] Add integration cases to `tests/integration/init_parent_managed_test.ts`:
      `standalone provisions normally` (C2 — no enclosing workspace ⇒ agentic files written, no
      notice) and `non-providing ancestor` (enclosing Deno workspace with no `.specflow/` ⇒
      detection false). Assert parity against the standalone baseline file set.
- [x] T014 [US2] Verify (and adjust handler/use-case only if a test fails) that the
      not-parent-managed path is unchanged — no new branches taken, no notice, full bundle written.
      No CLI-identity check anywhere (FR-010).

**Checkpoint**: US1+US2 = shippable MVP. SC-002 green.

---

## Phase 5: US4 — Upgrade never resurrects agentic files (Priority: P1)

**Goal**: `specflow upgrade` on a parent-managed target updates `.specflow/` only; never recreates
`.claude/`; lock keeps zero agentic entries.

**Independent test**: parent-managed fixture with no `.claude/` → `upgrade` → assert 0 agentic
files, `.specflow/` refreshed, lock has `parent_managed: true` and no agentic entries.

- [x] T015 [US4] Write failing unit cases in `tests/application/upgrade_project_test.ts`:
      `lock.parentManaged=true` ⇒ `fullBundle` filtered (no agentic dests in plan/`writer.written`);
      legacy lock (no field) ⇒ re-derive via fake reader then filter + persist field.
- [x] T016 [US4] In `UpgradeProjectUseCase.execute()` apply the agentic filter to `fullBundle`
      (before `destPaths`/`bundle` split) when the target is parent-managed; ensure suppressed paths
      are never planned, written, or restored — until T015 passes.
- [x] T017 [US4] In `cli/handlers/upgrade_handler.ts` `runUpgrade`: take `lock.parentManaged` when
      present; else re-derive via the reader and persist into the rewritten lock — until the
      migration case in T015 passes.
- [x] T018 [US4] Write failing integration tests `tests/integration/upgrade_parent_managed_test.ts`:
      `no agentic resurrection` (C3 — upgrade on parent-managed target leaves
      `.claude/skills|agents` absent, `.specflow/` updated) and `lock has no agentic entries` (C5 —
      `installed.lock` excludes agentic keys and carries `parent_managed: true`).

**Checkpoint**: routine upgrades can no longer reintroduce the drift. SC-003, SC-005 green.

---

## Phase 6: US3 — Explicit standalone override (Priority: P2)

**Goal**: `target/.specflow/standalone.yml` forces full provisioning under a providing workspace.

**Independent test**: parent-managed fixture + `standalone.yml` → `init` → skills/agents written.

- [x] T019 [US3] Add integration case `override forces full` (C4) to
      `tests/integration/init_parent_managed_test.ts`: providing-workspace member with
      `target/.specflow/standalone.yml` present ⇒ `init` writes skills/agents fully, no suppression,
      no notice.
- [x] T020 [US3] Confirm the override short-circuit is honoured end-to-end (handler passes
      `hasStandaloneOverride` into the decision; `isParentManaged` returns false when override true)
      — adjust only if T019 fails. SC-004 green.

---

## Phase 7: Polish & Cross-Cutting

- [x] T021 [P] Run `deno task fmt` and `deno task lint` across the new/edited files; fix any
      findings.
- [x] T022 [P] Run the full `deno task test` suite; confirm green and that SC-002 standalone parity
      holds (no unintended diff in the standalone file set).
- [x] T023 Update CLI docs if `init`/`upgrade` behaviour is user-documented (e.g. `docs/llms.md` or
      command help) with a one-line note on parent-managed detection + the `standalone.yml`
      override; skip if no such surface documents provisioning.
- [x] T024 Self-review against `contracts/parent-managed-detection.md` §6 — confirm every C1–C5 row
      maps to a passing test and every FR/SC is covered; note any deviation in the PR description.

---

## Dependencies & order

- **Setup (T001)** → **Foundational (T002–T008)** → stories.
- Foundational blocks everything: T003 (predicates), T006 (adapter), T008 (lock field) are
  prerequisites for all use-case/handler wiring.
- **US1 (T009–T012)** is the MVP and depends only on Foundational.
- **US2 (T013–T014)** depends on US1's handler wiring (shares `init_handler`).
- **US4 (T015–T018)** depends on Foundational (lock field, filter predicate, reader) — independent
  of US1/US2 source-wise but shares the filter helper.
- **US3 (T019–T020)** depends on US1 (override flows through the same init path).
- **Polish (T021–T024)** last.

## Parallel opportunities

- Within Foundational: T002, T004, T007 are `[P]` (different files) and can be drafted together;
  their implementations T003/T006/T008 follow each.
- Across stories after Foundational: US1 and US4 touch different use cases (`init_project` vs
  `upgrade_project`) and different test files — their _implementation_ can proceed in parallel; only
  the shared `init_handler` (US1/US2/US3) serialises.
- Polish T021/T022 are `[P]`.

## Implementation strategy

1. **MVP** = Phase 1 + 2 + US1 (T001–T012): closes the headline regression and is independently
   demoable (init in a member writes no agentic files).
2. Add **US2** (T013–T014) to guarantee standalone safety — required before shipping.
3. Add **US4** (T015–T018): protects the far-more-frequent upgrade path.
4. Add **US3** (T019–T020): the override escape hatch.
5. **Polish** (T021–T024): fmt/lint/test/docs/self-review.

**Total: 24 tasks** — Setup 1 · Foundational 7 · US1 4 · US2 2 · US4 4 · US3 2 · Polish 4.
