# Research: Gate-aware clarify phase

## D1 — A `specflow gate` command is the phase↔client bridge

**Decision**: Expose the #357 `GateSession` through a `specflow gate` subcommand
(status/raise/cancel) that the markdown clarify phase invokes via shell. **Rationale**: skill phases
are markdown executed by Claude in the target project; they cannot import TypeScript — a CLI surface
is the only way to "use the gate client" (FR-001), mirroring how `cloud/*.sh` scripts call
`specflow cloud token`. **Alternatives**: re-implement HTTP in the markdown (rejected — duplicates
#357, no tests); a hidden internal flag (rejected — a real subcommand is testable + reusable by
#359).

## D2 — Parseable exit-code scheme over stderr text

**Decision**: `raise` exits `0`=answered (answer JSON on stdout), `3`=unresolved (timeout),
`4`=cancelled, `5`=no_remote (prereqs unmet), `1`=other error; `status` exits `0`=remote on,
non-zero=off/unconfigured. **Rationale**: the phase must branch deterministically without scraping
human text; distinct codes map 1:1 to the #357 `ResolutionOutcome`. **Alternatives**: parse a status
string (brittle); always-0 + JSON status field (forces the phase to JSON-parse before knowing if it
can) — codes are simpler for a markdown phase.

## D3 — Question→gate-type mapping

**Decision**: multiple-choice clarify question → `decision` gate (`options[]` from the A/B/C
choices, answer `choiceId`); free-form/short-answer → `clarification` gate (answer `text`).
**Rationale**: the contract's types already fit; `decision` preserves the discrete choices a human
picks on a phone, `clarification` covers the open answer. **Alternatives**: always `clarification`
with the options in prose (rejected — loses the structured pick, worse mobile UX).

## D4 — Idempotent re-run

**Decision**: `raise` always does open→await→**apply** (apply idempotent per #357), so a resolved
gate moves to `applied` and the phase writes the clarification once. A resumed run that already
integrated the answer detects the existing `## Clarifications` bullet (the phase's existing dedupe)
and does not re-raise. **Rationale**: FR-005 / SC-002 — converge a crash-resumed headless run
without duplicate spec edits. **Alternatives**: track gate ids in a sidecar file (heavier; the
spec's own clarification log already records what was answered).

## D5 — Minimal, guarded template edit

**Decision**: confine the clarify.md change to step 4 (the questioning loop): a "remote mode" branch
checked via `specflow gate status`; if on, each accepted question is raised as a gate instead of
prompted; everything else (caps, deferral, integration rules, Domain-Model exit gate) is untouched.
**Rationale**: FR-006/FR-008/SC-003 — the local path must stay byte-identical; a tightly-scoped
branch keeps the diff auditable and the off-path a no-op. **Alternatives**: a separate
`clarify-remote.md` (rejected — duplicates 140 lines, drifts).
