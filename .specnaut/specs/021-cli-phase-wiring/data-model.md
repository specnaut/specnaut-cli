# Phase 1 Data Model — Phase wiring

No new compiled command; one lock field + template behaviour.

## Persisted state — `InstalledLock`

Add `spec_autogen: boolean` ↔ `specAutogen` field. `parseLock` defaults to `false` when absent
(mirrors `spec_backend` → `local`). Serialised alongside `spec_backend`.

## Value objects

- **PhaseMode(local | cloud)** — derived from `installedLock.specBackend`; selects which
  marker-block branch `renderSpecBackend` keeps in a phase doc.
- **AutogenSetting(boolean)** — `installedLock.specAutogen`; read by the task-creation guidance.

## Behaviour (template-rendered, not compiled)

- **Pull-on-entry** (consuming phases): the `spec-backend=cloud` block prepends
  `EXECUTE: specnaut spec pull <task>` (single pull) before the phase's spec-reading steps; the
  `spec-backend=local` block is the unchanged pre-feature content.
- **Auto-generation** (task-creation guidance): `if specAutogen && cloud → after creating a
  task, run cloud specify for it (branch-free); a failure is reported, the task stays created.`
- **Parallel authoring** (guidance): a note that cloud specify is branch-free ⇒ N specs can be
  authored concurrently.

## Invariants

- **Local parity** — `spec-backend=local` render of every touched phase doc is byte-identical to
  pre-feature (golden test, EOL-agnostic).
- **Auto-gen non-fatal** — never fails task creation.
- **API-only** — every Cloud touch is a Lot 2 command (`spec pull` / cloud `specify`); § I holds.
