# Research — Reliable Adoption guide in CI-generated release notes

Phase 0 decisions for issue #363. Each resolves an unknown surfaced by the spec and confirms it
against the real code (`scripts/gen-changelog.ts`, `.github/workflows/release.yml`,
`.claude/skills/release/SKILL.md`).

## D1 — Root cause: missing token in the step environment

**Decision**: The defect is that the `Generate release notes` step in `release.yml` (`build` job)
exposes no `GH_TOKEN`/`GITHUB_TOKEN` to its environment. `scripts/gen-changelog.ts` shells
`gh pr view <num> --json body`; in CI `gh` finds no auth and fails for every PR, so each adoption
fetch returns `""` and is silently skipped.

**Rationale**: The same job already declares `pull-requests: read` and `fetch-depth: 0`, so neither
permission scope nor checkout depth is the cause. The sibling `security-preflight` step calls
`gh api` successfully precisely because it sets `GH_TOKEN: ${{ github.token }}`; the release-notes
step omits it. Granting a token _scope_ via `permissions:` does not place the token in the step env
— that requires an explicit `env: GH_TOKEN: ${{ github.token }}` (or `GITHUB_TOKEN`). Locally the
engineer's `gh auth login` state supplies auth, which is why the preview path works and the bug is
environment-specific.

**Alternatives considered**: (a) shallow-checkout / `git describe` failure — rejected,
`fetch-depth: 0` is already set and `--from` is derived from tags present in full history; (b) deno
permission flags differing between local and CI — rejected, both invocations use identical flags
(`--allow-read
--allow-write --allow-run`); (c) the workflow invoking different code than the
preview — rejected, both call `scripts/gen-changelog.ts`.

## D2 — `--allow-env` and subprocess env passthrough

**Decision**: Add `--allow-env` to the CI invocation for explicitness, but rely on `Deno.Command`'s
default parent-env inheritance to pass `GH_TOKEN` to the `gh` subprocess.

**Rationale**: `Deno.Command` inherits the parent process environment by default when no `env`
option is supplied; `--allow-env` governs `Deno.env` access _within_ the Deno process, not
subprocess env inheritance. So the token reaches `gh` via inheritance once it is set on the step.
`--allow-env` is added defensively (and to keep the door open for the script reading `GH_TOKEN`
directly if ever needed) without changing behaviour.

**Alternatives considered**: passing `env: { GH_TOKEN }` explicitly into the `Deno.Command` —
unnecessary given inheritance, and would couple the script to the variable name.

## D3 — Outcome type replaces the empty-string sentinel

**Decision**: `fetchPrBody` returns a discriminated union
`PrBodyOutcome = { kind: "retrieved"; body } | { kind: "absent" } | { kind: "failed"; reason }`. The
per-process cache stores `PrBodyOutcome` values (failures cached too). Normalise `gh`'s `null`/empty
stdout to `absent`.

**Rationale**: The `""`-means-everything sentinel is the actual bug — it fuses "no adoption block"
with "couldn't fetch." A three-way outcome lets the caller (and the strict guard) treat
retrieval-failure as a defect while keeping legitimate-absence a quiet skip (FR-004, FR-007).
Caching failures avoids hammering a rate-limited API within one run; the cache resets per process,
so a workflow re-run retries cleanly.

**Alternatives considered**: throwing on failure — rejected, it would abort the whole run on the
first failure and lose the ability to report _all_ missing entries at once (worse operator
ergonomics for the strict guard's message).

## D4 — Injectable fetcher seam

**Decision**: Extract `assembleAdoptionEntries(classified, fetcher, opts)` from `main()`, where
`fetcher: PrBodyFetcher = (prNum) => Promise<PrBodyOutcome>`. `main()` passes the real `gh`-backed
fetcher; tests pass a fake map.

**Rationale**: Today the adoption-assembly loop lives inline in `main()` and is untestable without
shelling to `gh`. A function-parameter port (no new file) makes SC-001/002/004/005/006 unit-testable
with a deterministic fake, matching the existing "pure helpers are exported for tests" convention in
the file.

**Alternatives considered**: a class-based port or a separate module — overkill for one function;
the file already favours exported free functions.

## D5 — Guard placement: CI-only `--strict` in gen-changelog

**Decision**: Add a `--strict` flag to `gen-changelog.ts`. After assembly, if `strict` and any
outcome was `failed`, print the failing PR numbers/reasons and `Deno.exit(1)` **before** writing
`dist/release-notes.md`. The CI step adds `--strict`; the exit fails the `build` job before
`softprops/action-gh-release` runs, so no incomplete body is ever published.

**Rationale**: Co-locating the guard with the generator reuses the exact same range +
classification + fetch logic, so the guard checks precisely what would ship (no drift between a
separate checker's range logic and the generator's). One file, one source of truth. Satisfies
FR-005/FR-006 and SC-003/SC-005.

**Alternatives considered**: (B) a standalone `verify-adoption-parity.ts` step — rejected: it would
duplicate the range/PR-number/extraction logic and could drift from the generator; more workflow
surface for no extra safety. (C) a post-publish check — rejected: the body is already public by
then.

## D6 — Local preview stays non-strict

**Decision**: Do **not** add `--strict` to the `release/SKILL.md` preview invocation (line ~65).
Only CI runs strict.

**Rationale**: Engineers preview from machines that may lack `gh` auth for the repo or be offline;
they still want to see the draft. Strict mode is a release-gate concern, not a drafting concern. The
single shared code path is preserved — only the flag differs, exactly like a `--ci` toggle.

**Alternatives considered**: strict everywhere — rejected, would block local drafting on
transient/auth issues that don't matter until publish.

## D7 — Regression fixture without live network

**Decision**: For SC-004, build a fixture map of the v1.13.0 range's feat PR bodies (the
`## Agent adoption` sections), inline minimal strings, and feed them through the fake fetcher;
assert the produced guide has the expected entry count. No live `gh`/network in tests.

**Rationale**: Tests must be hermetic and fast. The fixture proves "this range yields N adoption
entries" deterministically; combined with the strict-mode test it demonstrates the bug (fail) → fix
(pass) transition the issue requires.

**Alternatives considered**: a live integration test hitting `gh` — rejected, non-hermetic, flaky,
rate-limit-prone, and CI-auth-dependent (the very thing under test).

## Open risks

- **Partial rate-limit mid-run** — some PRs `retrieved`, a later one `failed`. Handled: strict mode
  fails on _any_ `failed`, and failures are collected so the message lists all of them.
- **Squash subject without `(#NNN)`** — `extractPrNumber` returns null; such a feat commit
  contributes no adoption entry in either environment (consistent), and is NOT counted as a `failed`
  retrieval (nothing to fetch). Documented as defined behaviour, not a guard trigger.
- **No feat PRs in range** — empty guide is legitimate; strict mode has zero `failed` outcomes and
  passes (SC-006 sibling case).
- **Stale half-applied comment** — `release.yml` lines ~144-151 claim the adoption fix was made via
  `pull-requests: read`, but the env half was never applied. Update the comment when adding the env
  so it describes the completed fix.
