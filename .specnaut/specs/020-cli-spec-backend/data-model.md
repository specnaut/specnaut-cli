# Phase 1 Data Model — CLI pluggable spec backend

## Value objects

- **SpecBackend** = `"local" | "cloud"` — the persisted backend choice. Default `"cloud"` at
  init (recommended); absent in an existing lock → `"local"` (FR-010). Lives in
  `src/domain/installed_lock.ts` alongside `BacklogBackend`.
- **SpecStep** = `{ readonly key: string; name: string; order: number; body: string }` — the
  opaque unit exchanged with the cloud contract. `src/domain/spec/spec_step.ts`. This is the
  **only** shape that crosses the § I boundary.

## Persisted state — `InstalledLock`

`installed.lock` gains a `spec_backend` YAML key ↔ `specBackend: SpecBackend` field.
`parseLock` defaults it to `"local"` when absent (mirrors `versionScheme` default). No other
lock field changes.

## Ports (`src/application/ports.ts`)

- **SpecStore** — `{ readonly key: SpecBackend; pull(taskNumber): Promise<readonly SpecStep[] | null>; push(taskNumber, steps): Promise<void> }`.
  - `LocalSpecStore` (`key:"local"`): both verbs reject with one clear "cloud-only" message.
  - `CloudSpecStore` (`key:"cloud"`): delegates to a `SpecSession`.
- **SpecCacheStore** — `{ write(projectDir, taskNumber, steps): Promise<string[]>; clear(projectDir, taskNumber): Promise<void> }`. Adapter: `spec_cache_writer.ts`.
- **BundleOptions** gains `readonly specBackend: SpecBackend`, threaded through
  `harness.mapBundle(core, { backlogBackend, versionScheme, specBackend })`.

## Cloud wire types (`src/domain/cloud/spec_contract.ts`)

Pure types + parse guards mirroring `gate_contract.ts` (ignore unknown fields, no `_id`):

- `SpecWire = { taskNumber: number; title: string; steps: SpecStepWire[] }`
- `SpecStepWire = { key: string; name: string; order: number; body: string }`
- `SpecVersionWire = { versionKey: string; source: string; author: string; createdAt: string }`
- `SpecApiError` — carries only an HTTP status + a `reasonForStatus(status)` string; never the
  backend's `error` body (§ I).

## Materialisation cache layout

```
.specnaut/specs/.cache/<taskNumber>/<order>-<slug(key)>.md   # one file per step, gitignored
```
- `write` clears the task's cache dir first, then writes current steps (US3 AC2 reconciliation).
- `.specnaut/specs/.cache/` is added to `templates/core/root/.gitignore` (mergeBlock-reconciled).

## State transitions (the operations)

- **init**: resolve `specBackend` (flag → interactive picker → `cloud` default) → persist to lock.
- **cloud `specify`** (template-rendered): generate steps → `spec push` (auto-create+link a
  task if none linked, via `cloud_client.createTask`) → **no** branch, **no** local files.
- **`spec pull <task>`**: `CloudSpecStore.pull` → `SpecCacheStore.write` → gitignored files.
  Network/auth failure → reuse existing cache or actionable error (FR-008).
- **`spec push <task>`**: read local content → `CloudSpecStore.push` (upsert-only; never
  deletes an omitted step — Lot 1 FR-011).
- **cloud `implement`** (template-rendered): `create-new-feature.sh --branch-only` → the branch
  is created here, not at specify (decoupling).
- **local (any op)**: bypasses `SpecStore` entirely — identical to today (FR-003).

## Invariants

- **Local parity** — with `specBackend:"local"`, no code path changes; guarded by a
  golden-file test asserting the rendered `specify.md` is byte-identical to pre-feature output.
- **Cache disposable** — gitignored; cloud is the source of truth.
- **API-only boundary** — cloud adapter uses only `/api/v1/specs*` (+ the shipped
  `/api/v1/tasks` for auto-create); no private-half identifier crosses (§ I).
- **No branch in cloud `specify`** — the branch is created only at `implement`.
