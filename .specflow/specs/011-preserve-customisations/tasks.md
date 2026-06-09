# Tasks: Preserve per-project customisations across template refreshes

**Feature**: `011-preserve-customisations` | **Branch**: `011-preserve-customisations` | **Issue**:
mkrlabs/specflow#367 **Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) ·
[data-model.md](./data-model.md) ·
[contracts/preserve-and-diff.md](./contracts/preserve-and-diff.md) · [research.md](./research.md)

TDD throughout: each behavioural task pairs a failing Deno.test with the implementation that makes
it pass. All tests hermetic — injected `FsReader`/`FsWriter`/`LockStore`/`PreserveStore` fakes,
in-repo `CORE_BUNDLE`, temp dirs. No network, no real binary, no live `gh`.

---

## Phase 1: Setup

- [x] T001 Confirm `@std/yaml` is already imported in `deno.json`/import map (used by
      `installed_lock.ts`); no new dependency needed. Record the exact specifier to reuse in
      `preserve_config.ts`. — `@std/yaml` (`jsr:@std/yaml@^1.0.0`), `parse`/`stringify` named
      exports.

## Phase 2: Foundational (blocking prerequisites for all user stories)

- [x] T002 [P] Write failing unit tests for the preserve manifest in
      `tests/domain/preserve_config_test.ts`: round-trip parse↔serialize; `EMPTY_PRESERVE_CONFIG`
      for absent/empty/malformed input; normalisation (trim, de-dupe, strip leading `./`,
      backslash→slash). (C1)
- [x] T003 Implement the pure domain type in `src/domain/preserve_config.ts` — `PreserveConfig`,
      `parsePreserveConfig` (never throws), `serializePreserveConfig`, `EMPTY_PRESERVE_CONFIG` —
      making T002 pass. No I/O, no Deno globals.
- [x] T004 [P] Write failing unit tests for the store in
      `tests/infrastructure/fs_preserve_store_test.ts`: read absent file ⇒ `EMPTY_PRESERVE_CONFIG`;
      write then read round-trips; malformed file degrades to empty. (C2)
- [x] T005 Add the `PreserveStore` port to `src/application/ports.ts` and implement
      `src/infrastructure/fs_preserve_store.ts` (reads/writes `.specflow/preserve.yml`, mirrors
      `FsLockStore`'s `Deno.errors.NotFound` handling), making T004 pass.

## Phase 3: User Story 1 — declare a file so a forced refresh never clobbers it (P1) 🎯 MVP

**Goal**: `init --force` and `upgrade` both preserve a declared file, with a per-file notice.
**Independent test**: fixture with a customised declared file → `init --force` leaves it
byte-identical and emits a notice; a non-declared file is still refreshed.

- [x] T006 [P] [US1] Extend `tests/domain/upgrade_plan_test.ts`: a declared path yields
      `preserve / reason:"declared"` even when disk SHA == bundle SHA; the declared check precedes
      the plugin-migration and unchanged/auto-update branches; a non-declared path is unaffected.
      (C3)
- [x] T007 [US1] Edit `src/domain/upgrade_plan.ts`: add `"declared"` to `preserve.reason`; add
      `isDeclaredPreserved?: (dest) => boolean` to `UpgradePlanOptions`; insert the declared check
      as the FIRST branch in `computeUpgradePlan`. Make T006 pass.
- [x] T008 [P] [US1] Extend `tests/application/init_project_test.ts`: with `preservedPaths` set,
      those dests are absent from the writer's written set and present in `InitResult.preserved`;
      with the set absent/empty, the written set and result equal today's behaviour. (C4)
- [x] T009 [US1] Edit `src/application/init_project.ts`: add `InitProjectInput.preservedPaths` and
      `InitResult.preserved`; build `bundleToWrite` = `bundle` minus `preservedPaths` before
      `writer.writeBundle`; report the removed set. Make T008 pass.
- [x] T010 [US1] Wire both handlers: in `src/cli/handlers/init_handler.ts` and
      `src/cli/handlers/upgrade_handler.ts`, load the `PreserveStore`, build the preserved set /
      `isDeclaredPreserved` predicate, and pass it into the use case / `UpgradePlanOptions`. Emit
      one notice line per preserved file (contract §3). (Init uses `FsPreserveStore`; upgrade passes
      the predicate.)
- [x] T011 [US1] Add the end-to-end integration test `tests/integration/init_preserve_test.ts`
      (declare path → `init --force` keeps it byte-identical + notice emitted; non-declared file
      refreshed). Uses the `product-owner.md` fixture to close the 2026-06-08 regression. (C6
      partial — SC-001, SC-002, SC-006)

**Checkpoint**: US1 is independently shippable — preserve works on both refresh paths with notices.

## Phase 4: User Story 2 — see how customised files diverge from the bundle (P2)

**Goal**: `specflow diff` shows per-file divergence, read-only. **Independent test**: fixture with
one customised file → `specflow diff` shows its diff, touches zero files, prints "no divergence" +
exit 0 when nothing differs.

- [x] T012 [P] [US2] Write failing unit tests in `tests/application/diff_project_test.ts`: `differs`
      (with both contents), `matches`, `missing` (tracked on disk, absent from bundle); empty
      project ⇒ empty results; assert no `FsWriter` is touched. (C5)
- [x] T013 [US2] Implement `src/application/diff_project.ts` — `DiffProjectUseCase` depending on
      `FsReader` + `LockStore` + `findHarness` only (NO `FsWriter`); maps `CORE_BUNDLE` for the
      installed templates version, reads each tracked file, returns `DivergenceResult[]` +
      `fromVersion`. Make T012 pass.
- [x] T014 [US2] Add the `diff` intent to `src/cli/parser.ts` (`{ kind: "diff"; onlyCustomised }`,
      parse `--only-customised`), implement `src/cli/handlers/diff_handler.ts` (`runDiff`: wire
      `DenoFsReader` + `FsLockStore` + `findHarness`, render each `differs` via the existing
      `renderUnifiedDiff` from `src/domain/diff.ts`, print "no divergence" + exit 0 when empty,
      non-zero only on error), add `case "diff"` to `src/cli/main.ts` dispatch, and one usage line
      to `src/cli/help.ts`. (C4-diff, SC-003)

**Checkpoint**: US2 is independently shippable — read-only divergence auditing works.

## Phase 5: User Story 3 — deliberately discard customisations for a clean refresh (P3)

**Goal**: `--reset-preserved` overrides declarations for one run; never default. **Independent
test**: preserved file + `init --force --reset-preserved` ⇒ overwritten; same without the flag ⇒
preserved.

- [x] T015 [US3] Add `--reset-preserved` (boolean) to `src/cli/parser.ts` for both `init` and
      `upgrade` intents.
- [x] T016 [US3] In both handlers: when `--reset-preserved` is set, `init_handler` passes an empty
      preserved set and `upgrade_handler` passes `isDeclaredPreserved: () => false`; emit a per-file
      override warning (contract §3, FR-005). Extend `tests/integration/init_preserve_test.ts` with
      the reset-overwrites and no-flag-preserves cases. (C6 — SC-005)

**Checkpoint**: US3 shippable — the deliberate escape hatch works and is never the default.

## Phase 6: Polish & cross-cutting concerns

- [x] T017 [P] Edge case FR-008: declared path not in the bundle ⇒ handler emits one `warn:` line
      and filters it out (no fatal, no silent honour). Cover in
      `tests/application/init_project_test.ts` (or a handler-level test). (C7)
- [x] T018 [P] Edge case FR-009: a declared/tracked path absent from the new bundle ⇒ kept on disk;
      `diff` renders it as `missing`. Cover in `tests/application/diff_project_test.ts`.
- [x] T019 [P] Edge case D8: a declared agentic path in a parent-managed sub-repo is a no-op
      (agentic paths filtered before the preserve check). Add an assertion in the upgrade-plan or
      init test. (C7)
- [x] T020 Run `deno task test` (full suite green, incl. unchanged init/upgrade suites — SC-004),
      `deno fmt --check`, `deno lint`, and a typecheck. Fix any fallout.
- [x] T021 Update `CHANGELOG.md` (Unreleased) with the preserve manifest, `specflow diff`, and
      `--reset-preserved`; add a short `docs/` note on `.specflow/preserve.yml` if a managed-files
      doc exists.

---

## Dependencies & order

- **Setup (T001)** → **Foundational (T002–T005)** block everything.
- **US1 (T006–T011)** depends on Foundational; it is the MVP.
- **US2 (T012–T014)** depends only on Foundational (the lock + bundle read) — independent of US1.
- **US3 (T015–T016)** depends on US1's handler wiring (the predicate/set seam).
- **Polish (T017–T021)** last; T020 gates the merge.

## Parallel opportunities

- T002 ‖ T004 (different test files, pure).
- Within US1: T006 ‖ T008 (different test files). T007 must precede the upgrade-handler half of
  T010; T009 must precede the init-handler half of T010.
- US2 (T012–T014) can proceed in parallel with US1 once Foundational lands (separate files:
  `diff_project.ts`, `diff_handler.ts`).
- Polish T017 ‖ T018 ‖ T019 (different edge cases / files).

## MVP scope

**User Story 1 alone** (T001–T011) is a shippable MVP: it closes the headline regression — a
declared file survives `init --force` with a visible notice. US2 (divergence view) and US3 (reset)
are independent increments layered on the same foundation.
