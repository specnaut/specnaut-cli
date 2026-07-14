# Phase 0 Research — Phase wiring

Grounded in Lot 2's shipped code (already merged): `src/domain/conditional_render.ts`
(`renderSpecBackend`), `src/infrastructure/harness/spec_backend_filter.ts` (`applySpecBackend`),
`src/domain/installed_lock.ts` (`SpecBackend`), the `spec pull`/`spec push` commands, cloud
`specify`, and the `spec-backend=local|cloud` marker blocks in `specify.md`/`implement.md`.

## D1 — Reuse `renderSpecBackend` for the 4 consuming phase docs

**Decision**: Add `spec-backend=cloud` pull-on-entry marker blocks to `implement.md`,
`review.md`, `analyze.md`, `tasks.md`; the block runs one `spec pull <task>` before agents read
the spec. Confirm `applySpecBackend` processes every phase doc (not just specify/implement); if
the filter's entry set is narrowed, widen it to all phase docs.

**Rationale**: Lot 2 already ships the marker+filter mechanism and applies it per-harness. Adding
markers to more phase docs is the same, tested path — no new machinery.

## D2 — `spec_autogen` lock field, default off

**Decision**: Add `spec_autogen: boolean` to `installed_lock.ts` (absent → `false`, mirroring
the `spec_backend` default). It is the opt-in toggle for auto-generation at task creation.

**Rationale**: Mirrors how backends persist; backward-compatible; off by default so task creation
is never surprised by heavy spec-gen (FR-005).

## D3 — Auto-generation is agent-workflow guidance, non-fatal

**Decision**: Auto-generation is not a new compiled command — it's guidance in the task-creation
skill/phase docs: when `spec_autogen && spec_backend == cloud`, after creating a task also run
cloud `specify` for it (Lot 2's branch-free path). A generation failure is surfaced separately
and never fails the task creation.

**Rationale**: Task creation already flows through agents (product-owner / the cloud flow);
coupling spec-gen as guarded guidance keeps it non-fatal (FR-006) and reuses Lot 2's cloud
`specify` rather than inventing a compiled orchestrator.

## D4 — Parallel authoring is guidance only

**Decision**: Document that, because cloud `specify` creates no branch (Lot 2), N task specs can
be authored concurrently with no collision. No compiled orchestration engine in v1.

**Rationale**: The branch-free property (shipped in Lot 2) already makes parallel authoring safe;
this lot only needs to say so and show the pattern.

## D5 — Local parity guarded by golden tests on the new phase docs

**Decision**: Extend the golden local-parity approach (Lot 2's `spec_backend_filter_golden_test`)
to `review.md`/`analyze.md`/`tasks.md` — the `local`-rendered docs must be byte-identical to
pre-feature. Reuse the EOL-agnostic comparison Lot 2 established (Windows CRLF).

**Rationale**: FR-003 must be mechanically proven for every phase doc this lot touches; the EOL
lesson from Lot 2's CI carries over.
