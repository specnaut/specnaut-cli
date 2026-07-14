# Phase 0 Research — CLI pluggable spec backend

From the architect design pass (47 reads over the live CLI). Every decision cites the
existing sibling it mirrors, so the implementation follows established patterns, not priors.

## D1 — SpecStore port scoped to cloud push/pull; local bypasses it

**Decision**: The `SpecStore` port has just `pull(taskNumber)` / `push(taskNumber, steps)`.
`CloudSpecStore` is the real implementation; `LocalSpecStore` returns a clear "local backend
has no cloud spec to sync" error for both. The local `specify` authoring flow does **not**
route through the port.

**Rationale**: Routing local authoring through the port would risk regressing FR-003's
byte-identical guarantee for a feature local users get zero benefit from. `spec push/pull`
are cloud-only verbs (per the spec's edge cases). Keeping the port narrow and symmetric.

**Alternatives rejected**: a fat port that also owns local file writing (regression risk, no
local upside).

## D2 — Init choice mirrors `BacklogBackend` end-to-end

**Decision**: Add `SpecBackend = "local" | "cloud"` + `KNOWN_SPEC_BACKENDS` + a `specBackend`
field / `spec_backend` YAML key to `installed_lock.ts` (absent → `"local"`, mirroring
`versionScheme`→`"semver"` at lines 87-93). New `spec_picker.ts` mirrors `backlog_picker.ts`
(`DEFAULT_SPEC_BACKEND = "cloud"`, recommended marker, interactive + numeric). New
`spec_strategies/{local,cloud}.ts` + `registry.ts`. `init_handler.ts` resolves it
(flag → interactive → default) and threads it via `BundleOptions.specBackend`.

**Rationale**: A proven, tested pattern; keeps the two backend choices symmetric and
predictable. Backward-compatible default satisfies FR-010.

## D3 — `spec_client` / `SpecSession` mirror `gate_*`

**Decision**: `src/domain/cloud/spec_client.ts` mirrors `gate_client.ts` (same `FetchFn`
injection, `{base}/api/v1` prefix, status-only `SpecApiError`/`reasonForStatus`).
`spec_session.ts` mirrors `gate_session.ts` (`SpecSession` wraps client + `TokenProvider` +
`projectKey`; `makeSpecSession(config, store)` returns null when unlinked). Auth reuses
`defaultCredentialStore()` — no new credential type (FR-007).

**Rationale**: `gate` is the exact analog (a versioned bearer-authed `/api/v1` surface). The
existing Cloud-link file (`backlog-config.yml`, written unconditionally by `cloud login`) is
reused regardless of `backlogBackend` — confirmed safe because gates already depend on it.

## D4 — `spec push` / `spec pull` commands mirror `gate`

**Decision**: `parser.ts` gains a `spec` branch (`{kind:"spec", sub:"push"|"pull", task}`);
`handlers/spec_handler.ts::runSpec` mirrors `gate_handler.ts` (deps built from
`readCloudConfig` + `defaultCredentialStore()`; exit codes 5/1/0 as `gate`); `main.ts`
`case "spec"`; `help.ts` entries.

**Rationale**: 1:1 with an existing, tested command family.

## D5 — Materialisation cache + gitignore

**Decision**: A narrow `SpecCacheStore` port + `spec_cache_writer.ts` adapter writing
`.specnaut/specs/.cache/<task>/<order>-<slug>.md`, clearing stale files first (US3 AC2). Add
one line `.specnaut/specs/.cache/` to `templates/core/root/.gitignore` — already
`mergeBlock:"gitignore"`-reconciled on every init/upgrade, so no new writer logic.

**Rationale**: Reuses the idempotent gitignore-merge; the cache is disposable and never the
source of truth.

## D6 — Branch decoupling + auto-create-task

**Decision**: Cloud-mode authoring is controlled by `<!-- BEGIN: spec-backend=cloud -->`
marker blocks in `specify.md` (no branch, no file writes → push instead) and `implement.md`
(runs `create-new-feature.sh --branch-only` — the actual decoupling point), rendered by a new
`renderSpecBackend` in `conditional_render.ts` + `spec_backend_filter.ts` wired into all 7
harnesses. `create-new-feature.sh` gains `--branch-only`. Auto-create-when-unlinked uses a new
typed `cloud_client.createTask(accessToken, projectKey, title)` (mirrors `createProject`),
**not** the bash `add.sh` (which is `backlogBackend`-gated and may be absent).

**Rationale**: Keeps auto-creation inside the same compiled, typed client the push path uses,
independent of the backlog backend; the template markers are the established conditional-render
mechanism.

## D7 — § I boundary

**Decision**: `spec_contract.ts` mirrors `gate_contract.ts` — pure types, `parseSpec`/
`parseSpecStep` guards that ignore unknown fields, errors keyed off HTTP status only
(`SpecApiError` never carries a backend `error` string). Only `SpecStep{key,name,order,body}`
crosses the wire — no CLI framework identifier.

**Rationale**: The frozen boundary rule, already applied to gates.

## D8 — Upgrade path

**Decision**: existing installs default `specBackend` to `"local"` on `parseLock`; `specnaut
upgrade` re-bundles `specify.md`/`implement.md` with the local marker block → zero behavioural
change. Guarded by an explicit upgrade-path integration test.

**Rationale**: Backward compatibility (FR-010) must be mechanically verified, not assumed.

## Open items carried to Kevin only if they become blocking (non-blocking defaults chosen)

- Reuse the existing Cloud-link file for specs even when `backlogBackend: github` → **yes**
  (matches how gates already work).
- `cloud_client.createTask` over `POST /api/v1/tasks` → **yes** (already a shipped public
  endpoint used by `add.sh`).
