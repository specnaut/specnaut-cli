# Implementation Plan: CLI pluggable spec backend + init choice (local | cloud)

**Branch**: `020-cli-spec-backend` | **Date**: 2026-07-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `.specnaut/specs/020-cli-spec-backend/spec.md` **Issue**:
specnaut-cli#424 (Lot 2 of epic specnaut-monorepo#15) · depends on Lot 1 (cloud#154, shipped)

## Summary

Add a second spec-storage backend to the Specnaut CLI, chosen at `specnaut init` exactly like the
backlog backend: `local` (current `.specnaut/specs/` markdown, first-class default) or `cloud`
(recommended). A `SpecStore` port with `local` + `cloud` adapters; a `spec_client`

- `SpecSession` mirroring the existing `gate_client`/`gate_session` against the shipped
  `/api/v1/specs*` contract; `spec push` / `spec pull` commands mirroring `gate`; a gitignored
  materialisation cache under `.specnaut/specs/.cache/<task>/`; and cloud-mode `specify` that pushes
  steps + creates no branch (branch decoupled to `implement`, auto-creating+linking a task when none
  is linked). The local path bypasses the port entirely, preserving byte-for-byte parity (FR-003).
  Grounded in the architect's design pass (see research.md).

## Technical Context

**Language/Version**: TypeScript (strict) on Deno **Primary Dependencies**: existing
`gate_client`/`gate_session`/`cloud_client`, credential store, `backlog_strategies` registry +
picker, `conditional_render` + per-harness filters **Storage**: filesystem (local specs + gitignored
cache) + SpecNaut Cloud via `/api/v1/specs*` **Testing**: `deno task test` — unit (fake fetch/fs) +
integration + golden-file (local parity) **Target Platform**: compiled Deno binary (5 targets via
release.yml) **Project Type**: CLI (hexagonal: domain / application ports / infrastructure adapters
/ cli) **Performance Goals**: N/A — spec push/pull are low-frequency authoring ops **Constraints**:
local behaviour byte-identical (FR-003); § I — cloud adapter speaks only the versioned HTTP API, no
private-half identifier in the public CLI; cache is gitignored + disposable **Scale/Scope**: ~1
port + 2 adapters, 1 client + session, 1 command pair, 1 cache writer, installed.lock + picker +
7-harness filter fan-out, template marker edits, ~10 test files

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

The CLI half has no local `constitution.md` (no `.specnaut/memory/`). The governing invariant is
monorepo **constitution § I** (OSS/proprietary boundary): no private-half code, name, identifier,
type, or error string may enter the public CLI — the only bridge is the versioned HTTP API. This
design satisfies it by construction: `spec_client`/`spec_contract` mirror `gate_contract.ts` (pure
types, status-only errors, opaque `SpecStep{key,name,order,body}`). **PASS** (re-checked post-Phase
1: still PASS).

## Project Structure

### Documentation (this feature)

```text
.specnaut/specs/020-cli-spec-backend/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/spec-client.md
└── tasks.md
```

### Source Code (repository root = `apps/specnaut-cli/`)

```text
src/domain/
├── installed_lock.ts                 # MODIFIED — SpecBackend type, spec_backend key, default-on-absent
├── spec/spec_step.ts                 # NEW — SpecStep value object
├── spec_strategies/{local,cloud}.ts + registry.ts   # NEW — SpecBackendStrategy (displayName/init copy)
├── conditional_render.ts             # MODIFIED — renderSpecBackend (sibling of renderBackend)
└── cloud/
    ├── spec_contract.ts              # NEW — pure wire types + parse guards (mirror gate_contract.ts)
    ├── spec_client.ts                # NEW — /api/v1/specs* client (mirror gate_client.ts)
    ├── spec_session.ts               # NEW — SpecSession + makeSpecSession (mirror gate_session.ts)
    └── cloud_client.ts               # MODIFIED — createTask() for auto-create-when-unlinked

src/application/
├── ports.ts                          # MODIFIED — SpecStore + SpecCacheStore ports; BundleOptions.specBackend
└── init_project.ts                   # MODIFIED — thread specBackend into mapBundle

src/infrastructure/
├── spec/local_spec_store.ts          # NEW — LocalSpecStore (cloud verbs fail with one clear message)
├── spec/cloud_spec_store.ts          # NEW — CloudSpecStore (over SpecSession)
├── spec/spec_cache_writer.ts         # NEW — gitignored .specnaut/specs/.cache/<task>/ materialisation
└── harness/spec_backend_filter.ts    # NEW — applySpecBackend, wired into all 7 harness mapBundles

src/cli/
├── spec_picker.ts                    # NEW — pickSpecBackend[Interactive] (mirror backlog_picker.ts)
├── parser.ts                         # MODIFIED — `spec push|pull` branch (mirror `gate`)
├── handlers/spec_handler.ts          # NEW — runSpec (mirror gate_handler.ts)
├── handlers/init_handler.ts          # MODIFIED — resolve + thread specBackend
└── help.ts                           # MODIFIED — spec push/pull entries
main.ts                               # MODIFIED — case "spec"

templates/core/
├── root/.gitignore                   # MODIFIED — add `.specnaut/specs/.cache/`
├── skills/specnaut/phases/specify.md # MODIFIED — spec-backend marker blocks (cloud: push, no branch)
├── skills/specnaut/phases/implement.md # MODIFIED — cloud block runs create-new-feature.sh --branch-only
└── specnaut/scripts/bash/create-new-feature.sh # MODIFIED — --branch-only flag
```

**Structure Decision**: no new layer — every piece mirrors an existing sibling (`gate_*`,
`backlog_*`, per-harness filters). The one cross-cutting cost is the 7-harness `applySpecBackend`
fan-out, identical in shape to the existing backlog/scheme filters.

## Phase 0 — Research (done → research.md)

Architect design pass (47 tool reads over the live code). Decisions D1–D8 in
[research.md](./research.md). Headlines: SpecStore port scoped to cloud push/pull (local bypasses
it, D1); init choice mirrors BacklogBackend end-to-end (D2); `spec_client`/`session` mirror `gate_*`
(D3); branch decoupling via template marker blocks + `create-new-feature.sh
--branch-only` at
implement (D5); auto-create-task via a new typed `cloud_client.createTask` (not the backend-gated
bash `add.sh`) (D6); § I preserved by mirroring `gate_contract` (D7); upgrade path defaults
`specBackend` to `local` (D8).

## Phase 1 — Design & Contracts (done)

- [data-model.md](./data-model.md) — SpecBackend, SpecStep, SpecStore/SpecCacheStore ports, the
  installed.lock field, the cache layout, state transitions.
- [contracts/spec-client.md](./contracts/spec-client.md) — the `/api/v1/specs*` calls the CLI
  makes + the `spec push`/`spec pull` command contract (exit codes mirroring `gate`).
- [quickstart.md](./quickstart.md) — end-to-end local exercise (init both backends, cloud specify,
  pull, push) with assertions.
- Agent context file: none marked in this repo → step skipped.

**Constitution re-check post-design**: still PASS — the cloud surface is opaque-keyed and
status-only; local parity is guarded by a golden-file test.

## Complexity Tracking

No constitution violations — table not needed. The 7-harness fan-out is existing-pattern maintenance
cost, not a new architectural violation.
