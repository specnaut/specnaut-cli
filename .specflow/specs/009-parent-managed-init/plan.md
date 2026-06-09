# Implementation Plan: Parent-managed detection for init/upgrade

**Branch**: `009-parent-managed-init` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `.specflow/specs/009-parent-managed-init/spec.md`

## Summary

Add a `isParentManaged(targetDir) → boolean` detection to `specflow init` and `specflow upgrade`.
When the target sits inside a **providing Specflow workspace** (an ancestor with `.specflow/` whose
`deno.json` `workspace` list resolves to the target), provision the `.specflow/` toolkit as normal
but write **zero** agentic files (`.claude/skills/`, `.claude/agents/`, `.claude/commands/`). A
`target/.specflow/standalone.yml` marker overrides detection to force full provisioning. The CLI is
never special-cased; standalone clones are unchanged.

**Technical approach** (grounded in the current hexagonal code, per architect pass):

- New **pure domain** functions `isParentManaged()` + `isAgenticPath()` in
  `src/domain/parent_managed.ts`.
- New **port** `ParentWorkspaceReader` in `src/application/ports.ts` + adapter
  `FsParentWorkspaceReader` in `src/infrastructure/fs_parent_workspace_reader.ts` (the only place
  that walks the filesystem / parses ancestor `deno.json`).
- Thread a `parentManaged: boolean` through `InitProjectInput`; **filter the mapped bundle** in
  `InitProjectUseCase.execute()` before `writeBundle` and before lock-entry construction (so
  suppressed files never enter the lock).
- Persist `parentManaged?: true` on `InstalledLock`; `UpgradeProjectUseCase` reads it (re-deriving
  via the port on legacy locks) and applies the same filter.
- Handlers (`init_handler`, `upgrade_handler`) resolve detection and emit the one-line notice.

## Technical Context

**Language/Version**: Deno / TypeScript (per `apps/specflow/deno.json`, currently v1.13.1)\
**Primary Dependencies**: Deno std (`@std/path`), no new third-party deps\
**Storage**: filesystem; `.specflow/installed.lock` (YAML) is the install manifest\
**Testing**: `deno task test` — unit (in-memory port fakes) + integration (`Deno.makeTempDir` +
`runSpecflow`)\
**Target Platform**: cross-platform CLI binary (macOS / Linux / Windows)\
**Project Type**: single-project CLI (hexagonal: domain / application / infrastructure / cli)\
**Performance Goals**: detection adds one bounded upward directory walk (≤ depth-to-root
`Deno.stat`/`readTextFile`); negligible vs init/upgrade runtime\
**Constraints**: must not special-case the CLI repo (FR-010); suppressed files must not appear in
the lock (FR-012); upgrade must never resurrect deleted `.claude/` (FR-007)\
**Scale/Scope**: ~3 new source files, 2 use-case edits, 2 handler edits, 1 lock-schema field; 7 task
groups

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

The CLI repo has no runtime `.specflow/memory/constitution.md`; the binding principles are in
`apps/specflow/AGENTS.md` § "Design principles" (l.172-173) and the monorepo constitution § I
(OSS/private boundary). Gates evaluated:

| Principle                                                                                               | Status  | Justification                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hexagonal layering** (domain pure, application owns ports, infrastructure adapters, cli presentation) | ✅ PASS | New logic split exactly: pure predicates → `domain/`; port → `application/ports.ts`; FS walk → `infrastructure/`; wiring + notice → `cli/handlers/`. No Deno.* in domain/application. |
| **Ports for all I/O** (testability)                                                                     | ✅ PASS | Filesystem walk + ancestor `deno.json` parse routed through new `ParentWorkspaceReader` port; use cases stay FS-free and unit-testable with fakes.                                    |
| **TDD / tests mirror src**                                                                              | ✅ PASS | Each task lands tests beside it: `tests/domain/`, `tests/application/`, `tests/integration/` mirror the `src/` tree (architect-confirmed pattern). C1–C5 become integration fixtures. |
| **OSS/private boundary** (constitution § I)                                                             | ✅ PASS | CLI-only change; no Cloud/Mobile identifier, no private-half reference. "Providing workspace" is a generic Deno-workspace concept, not a Specflow-monorepo-specific name.             |
| **No CLI special-casing** (FR-010)                                                                      | ✅ PASS | Decision inputs are only enclosing-workspace structure + override marker; repo identity is never read.                                                                                |
| **Backward compatibility**                                                                              | ✅ PASS | Legacy `installed.lock` without `parent_managed` → upgrade re-derives once via the port, then caches; standalone path byte-for-byte unchanged.                                        |

No violations. No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
.specflow/specs/009-parent-managed-init/
├── spec.md              # /specflow specify output (done)
├── plan.md              # this file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── parent-managed-detection.md   # port + filter + lock contract
├── checklists/
│   └── requirements.md  # spec quality checklist (done)
└── tasks.md             # /specflow tasks output (next phase)
```

### Source Code (repository root = apps/specflow/)

```text
src/
├── domain/
│   ├── parent_managed.ts            # NEW — isParentManaged(), isAgenticPath() (pure)
│   └── installed_lock.ts            # EDIT — add parentManaged?: true to InstalledLock + (de)serialize
├── application/
│   ├── ports.ts                     # EDIT — add ParentWorkspaceReader port
│   ├── init_project.ts              # EDIT — InitProjectInput.parentManaged + bundle filter
│   └── upgrade_project.ts           # EDIT — read lock.parentManaged (re-derive on legacy) + bundle filter
├── infrastructure/
│   └── fs_parent_workspace_reader.ts # NEW — FsParentWorkspaceReader adapter (upward walk + deno.json)
└── cli/handlers/
    ├── init_handler.ts              # EDIT — resolve detection, pass parentManaged, emit notice
    └── upgrade_handler.ts           # EDIT — resolve/migrate detection for upgrade

tests/
├── domain/
│   ├── parent_managed_test.ts       # NEW — unit: predicates
│   └── installed_lock_test.ts       # EDIT — round-trip parent_managed field
├── application/
│   ├── init_project_test.ts         # EDIT — parent-managed suppression cases
│   └── upgrade_project_test.ts      # EDIT — lock.parentManaged suppression cases
└── integration/
    ├── init_parent_managed_test.ts  # NEW — C1, C2, C4 (override)
    └── upgrade_parent_managed_test.ts # NEW — C3, C5
```

## Phase 0: Outline & Research

See [research.md](./research.md). All Technical Context items resolved — no `NEEDS CLARIFICATION`
remained after the architect pass over the current code. Key decisions: handler-side detection (not
a use-case dep); predicate over mapped bundle `dest` strings (not `CoreCategory`); lock field caches
the decision; legacy-lock migration re-derives once.

## Phase 1: Design & Contracts

- **Data model**: [data-model.md](./data-model.md) — `ParentManagedDecision`, `StandaloneOverride`,
  the `InstalledLock.parentManaged` extension, and the agentic-path predicate domain.
- **Contracts**: [contracts/parent-managed-detection.md](./contracts/parent-managed-detection.md) —
  the `ParentWorkspaceReader` port signature, the bundle-filter behaviour, the lock-schema change,
  and the C1–C5 acceptance mapping.
- **Quickstart**: [quickstart.md](./quickstart.md) — how to verify the feature by hand and which
  tests cover each contract item.
- **Agent context**: no `<!-- SPECFLOW START/END -->` markers present in this repo's context file;
  nothing to update.

### Post-design Constitution re-check

Re-evaluated after design: all gates still PASS. The port keeps the use cases pure; the filter lives
in the use case (not the adapter) so the lock and the written set stay in lock-step (FR-012). No new
dependencies, no boundary crossings, no CLI special-casing.

## Phases summary (for /specflow tasks)

1. Domain predicates `parent_managed.ts` + unit tests.
2. `ParentWorkspaceReader` port + `FsParentWorkspaceReader` adapter + adapter tests.
3. `InstalledLock.parentManaged` field + (de)serialize + round-trip tests.
4. `InitProjectInput.parentManaged` + use-case bundle filter + unit tests.
5. `UpgradeProjectUseCase` lock-driven filter (+ legacy re-derive) + unit tests.
6. Handler wiring (`init`, `upgrade`) + one-line notice.
7. Integration tests C1–C5.

## Key rules

- Absolute paths for filesystem ops; project-relative paths in docs/references.
- ERROR on any gate failure (none expected).
- Domain stays pure: no `Deno.*` in `domain/` or `application/`.
