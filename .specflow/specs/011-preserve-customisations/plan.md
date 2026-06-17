# Implementation Plan: Preserve per-project customisations across template refreshes

**Branch**: `011-preserve-customisations` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `.specnaut/specs/011-preserve-customisations/spec.md` (issue
mkrlabs/specflow#367)

## Summary

`specflow upgrade` already auto-preserves a customised managed file (on-disk SHA ≠ lock SHA →
`UpgradeAction kind:"preserve"; reason:"customized"`). But `specflow init --force` **bypasses
`computeUpgradePlan` entirely** — it calls `writer.writeBundle(bundle, targetDir, {overwrite:true})`
with no per-file discrimination, so a forced refresh overwrites every managed file unconditionally.
That is how a customised `.claude/agents/product-owner.md` was silently reverted to the bundled
generic on 2026-06-08.

The fix adds an **explicit, force-surviving preserve declaration** plus a **read-only divergence
view** and an explicit **reset opt-out**:

1. A project-level `.specnaut/preserve.yml` manifest (a flat list of project-relative paths)
   declares which managed files are the maintainer's. A new pure domain type (`preserve_config.ts`),
   a `PreserveStore` port, and an `FsPreserveStore` adapter (mirroring `FsLockStore`) read it.
2. `init --force` filters preserved paths out of the write set in `InitProjectUseCase`; `upgrade`
   honours the same declaration by promoting declared paths to `preserve` (new `reason:"declared"`)
   in `computeUpgradePlan`, even when the file is not hash-diverged. Both paths emit a per-file
   notice (FR-004) — no silent skip.
3. A net-new top-level `specflow diff` command shows, read-only, how each managed file diverges from
   its bundled original, reusing the existing `renderUnifiedDiff` and `CORE_BUNDLE`.
4. A `--reset-preserved` flag on `init`/`upgrade` flips the preserve predicate off for one run,
   restoring the bundled versions; never the default, and it reports each override.

Together: US1 restores control over a forced refresh, US2 makes long-term preservation safe via
visible divergence, US3 provides the deliberate escape hatch.

## Technical Context

**Language/Version**: TypeScript on Deno v2.x **Primary Dependencies**: Deno std (`@std/yaml` for
the manifest, `@std/assert` for tests); existing in-repo `renderUnifiedDiff` (`src/domain/diff.ts`),
`CORE_BUNDLE` (`src/.../templates_bundle.ts`), hexagonal ports in `src/application/ports.ts`
**Storage**: a new `.specnaut/preserve.yml` (flat YAML list); state of record stays in the existing
`.specnaut/installed.lock` **Testing**: `deno task test` (Deno.test); hermetic fakes for every port
(`FsReader`, `FsWriter`, `LockStore`, new `PreserveStore`) — no network, no real binary **Target
Platform**: GitHub-hosted runners + local engineer machine; the CLI binary itself **Project Type**:
Single-project CLI repo, hexagonal (domain / application / infrastructure / cli) **Performance
Goals**: N/A — one-shot init/upgrade/diff invocations over ≤ low-hundreds of managed files
**Constraints**: `diff` MUST mutate nothing; the feature MUST be inert when no `preserve.yml` exists
(FR-011 — no default-path behaviour change); preserve must be honoured identically by `init --force`
and `upgrade` (FR-002/FR-003) **Scale/Scope**: a managed bundle of ~90 files; preserve lists of a
handful of paths in practice

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

The CLI half ships a bundled placeholder constitution; the active governance is `AGENTS.md` + the
monorepo `CLAUDE.md` + constitution § (OSS/private boundary). Relevant gates:

- **OSS/private boundary (§I)** — PASS. Public CLI half only; no private-half code, names, or
  secrets. The manifest holds project-relative template paths, nothing cross-boundary.
- **Hexagonal layering** — PASS. New pure domain (`preserve_config.ts`), a new port in `ports.ts`, a
  new infra adapter (`fs_preserve_store.ts`), handler-side wiring — no layer inversion. The
  declared-preserve predicate is injected into the domain (`UpgradePlanOptions`), not imported by
  it, exactly like `isPluginCoveredPath`.
- **No silent failure / no silent caps** — PASS, and central to the fix: the silent `--force`
  overwrite is replaced by an explicit, surfaced preserve; every skip and every reset-override is
  logged per file (FR-004/FR-005).
- **TDD / test-first** — PASS. Every change lands behind a hermetic Deno.test using injected fakes;
  the new `diff` use-case and the preserve predicate are unit-testable without a real binary.
- **Conventional commits + branch-and-PR for non-trivial CLI changes** — PASS. Work is on branch
  `011-preserve-customisations`, merged via PR on `mkrlabs/specflow`.
- **Backward compatibility** — PASS. Absent `preserve.yml` ⇒ `EMPTY_PRESERVE_CONFIG` ⇒ today's
  behaviour byte-for-byte (FR-011). The lock format is unchanged (preserve intent lives in its own
  file, not the lock).

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
.specnaut/specs/011-preserve-customisations/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1..D8
├── data-model.md        # Phase 1 — PreserveConfig, PreserveStore, DivergenceResult, RefreshMode
├── quickstart.md        # Phase 1 — manual repro + automated coverage map
├── contracts/
│   └── preserve-and-diff.md   # Phase 1 — manifest contract, preserve-plan contract, diff command
│                              #           contract, reset contract, C1..C7 ⇄ tests ⇄ SC/FR map
└── tasks.md             # Phase 2 — /specflow tasks output (NOT created here)
```

### Source Code (repository root = `apps/specflow/`)

```text
src/domain/
├── preserve_config.ts        # NEW — PreserveConfig type, parse/serialize, EMPTY_PRESERVE_CONFIG (pure)
└── upgrade_plan.ts           # EDIT — preserve.reason += "declared"; UpgradePlanOptions.isDeclaredPreserved;
                              #        declared check ordered BEFORE the plugin-migration branch

src/application/
├── ports.ts                  # EDIT — add PreserveStore port
├── init_project.ts           # EDIT — InitProjectInput.preservedPaths; filter the write set; report preserved
└── diff_project.ts           # NEW — DiffProjectUseCase (read-only): lock → bundle → disk → DivergenceResult[]

src/infrastructure/
└── fs_preserve_store.ts      # NEW — reads/writes .specnaut/preserve.yml; mirrors FsLockStore (absent ⇒ EMPTY)

src/cli/
├── parser.ts                 # EDIT — `diff` intent; --reset-preserved on init & upgrade
├── handlers/init_handler.ts  # EDIT — load PreserveStore, pass preservedPaths (or empty on --reset-preserved),
                              #        warn unknown paths, log each preserved/overridden file
├── handlers/upgrade_handler.ts # EDIT — same wiring via isDeclaredPreserved predicate
├── handlers/diff_handler.ts  # NEW — runDiff: wire reader+lock+harness, render via renderUnifiedDiff
├── main.ts                   # EDIT — dispatch `case "diff"`
└── help.ts                   # EDIT — one usage line for `specflow diff`

tests/
├── domain/preserve_config_test.ts        # NEW
├── domain/upgrade_plan_test.ts           # EDIT — declared-preserve cases
├── application/init_project_test.ts      # EDIT — preservedPaths filters write set
├── application/diff_project_test.ts      # NEW
├── infrastructure/fs_preserve_store_test.ts  # NEW
└── integration/init_preserve_test.ts     # NEW — init --force keeps it; --reset-preserved overwrites
```

**Structure Decision**: Single-project hexagonal CLI repo; all changes live in the existing
`src/{domain,application,infrastructure,cli}` + `tests/` directories. Two net-new domain/application
files (`preserve_config.ts`, `diff_project.ts`), one net-new port + adapter (`PreserveStore` /
`fs_preserve_store.ts`), one net-new handler (`diff_handler.ts`). The declared-preserve predicate is
a function-parameter seam injected into `computeUpgradePlan` (no new coupling), exactly mirroring
the existing `isPluginCoveredPath` predicate.

## Phase 0: Outline & Research

See [research.md](./research.md). All unknowns resolved (architect design pass, agent
`a337df927febff143`); no NEEDS CLARIFICATION remains. Key decisions:

- **D1** Declaration mechanism = a single `.specnaut/preserve.yml` manifest (flat path list).
  Rejected per-file frontmatter (unworkable for non-markdown bundle files) and `.specnaut-override`
  sidecars (file-count blow-up, invisible to review sweeps).
- **D2** Preserve intent lives in its OWN file, not embedded in `installed.lock` — the lock is a
  state record; the manifest is user intent. (`parentManaged` embeds a derived _fact_; preserve is
  deliberate _intent_.)
- **D3** `init --force` does NOT use `computeUpgradePlan`; the preserve filter is injected at the
  `writer.writeBundle` call site in `InitProjectUseCase` (filter preserved paths out of the write
  set). `upgrade` honours the manifest via a new `isDeclaredPreserved` predicate in
  `UpgradePlanOptions`.
- **D4** `UpgradeAction.preserve.reason` gains a `"declared"` variant alongside `"customized"`; the
  declared check is ordered BEFORE both the `unchanged` and the plugin-migration branches, so a
  declared file is never auto-updated nor migrated away.
- **D5** `specflow diff` is a net-new top-level read-only command (not a subcommand of `upgrade`),
  reusing `renderUnifiedDiff` (`src/domain/diff.ts`) and `CORE_BUNDLE`; `DiffProjectUseCase` has no
  `FsWriter` dependency.
- **D6** `--reset-preserved` is parsed in `parser.ts` and threaded through both handlers; the
  use-cases never see the flag — they only see the resulting predicate / empty set.
- **D7** Unknown-path validation (FR-008) happens in the handlers against `Object.keys(bundle)` at
  run time; the domain parser stays pure and bundle-agnostic.
- **D8** Parent-managed (009): agentic paths are filtered out of the bundle BEFORE the preserve
  check, so a declared agentic path in a parent-managed sub-repo is a clean no-op (no special case).

## Phase 1: Design & Contracts

- [data-model.md](./data-model.md) — `PreserveConfig`, `PreserveStore`, `DivergenceResult`,
  `RefreshMode`, the `preserve.reason` union extension, and the empty/absent normalisation rule.
- [contracts/preserve-and-diff.md](./contracts/preserve-and-diff.md) — the manifest contract, the
  preserve-plan contract (init filter + upgrade predicate), the `diff` command contract, the reset
  contract, and the C1–C7 ⇄ test ⇄ SC/FR acceptance mapping.
- [quickstart.md](./quickstart.md) — manual repro (customise → `init --force` clobbers → declare →
  `init --force` preserves), the diff view, the reset path, and the automated-coverage table.

**Agent context update**: point the plan reference in the agent context file at this plan (handled
by the plan script step; no-op if the marker is absent).

### Post-design Constitution re-check

Still PASS. The design adds two pure/application files, one port + adapter, one read-only handler,
and a flag — it strictly removes a silent-overwrite path and adds no default-path behaviour.
Hexagonal layering intact; OSS/private boundary untouched.

## Complexity Tracking

No constitution violations — section intentionally empty.
