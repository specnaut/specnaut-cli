# Quickstart — CLI spec backend, exercised locally

Runs against the working-tree CLI (`deno run --allow-all src/main.ts …`) using the
test-sandbox skill, no compiled binary needed.

## 1. Local backend — zero behaviour change

```bash
# init picking local (or --spec-backend local)
deno run --allow-all src/main.ts init --here --ai claude --spec-backend local
# installed.lock records spec_backend: local
# `specify` writes .specnaut/specs/<n>/ files + creates a branch — exactly as today. [SC-002]
```

## 2. Cloud backend — init + authoring

```bash
deno run --allow-all src/main.ts init --here --ai claude --spec-backend cloud
# installed.lock records spec_backend: cloud
deno run --allow-all src/main.ts cloud login            # existing flow — reused, not new
# Cloud-mode specify (agent-run): generates steps → spec push; NO branch, NO local spec files. [SC-003]
```

## 3. Pull a cloud spec into the gitignored cache

```bash
deno run --allow-all src/main.ts spec pull 154
# writes .specnaut/specs/.cache/154/<order>-<slug>.md per step
git check-ignore .specnaut/specs/.cache/154   # → path is ignored [SC-004]
git status --porcelain | grep -c '.cache/'     # → 0 (never tracked) [SC-004]
```

## 4. Edit + push back

```bash
$EDITOR .specnaut/specs/.cache/154/1-specify.md
deno run --allow-all src/main.ts spec push 154   # upsert; untouched tabs preserved (Lot 1 FR-011)
```

## 5. Offline / auth-failure behaviour

```bash
# with no network / expired token:
deno run --allow-all src/main.ts spec pull 154
# → reuses an existing cache if present, else exits non-zero with an actionable message.
#   Never a partial or silently-empty spec. [SC-005]
```

## 6. Boundary check

```bash
# grep the cloud adapter surface for any private-half identifier → none; only /api/v1/specs*
# and SpecStep{key,name,order,body} cross the wire. [SC-006, § I]
```

## 7. Upgrade path

```bash
# a pre-feature project (lock without spec_backend):
deno run --allow-all src/main.ts upgrade --here
# → spec_backend defaults to local; rendered specify.md is byte-identical to before. [FR-010]
```

## Automated coverage

`deno task test` — `spec_store_test.ts`, `spec_client_test.ts` (fake fetch),
`spec_cache_writer_test.ts`, `installed_lock` round-trip, a golden-file local-parity test on
rendered `specify.md`, and integration tests for cloud specify (no files/branches, task
auto-created) + the upgrade path.
