# Contract — Adoption-guide parity for release notes

CLI-internal contract (no wire/HTTP surface). Binds the spec's FR/SC to concrete seams in
`scripts/gen-changelog.ts` and the `release.yml` `build` job.

## 1. Fetcher contract — `PrBodyFetcher`

```ts
type PrBodyFetcher = (prNum: number) => Promise<PrBodyOutcome>;
type PrBodyOutcome =
  | { kind: "retrieved"; body: string }
  | { kind: "absent" }
  | { kind: "failed"; reason: string };
```

**Real `fetchPrBody` contract**

- Runs `gh pr view <prNum> --json body --jq .body`, cached per process (cache stores
  `PrBodyOutcome`, including `failed`).
- Non-zero exit / spawn error ⇒ `{ kind: "failed", reason }`.
- Success with empty or literal-`null` stdout ⇒ `{ kind: "absent" }`.
- Success with a non-empty body ⇒ `{ kind: "retrieved", body }`.
- MUST NOT return `failed` as `absent` or vice-versa (FR-004).

## 2. Assembly contract — `assembleAdoptionEntries`

```ts
assembleAdoptionEntries(
  classified: Classified[],
  fetch: PrBodyFetcher,
): Promise<AdoptionAssembly>   // { entries, failures }
```

> Note: the function is **pure of process exit** — it takes no `strict` option. The strict decision
> (`failures.length > 0 && strict`) lives entirely in `main()` per §3, so `strict` never reaches
> assembly. This keeps body content mode-independent (FR-002).

- Considers only `category === "feat"` commits.
- `extractPrNumber(subject) === null` ⇒ no entry, no failure (consistent both environments).
- `retrieved` ⇒ `extractAdoption`; valid block ⇒ push `AdoptionEntry`, else informational skip.
- `absent` ⇒ informational skip.
- `failed` ⇒ append `{ prNum, reason }` to `failures`.
- Pure of process exit — never calls `Deno.exit`; the caller decides.

## 3. Strict-mode contract (`main`)

- `--strict` flag parsed from `Deno.args`.
- After assembly: if `strict && failures.length > 0`, print each failure (`#<prNum>: <reason>`) to
  stderr and `Deno.exit(1)` **before** `Deno.writeTextFile(out, …)`.
- Non-strict: failures are `console.warn`-ed; the body is still written.
- The `formatChangelog` output (the body content) is byte-identical between strict and non-strict
  for the same set of `retrieved` inputs (FR-002).

## 4. Workflow contract (`release.yml` → `build` → Generate release notes)

```yaml
- name: Generate release notes
  env:
    GH_TOKEN: ${{ github.token }}
  run: deno run --allow-read --allow-write --allow-run --allow-env scripts/gen-changelog.ts --strict
```

- Token exposure makes `gh pr view` authenticated in CI (FR-003).
- `--strict` fails the `build` job on any retrieval failure, before the `Create release` step
  (`softprops/action-gh-release@v3`) consumes `dist/release-notes.md` (FR-005).
- The `release/SKILL.md` preview invocation is **unchanged** (no `--strict`, no token needed) —
  local drafting stays best-effort.

## 5. Acceptance mapping (C1–C5 ⇄ tests ⇄ SC/FR)

| Contract                                                       | Test                                                                         | Asserts                                                                        | Spec                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| **C1** in-range feat PRs with valid blocks all produce entries | `assembleAdoptionEntries` over a fake fetcher returning N `retrieved` bodies | `entries.length === N`, no `failures`                                          | SC-001, FR-001               |
| **C2** local/CI byte-parity for same inputs                    | `formatChangelog` over the assembled entries vs. a golden string             | adoption section byte-identical; strict vs non-strict identical body           | SC-002, FR-002               |
| **C3** retrieval failure halts under strict                    | assembly with a fake returning ≥1 `failed`; `main`/exit path                 | `failures` non-empty; strict ⇒ non-zero exit, no file written                  | SC-003/SC-005, FR-005/FR-006 |
| **C4** v1.13.0 regression fixture                              | fixture map of the v1.13.0 feat PR bodies through the fake fetcher           | produced guide has the expected entry count (absent pre-fix, present post-fix) | SC-004, FR-008               |
| **C5** legitimate absence is quiet, not a failure              | fake returning `absent` (and a `retrieved`-but-no-block)                     | no `failures`, no entry, run succeeds even under strict                        | SC-006, FR-004/FR-007        |

Unit coverage backing the above lives in `tests/scripts/gen_changelog_test.ts` (extending the
existing `classifyCommit`/`formatChangelog` suite):

- `fetchPrBody` outcome normalisation (`failed` vs `absent` vs `retrieved`) — exercised via the
  assembly seam with a fake fetcher (no live `gh`).
- `assembleAdoptionEntries` branch matrix (null PR number, retrieved-valid, retrieved-no-block,
  absent, failed).
- strict-mode exit (subprocess-run the script with a forced failure, or assert on the decision
  predicate `failures.length > 0 && strict`).
- v1.13.0 fixture count.
