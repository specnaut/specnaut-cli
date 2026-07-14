# Tasks: CLI pluggable spec backend + init choice (local | cloud)

**Input**: Design documents from `.specnaut/specs/020-cli-spec-backend/` **Prerequisites**: plan.md,
spec.md, research.md, data-model.md, contracts/spec-client.md, quickstart.md **Tests**: INCLUDED —
SC-002 (local parity) needs a golden-file test; SC-003/004/005/006 are testable capabilities. Test
tasks accompany each story.

**Organization**: grouped by user story. US1 (init choice) + US2 (cloud specify) + US3 (pull) are
P1; US4 (push) is P2. Paths relative to `apps/specnaut-cli/`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Confirm `deno task test` harness + fake-fetch/fake-fs patterns (see `tests/unit/*gate*`,
      `tests/**`); no new deps.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T002 Add `SpecBackend = "local"|"cloud"`, `KNOWN_SPEC_BACKENDS`, the `specBackend` field +
      `spec_backend` YAML key to `src/domain/installed_lock.ts`; `parseLock` defaults to `"local"`
      when absent (mirror `versionScheme`). [FR-001/010]
- [x] T003 [P] Create `src/domain/spec/spec_step.ts` — `SpecStep{key,name,order,body}`.
- [x] T004 [P] Add `SpecStore` + `SpecCacheStore` ports and `BundleOptions.specBackend` to
      `src/application/ports.ts` (per data-model.md).
- [x] T005 [US-foundation] Test: `tests/unit/installed_lock_spec_backend_test.ts` — round-trip
      write/parse of `spec_backend`; absent → `"local"`. [FR-010]

**Checkpoint**: types + ports + lock field ready.

---

## Phase 3: User Story 1 — Choose the spec backend at init (Priority: P1) 🎯 MVP

**Goal**: `init` offers local (first-class default behaviour) | cloud (recommended default
selection), persists it, and local stays byte-identical (FR-001/003, SC-001/002).

### Tests for US1

- [x] T006 [P] [US1] `tests/unit/spec_picker_test.ts` — default (Enter) → `cloud`; numeric pick →
      chosen; invalid re-prompts. Mirror `backlog_picker` tests. [SC-001]
- [x] T007 [P] [US1] `tests/unit/spec_backend_filter_golden_test.ts` — the `local`-rendered
      `specify.md` is **byte-identical** to the pre-feature bundle output. [SC-002]

### Implementation for US1

- [x] T008 [US1] Create `src/cli/spec_picker.ts` (`DEFAULT_SPEC_BACKEND="cloud"`, recommended
      marker, `pickSpecBackend` + `pickSpecBackendInteractive`) — mirror `backlog_picker.ts`.
- [x] T009 [US1] Create `src/domain/spec_strategies/{local,cloud}.ts` + `registry.ts`
      (`SpecBackendStrategy`: displayName + init copy).
- [x] T010 [US1] Add `renderSpecBackend` to `src/domain/conditional_render.ts` and create
      `src/infrastructure/harness/spec_backend_filter.ts` (`applySpecBackend`); wire it into all 7
      harness `mapBundle`s (claude/cursor/codex/copilot/windsurf/opencode/antigravity).
- [x] T011 [US1] Resolve + thread `specBackend` (flag → interactive → default) in
      `src/cli/handlers/init_handler.ts`, `src/cli/parser.ts` (`--spec-backend`), and
      `src/application/init_project.ts` (`mapBundle` options). Update `src/cli/help.ts`.

**Checkpoint**: `init` records the backend; local path unchanged.

---

## Phase 4: User Story 2 — Cloud-mode `specify` pushes + no branch (Priority: P1)

**Goal**: cloud authoring pushes steps to the linked task, creates no branch, auto-creates+links a
task when none is linked (FR-004/011, SC-003).

### Tests for US2

- [x] T012 [P] [US2] `tests/unit/spec_client_test.ts` — POST/GET/PUT calls, status-only errors, no
      `_id`/backend-error leakage. Fake fetch. [SC-006]
- [x] T013 [P] [US2] `tests/integration/cloud_specify_test.ts` — cloud-mode authoring pushes steps,
      writes **zero** `.specnaut/specs/` files, creates **zero** branches, and auto-creates+links a
      task when none linked. [SC-003, FR-011]

### Implementation for US2

- [x] T014 [P] [US2] Create `src/domain/cloud/spec_contract.ts` (pure types + parse guards, mirror
      `gate_contract.ts`). [§ I]
- [x] T015 [US2] Create `src/domain/cloud/spec_client.ts` (`/api/v1/specs*`, mirror
      `gate_client.ts`) and `src/domain/cloud/spec_session.ts` (`SpecSession`/`makeSpecSession`,
      mirror `gate_session.ts`; reuse credential store + Cloud-link file).
- [x] T016 [US2] Add `createTask(accessToken, projectKey, title)` to
      `src/domain/cloud/cloud_client.ts` (mirror `createProject`; `POST /api/v1/tasks`).
- [x] T017 [US2] Edit `templates/core/skills/specnaut/phases/specify.md` + `implement.md` with
      `spec-backend=local|cloud` marker blocks (cloud specify: push, no branch, no files; cloud
      implement: `create-new-feature.sh --branch-only`); add `--branch-only` to
      `templates/core/specnaut/scripts/bash/create-new-feature.sh`.

**Checkpoint**: cloud specify authors to the cloud with no branch/files.

---

## Phase 5: User Story 3 — Materialise a cloud spec for reading (`spec pull`) (Priority: P1)

**Goal**: `spec pull <task>` writes gitignored cache files so agents read plain files (FR-005/008,
SC-004/005).

### Tests for US3

- [x] T018 [P] [US3] `tests/unit/spec_cache_writer_test.ts` — writes ordered files, clears stale on
      re-pull, path layout `.cache/<task>/<order>-<slug>.md`. [SC-004]
- [x] T019 [P] [US3] `tests/unit/spec_store_test.ts` — `CloudSpecStore.pull` (fake session),
      `LocalSpecStore` verbs fail with a clear cloud-only message. [FR-002]

### Implementation for US3

- [x] T020 [US3] Create `src/infrastructure/spec/{local_spec_store,cloud_spec_store}.ts` (implement
      `SpecStore`).
- [x] T021 [US3] Create `src/infrastructure/spec/spec_cache_writer.ts` (`SpecCacheStore`); add
      `.specnaut/specs/.cache/` to `templates/core/root/.gitignore`.
- [x] T022 [US3] Wire `spec pull <task>`: `parser.ts` (`spec` branch),
      `src/cli/handlers/spec_handler.ts::runSpec` (mirror `gate_handler.ts`; offline → reuse cache
      or actionable error, FR-008), `main.ts` `case "spec"`, `help.ts`. [SC-005]

**Checkpoint**: full author → pull → read loop works.

---

## Phase 6: User Story 4 — Push local spec content (`spec push`) (Priority: P2)

- [x] T023 [US4] Implement `spec push <task>` in the same `spec_handler.ts` (`CloudSpecStore.push`,
      upsert-only); print pushed step count. [FR-006]
- [x] T024 [P] [US4] `tests/integration/spec_push_pull_test.ts` — edit a cached tab → push → cloud
      reflects it; untouched tabs preserved.

---

## Phase 7: Polish & Cross-Cutting

- [x] T025 [P] `tests/integration/upgrade_spec_backend_test.ts` — pre-feature lock → `upgrade` →
      `spec_backend: local`, rendered `specify.md` unchanged. [FR-010]
- [x] T026 Run `deno task lint` + `deno task test` (+ `deno task bundle` if templates changed) — all
      green. Fix drift.

---

## Dependencies & order

- **Phase 2** blocks all. **US1** is the MVP (backend selectable + local parity). **US2/US3** depend
  on the foundation + the cloud client (T014-T016). **US4** depends on US3's store + handler.
  **Polish** last.

## Parallel opportunities

- T003/T004 after T002; T012/T014 (client/contract) parallel; all `[P]` test tasks parallel.

## Suggested MVP

**Phase 2 + US1** — the backend is selectable at init and local is provably unchanged. US2/US3
deliver the cloud value; US4 is a convenience.
