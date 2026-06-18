# Data Model — Reliable Adoption guide in CI-generated release notes

This feature is build/release tooling; the "data model" is the set of value types inside
`scripts/gen-changelog.ts` and the one workflow-step contract. No persistence, no schema.

## Value objects

### `PrBodyOutcome` (NEW, exported)

Replaces the `string` return of `fetchPrBody` (and the `""` sentinel).

```ts
export type PrBodyOutcome =
  | { kind: "retrieved"; body: string } // PR body fetched successfully
  | { kind: "absent" } // PR has no body / no Agent adoption block
  | { kind: "failed"; reason: string }; // retrieval failed (auth, rate-limit, network, gh missing)
```

- **retrieved** — `gh pr view` succeeded and returned a non-empty body. The body still passes
  through `extractAdoption`; a `retrieved` body whose adoption section is missing/incomplete
  resolves to a legitimate skip (no entry) — that is an _adoption-content_ absence, distinct from a
  _retrieval_ failure.
- **absent** — `gh` returned `null`/empty stdout (PR exists, no body). Normalised here so `"null"`
  text never reaches `extractAdoption`.
- **failed** — the process could not be run or returned non-zero. Carries a human-readable `reason`
  for the strict-mode report.

**Invariant**: a `failed` outcome MUST NOT be coerced into `absent`. This is the core correctness
rule (FR-004).

### `PrBodyFetcher` (NEW, exported type alias — the injection seam)

```ts
export type PrBodyFetcher = (prNum: number) => Promise<PrBodyOutcome>;
```

- Real implementation: the `gh pr view`-backed `fetchPrBody`, cached per process.
- Test implementation: a fake backed by a `Map<number, PrBodyOutcome>`.

### `AdoptionAssembly` (NEW — return of the extracted seam)

```ts
export type AdoptionAssembly = {
  entries: AdoptionEntry[]; // successfully assembled guide entries
  failures: { prNum: number; reason: string }[]; // retrieval failures (drives strict mode)
};
```

`assembleAdoptionEntries(classified: Classified[], fetch: PrBodyFetcher, opts?): Promise<AdoptionAssembly>`
walks the `feat` commits, resolves each PR number, fetches its body via the injected `fetch`, and:

- `retrieved` → run `extractAdoption`; push an `AdoptionEntry` if a valid block, else log an
  informational skip (no entry, not a failure).
- `absent` → informational skip (no entry, not a failure).
- `failed` → record in `failures` (and skip the entry).

### `AdoptionEntry` (UNCHANGED)

```ts
export type AdoptionEntry = { prNum: number; title: string; body: string };
```

Already exported; rendered by `formatChangelog` into the `### Adoption guide` section. No change.

## Behavioural states

```
feat commit ──► extractPrNumber ──► null ─────────────► (no entry; consistent local & CI; not a failure)
                      │
                      └─► prNum ──► fetch(prNum) ──► retrieved ──► extractAdoption ──► valid  ──► AdoptionEntry
                                                          │                              └─► invalid/absent ─► skip (info)
                                                          ├─► absent ───────────────────────────────────────► skip (info)
                                                          └─► failed ───────────────────────────────────────► failures[]  ──► (strict: exit 1)
```

## Strict-mode rule

```
assembly.failures.length > 0 && opts.strict  ⇒  print failures, Deno.exit(1) BEFORE writing release-notes.md
```

Non-strict (local preview): `failures` are reported as warnings; the body is still written
(best-effort draft). Output _content_ is identical in both modes for the same successfully-retrieved
inputs — strict only changes whether a _failure_ aborts (FR-002 parity preserved).

## Workflow-step contract (release.yml)

The `Generate release notes` step gains:

```yaml
env:
  GH_TOKEN: ${{ github.token }}
run: deno run --allow-read --allow-write --allow-run --allow-env scripts/gen-changelog.ts --strict
```

- `GH_TOKEN` makes `gh pr view` authenticated in CI (root-cause fix).
- `--strict` turns a retrieval failure into a failed `build` job, before the `Create release` step
  publishes — guaranteeing no incomplete body ships.
- The stale "adoption fix" comment above the step is updated to state the fix is complete
  (permission + token env).
