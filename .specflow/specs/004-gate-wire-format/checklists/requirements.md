# Specification Quality Checklist: Gate wire-format contract

**Purpose**: Validate specification completeness before planning **Created**: 2026-06-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — wire-format contract only
- [x] Focused on user value and business needs
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable and technology-agnostic
- [x] All acceptance scenarios defined; edge cases identified
- [x] Scope clearly bounded; dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have acceptance criteria
- [x] User scenarios cover primary flows
- [x] No implementation details in specification

## Notes

Two design choices were decided in-spec (no blocking clarification needed):

1. **Pagination** → the opaque, collision-safe **cursor** from `GET /api/v1/activity` (#354), not
   the issue's `since=` watermark — same no-miss reasoning that drove the #354 fix. (FR-006,
   Assumptions.)
2. **Answer shape** → typed per gate type (free-text for `clarification`; approve/reject + note for
   the approvals; chosen option for `decision`; acknowledgement for `agent_unblock`). (FR-004.)

Three contract design choices were resolved with the user (2026-06-04):

3. **`applied` mechanics** → explicit `POST /gates/{id}/apply` (idempotent, agent-only); the server
   tracks all states. (FR-014.)
4. **Validation** → strict, typed per gate type; resolve rejects a mismatched answer (422).
   (FR-004/007.)
5. **Stale gates** → a `cancelled` terminal state + `POST /gates/{id}/cancel` ship in v1. (FR-015.)

Final state machine: `open → answered → applied`, plus `open → cancelled`. Five endpoints
(open/list/resolve/apply/cancel) and four activity event kinds. Boundary (§I) is a first-class
invariant — this is the OSS↔Cloud coupling point. Ready for `/specflow plan`.
