# Implementation Plan: Phase-entry spec pull, auto-generation & parallel orchestration

**Branch**: `021-cli-phase-wiring` | **Date**: 2026-07-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `.specnaut/specs/021-cli-phase-wiring/spec.md` **Issue**:
specnaut-cli#425 (Lot 4 of epic specnaut-monorepo#15) · depends on Lot 2 (cli#424, shipped)

## Summary

Make the cloud spec backend **automatic** across the phase flow, building entirely on Lot 2's
shipped mechanism (`renderSpecBackend`, `spec-backend=local|cloud` marker blocks,
`spec_backend_filter`, the `spec pull`/`spec push` commands, cloud `specify`, the gitignored cache).
Three parts: (1) add a `spec-backend=cloud` **pull-on-entry** block to the consuming phase docs
(`implement`, `review`, `analyze`, `tasks`) so each runs one `spec pull <task>` before agents read
files; (2) an **opt-in auto-generation** toggle (`spec_autogen` in `installed.lock`, default off)
that the task-creation guidance honours to run cloud `specify` at task creation; (3)
**parallel-authoring guidance** (docs) leaning on Lot 2's branch-free `specify`. Mostly
template/phase-doc edits + a small lock field — no new compiled command.

## Technical Context

**Language/Version**: TypeScript (strict) on Deno **Primary Dependencies**: Lot 2's
`spec_backend_filter` / `renderSpecBackend` / `spec pull` command / `installed_lock` **Storage**:
filesystem (Lot 2 cache) + Cloud via Lot 2's commands **Testing**: `deno task test` — golden
local-parity (new phase docs) + integration (pull-on-entry, auto-gen toggle) **Target Platform**:
compiled Deno binary **Project Type**: CLI (hexagonal) **Constraints**: local parity byte-identical
(FR-003); auto-gen non-fatal (FR-006); § I — Cloud only via Lot 2 commands / versioned API
**Scale/Scope**: ~4 phase-doc edits + 1 lock field + guidance docs + tests

## Constitution Check

No local CLI constitution → monorepo § I governs. This lot adds no new Cloud coupling (it drives Lot
2's commands); the phase docs carry only opaque `spec pull <task>` invocations. **PASS** (re-checked
post-Phase 1: PASS).

## Project Structure

### Documentation (this feature)

```text
.specnaut/specs/021-cli-phase-wiring/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/phase-wiring.md
└── tasks.md
```

### Source Code (repository root = `apps/specnaut-cli/`)

```text
src/domain/
├── installed_lock.ts        # MODIFIED — add `spec_autogen: boolean` (absent → false); round-trip
└── conditional_render.ts    # (reuse Lot 2's renderSpecBackend — confirm it processes ALL phase docs,
                             #  not just specify/implement; extend the filter's entry set if needed)

templates/core/skills/specnaut/phases/
├── implement.md             # MODIFIED — cloud block: `spec pull <task>` at entry (before the
│                            #   existing create-new-feature.sh --branch-only step from Lot 2)
├── review.md · analyze.md · tasks.md   # MODIFIED — cloud block: `spec pull <task>` at entry
└── (specify.md — Lot 2; task-creation guidance references auto-gen)

templates/core/skills/backlog|specnaut/…   # MODIFIED — auto-gen guidance: when spec_autogen && cloud,
                             #   task creation also runs cloud `specify`; parallel-authoring note
src/infrastructure/harness/spec_backend_filter.ts   # (verify all 4 consuming phase docs are filtered)
```

**Structure Decision**: reuse Lot 2's established `spec-backend` marker + filter mechanism verbatim;
the only compiled change is one `installed.lock` field. This keeps the lot low-risk — it's an
extension of a shipped, tested pattern, not new machinery.

## Phase 0 — Research (done → research.md)

Grounded in Lot 2's shipped code. Decisions: reuse `renderSpecBackend` for the 4 consuming phase
docs (D1); `spec_autogen` lock field, default off (D2); auto-gen is agent-workflow guidance
honouring the toggle + Lot 2 cloud specify, non-fatal (D3); parallel authoring is guidance only, no
compiled orchestrator (D4); local parity guarded by golden tests on the new phase docs (D5).

## Phase 1 — Design & Contracts (done)

- [data-model.md](./data-model.md) — the `spec_autogen` field, the PhaseMode value object, the
  pull-on-entry step shape.
- [contracts/phase-wiring.md](./contracts/phase-wiring.md) — the exact cloud-block content per phase
  doc + the auto-gen guidance contract.
- [quickstart.md](./quickstart.md) — exercise pull-on-entry + auto-gen + parallel locally.

**Constitution re-check**: PASS — no new Cloud surface; opaque `spec pull` invocations only.

## Complexity Tracking

No violations — reuses Lot 2's mechanism; one additive lock field.
