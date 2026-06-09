# Implementation Plan: Reliable Adoption guide in CI-generated release notes

**Branch**: `010-release-adoption-parity` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `.specflow/specs/010-release-adoption-parity/spec.md` (issue
mkrlabs/specflow#363)

## Summary

The release pipeline silently publishes release bodies missing the `### Adoption guide` section.
Root cause (confirmed): `scripts/gen-changelog.ts` fetches each `feat` PR's body via `gh pr view`
and, on **any** failure, returns `""` — which the caller cannot distinguish from "this PR
legitimately has no adoption block," so it silently skips the entry. In CI the
`Generate release
notes` step in `release.yml` exposes **no `GH_TOKEN`** to the step environment, so
`gh pr view` is unauthenticated and every fetch fails → the whole guide disappears. Locally the
engineer's `gh auth` state masks the defect.

The fix has three parts: (1) expose the workflow token to the step so retrieval succeeds in CI (the
root-cause one-liner); (2) replace the `""`-on-failure contract with a discriminated `PrBodyOutcome`
so retrieval-failure is distinct from legitimate-absence, behind an injectable fetcher seam that
makes the adoption-assembly loop unit-testable; (3) add a CI-only `--strict` mode that exits
non-zero when any in-range feat PR's retrieval _fails_, so the build fails before
`softprops/action-gh-release` ever publishes an incomplete body. Together these restore parity
(US1), guard it durably (US2), and make the failure-vs-absence distinction trustworthy (US3).

## Technical Context

**Language/Version**: TypeScript on Deno v2.x **Primary Dependencies**: Deno std (`@std/assert` for
tests), `gh` CLI (pre-installed on GitHub-hosted `ubuntu-latest`), `git`;
`softprops/action-gh-release@v3` consumes `dist/release-notes.md` **Storage**: N/A — produces a
Markdown artifact (`dist/release-notes.md`) **Testing**: `deno task test` (Deno.test); pure helpers
already covered in `tests/scripts/gen_changelog_test.ts` **Target Platform**: GitHub Actions
`ubuntu-latest` runner (CI) + local engineer machine (preview) **Project Type**: Single-project CLI
repo; this feature is build/release tooling (`scripts/` + `.github/workflows/`), not the shipped
binary **Performance Goals**: N/A (one-shot release-time script; PR fetches are cached per-process)
**Constraints**: No network in unit tests — the fetch seam must be injectable; CI-only `--strict`
must not break the local preview path **Scale/Scope**: Per release, ≤ dozens of feat PRs in range;
the v1.13.0 range (~10 feat PRs) is the regression fixture

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

The CLI half ships a bundled placeholder constitution; the active governance is `AGENTS.md` + the
monorepo `CLAUDE.md` + constitution § (OSS/private boundary). Relevant gates:

- **OSS/private boundary (§I)** — PASS. This is the public CLI half only; no private-half code,
  names, or secrets are touched. `gh pr view` reads public `mkrlabs/specflow` PRs.
- **Single shared generation path** — PASS. The fix keeps one `gen-changelog.ts` used by both local
  preview and CI; it does **not** fork behaviour per environment. `--strict` only changes failure
  _handling_, not output content.
- **TDD / test-first** — PASS. Every behavioural change lands behind a Deno.test using an injected
  fake fetcher (no network). The previously-untested I/O assembly loop becomes testable.
- **Conventional commits + branch-and-PR for non-trivial CLI changes** — PASS. Work is on branch
  `010-release-adoption-parity`, merged via PR on `mkrlabs/specflow`.
- **No silent caps / no silent failure** — PASS, and this is the heart of the fix: the
  `""`-on-failure swallow is replaced by an explicit, surfaced outcome.

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
.specflow/specs/010-release-adoption-parity/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1..D7
├── data-model.md        # Phase 1 — PrBodyOutcome, PrBodyFetcher, AdoptionAssembly
├── quickstart.md        # Phase 1 — manual repro + automated coverage map
├── contracts/
│   └── adoption-parity.md   # Phase 1 — fetcher contract, strict-mode contract, C1..C5 ⇄ tests
└── tasks.md             # Phase 2 — /specflow tasks output (NOT created here)
```

### Source Code (repository root = `apps/specflow/`)

```text
scripts/
└── gen-changelog.ts          # EDIT — PrBodyOutcome union, injectable fetcher,
                              #        assembleAdoptionEntries(), --strict mode

.github/workflows/
└── release.yml               # EDIT — Generate release notes step:
                              #        + env GH_TOKEN, + --allow-env, + --strict;
                              #        update the half-applied #adoption comment

tests/scripts/
└── gen_changelog_test.ts     # EDIT — fake-fetcher helper, assembly tests,
                              #        strict-mode exit test, v1.13.0 fixture
```

**Structure Decision**: Single-project CLI repo; all changes live in the existing `scripts/` +
`.github/workflows/` + `tests/scripts/` directories. No new modules, no `src/` (hexagonal) impact —
this is release tooling, not binary runtime code. The injectable-fetcher seam is internal to
`gen-changelog.ts` (a function-parameter port, not a new file).

## Phase 0: Outline & Research

See [research.md](./research.md). All unknowns resolved; no NEEDS CLARIFICATION remains. Key
decisions:

- **D1** Root cause = missing `GH_TOKEN` env on the release-notes step (not deno flags, not checkout
  depth). Confirmed against the `security-preflight` step which sets it and works.
- **D2** `Deno.Command` inherits parent env regardless of `--allow-env`; add `--allow-env` anyway
  for forward-safety/explicitness, but the env passthrough is what matters.
- **D3** Replace `""`-on-failure with a `PrBodyOutcome` discriminated union
  (`retrieved | absent | failed`); cache stores outcomes.
- **D4** Extract `assembleAdoptionEntries(classified, fetcher, opts)` as the injectable,
  unit-testable seam.
- **D5** Guard = CI-only `--strict` in `gen-changelog.ts`; exit non-zero on any `failed` outcome
  before the file is written. Rejected a separate parity script (more moving parts, duplicate range
  logic).
- **D6** Keep `--strict` OUT of the local preview invocation in `release/SKILL.md`.
- **D7** Regression fixture = inlined v1.13.0 PR-body strings fed through the fake fetcher; no live
  network in tests.

## Phase 1: Design & Contracts

- [data-model.md](./data-model.md) — `PrBodyOutcome`, `PrBodyFetcher`, `AdoptionAssembly` result,
  and the `null`/empty-body normalisation rule.
- [contracts/adoption-parity.md](./contracts/adoption-parity.md) — the fetcher contract, the
  strict-mode exit contract, the workflow-step contract, and the C1–C5 ⇄ test ⇄ SC/FR acceptance
  mapping.
- [quickstart.md](./quickstart.md) — manual repro (unauth `gh` → empty guide), the fixed path, and
  the automated-coverage table.

**Agent context update**: point the plan reference in the agent context file at this plan (handled
by the plan script step; no-op if the marker is absent).

### Post-design Constitution re-check

Still PASS. The design adds no new files, no binary-surface change, no template change, no
install-flow change — a script + workflow + test change that strictly _removes_ a silent-failure
path. Single shared generation path preserved.

## Complexity Tracking

No constitution violations — section intentionally empty.
