# Tasks: Phase-entry spec pull, auto-generation & parallel orchestration

**Input**: Design documents from `.specnaut/specs/021-cli-phase-wiring/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/phase-wiring.md, quickstart.md
**Tests**: INCLUDED — golden local-parity (SC-002) + lock round-trip + cloud-render integration.

**Organization**: grouped by user story. US1 (pull-on-entry) + US2 (auto-gen) are P1; US3
(parallel guidance) is P2. Paths relative to `apps/specnaut-cli/`. Reuses Lot 2's shipped
`renderSpecBackend` / `spec_backend_filter` / marker-block mechanism.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [ ] T001 Confirm which phase docs `applySpecBackend`/`renderSpecBackend` currently process
      (Lot 2 wired specify+implement). Note whether the filter's entry set must widen to
      review/analyze/tasks.

---

## Phase 2: Foundational

- [ ] T002 Add `spec_autogen: boolean` to `src/domain/installed_lock.ts` (`spec_autogen` YAML
      key, `specAutogen` field, `parseLock` defaults to `false` when absent — mirror
      `spec_backend`). [FR-005]
- [ ] T003 [P] Test `tests/unit/installed_lock_spec_autogen_test.ts` — round-trip; absent → false. [FR-005]
- [ ] T004 If T001 found the filter narrowed: widen `spec_backend_filter.ts` /
      `renderSpecBackend` to process all consuming phase docs (review/analyze/tasks). Keep local
      render byte-identical.

**Checkpoint**: lock field + render coverage ready.

---

## Phase 3: User Story 1 — Pull-on-entry (Priority: P1) 🎯 MVP

### Tests
- [ ] T005 [P] [US1] Golden local-parity: `local`-rendered `review.md`/`analyze.md`/`tasks.md`
      byte-identical to pre-feature (EOL-agnostic, per Lot 2's lesson); extend the existing
      `spec_backend_filter_golden_test.ts` fixtures. [SC-002]
- [ ] T006 [P] [US1] Integration: `cloud`-rendered implement/review/analyze/tasks contain a
      single `spec pull <task>` step; `local` render does not. [SC-001]

### Implementation
- [ ] T007 [US1] Add `spec-backend=cloud` pull-on-entry marker blocks to
      `templates/core/skills/specnaut/phases/{implement,review,analyze,tasks}.md` per
      contract §A (implement: pull precedes the Lot 2 `--branch-only` step); wrap the existing
      content in the `spec-backend=local` block unchanged. Re-bundle. [FR-001/002/003/004]
- [ ] T008 [US1] Sync the plugin mirror (`plugin/skills/specnaut/phases/*`) as Lot 2 did.

**Checkpoint**: consuming phases pull once at entry in cloud mode; local unchanged.

---

## Phase 4: User Story 2 — Auto-generation at task creation (Priority: P1)

- [ ] T009 [US2] Add the auto-generation guidance (contract §B) to the task-creation skill/phase
      doc(s): when `spec_autogen && cloud`, after creating a task also run cloud `specify` for it
      (branch-free); a failure is reported and non-fatal. Gate on `spec_autogen`. [FR-005/006]
- [ ] T010 [P] [US2] Integration: with `spec_autogen: true` + cloud, the rendered guidance
      includes the auto-gen step; with it false/absent or local, it does not. [SC-003]

**Checkpoint**: opt-in auto-gen wired, default off, non-fatal.

---

## Phase 5: User Story 3 — Parallel authoring (Priority: P2)

- [ ] T011 [US3] Add the parallel-authoring guidance (contract §C) to the relevant skill/phase
      doc — cloud `specify` is branch-free ⇒ N specs concurrently, no collision. [FR-007]

---

## Phase 6: Polish & Cross-Cutting

- [ ] T012 [P] Integration: local mode end-to-end — no pull, no auto-gen, phase docs unchanged
      (the existing phase suite stays green). [SC-002]
- [ ] T013 Run `deno task lint` + `deno task test` + `deno task bundle` — all green (fmt:check
      included, per Lot 2's CI lesson). Update the release-audit smoke if it enumerates phase docs.

---

## Dependencies & order
- Phase 2 blocks all. US1 is the MVP (pull-on-entry). US2/US3 are guidance layered on top.

## Parallel opportunities
- T003/T005/T006 parallel; US2/US3 doc edits parallel once the render coverage (T004) lands.

## Suggested MVP
**Phase 2 + US1** — cloud phases pull the spec automatically at entry, local provably unchanged.
US2 (auto-gen) + US3 (parallel) complete the lot.
