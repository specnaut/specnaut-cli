# Feature Specification: Gate-aware approval STOPs + headless VM mode

**Feature Branch**: `007-gate-aware-approvals`\
**Created**: 2026-06-04\
**Status**: Draft\
**Input**: "Make the plan STOP and merge STOP remotely approvable. When remote mode is on, the plan
checkpoint opens a `plan_approval` gate and the pre-merge checkpoint opens a `merge_approval` gate
(approve / reject / comment-and-revise); resolution resumes (approved) or halts cleanly (rejected)
without operator intervention. Document a fully headless VM operating mode that emits gates on every
STOP and auto-resumes on resolution. Local prompt behaviour preserved when remote mode is off."
(issue #359; CLI half of the remote-control epic, monorepo#5)

## Overview

The clarify checkpoint became remotely resolvable in #358. This feature does the same for the **two
approval checkpoints** in the chain — the plan checkpoint and the pre-merge checkpoint — and ties
the three together into a documented, fully **headless VM operating mode**: a Specflow run on a
remote VM that never needs an operator at the terminal, emitting a gate at every human checkpoint
and resuming automatically when the human resolves it from anywhere (e.g. a phone). It reuses the
`specflow gate` command shipped in #358, so it is almost entirely chain-template + documentation
work — no new client code. With remote mode off, every checkpoint keeps its current local prompt.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Plan approval from a phone (Priority: P1)

A headless run finishes `/specflow plan`. With remote mode on, instead of proceeding silently (or
waiting for a local nod), it opens a `plan_approval` gate carrying the plan summary + a reference,
and suspends. The human approves, rejects, or asks for a revision from their phone; the chain
resumes into `/specflow tasks` on approval, or halts with a report on rejection.

**Why this priority**: The plan checkpoint is where a human steers scope before implementation.
Making it remote is half of "never be at the terminal".

**Acceptance Scenarios**:

1. **Given** remote mode on after plan, **When** the checkpoint is reached, **Then** a
   `plan_approval` gate (summary + context) is opened and the chain suspends.
2. **Given** a suspended plan gate, **When** the human approves (`approved: true`), **Then** the
   chain resumes into `tasks` automatically.
3. **Given** a suspended plan gate, **When** the human rejects (`approved: false`, optional note),
   **Then** the chain halts cleanly and reports the rejection + any revision note.

---

### User Story 2 - Merge approval from a phone (Priority: P1)

After `/specflow review`, with remote mode on, the pre-merge STOP #2 opens a `merge_approval` gate
(change summary + PR/diff reference) instead of the local "Ready to merge?" prompt. Approve resumes
into `/specflow merge`; reject halts with the validation summary.

**Why this priority**: The merge checkpoint is the last human gate before shipping; making it remote
completes the unattended loop.

**Acceptance Scenarios**:

1. **Given** remote mode on at STOP #2, **When** review passes, **Then** a `merge_approval` gate
   (summary + context) is opened in place of the terminal prompt.
2. **Given** an approved merge gate, **When** resolution arrives, **Then** `/specflow merge` runs
   and the chain ends.
3. **Given** a rejected merge gate, **When** resolution arrives, **Then** the chain halts on the
   branch with the pre-merge summary and the rejection note.

---

### User Story 3 - Documented headless VM mode (Priority: P2)

A documented operating mode runs the full chain unattended on a VM — e.g. via `/goal` or `claude -p`
— emitting a gate at every STOP (clarify #358, plan, merge) and resuming on each resolution, so
`specify → plan STOP → tasks → … → merge STOP → done` completes with every checkpoint answered
remotely.

**Why this priority**: The mode is the _payoff_ of the epic, but it is documentation composing
features that already exist; it can land just after the two approval gates.

**Acceptance Scenarios**:

1. **Given** the headless-mode doc, **When** an operator follows it, **Then** it specifies how to
   enable remote mode, launch the run unattended, and where gates surface for resolution.
2. **Given** a fully unattended run with all STOPs resolved remotely, **When** it completes,
   **Then** no terminal interaction was required at any checkpoint.

---

### User Story 4 - Local behaviour preserved (Priority: P1)

With remote mode off (default), the plan and merge checkpoints behave exactly as today — silent plan
gate / interactive "Ready to merge?" prompt. No regression.

**Acceptance Scenarios**:

1. **Given** remote mode off, **When** the chain reaches either checkpoint, **Then** no gate is
   opened and the current local behaviour runs verbatim.
2. **Given** remote mode on but prerequisites unmet, **When** a checkpoint is reached, **Then** it
   reports that `specflow cloud login` is needed and falls back to the local prompt — never hangs.

### Edge Cases

- **Comment-and-revise** — a rejection carrying a note is surfaced as a revision request; the chain
  halts (does not auto-loop) so the operator/agent can revise and re-run.
- **Approval gate cancelled / times out** — the checkpoint reports the distinct outcome and halts
  cleanly rather than proceeding on an unconfirmed approval (a STOP must never auto-approve).
- **Mixed**: clarify gate (#358) + plan gate + merge gate in one run all drain the same gate
  channel; each resolves independently.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: When remote mode is on, the plan checkpoint MUST open a `plan_approval` gate (payload:
  plan `summary`, optional `planRef`/`context`) via `specflow gate raise` and suspend until
  resolved.
- **FR-002**: When remote mode is on, the pre-merge STOP #2 MUST open a `merge_approval` gate
  (payload: change `summary`, optional `prUrl`/`context`) in place of the local "Ready to merge?"
  prompt and suspend until resolved.
- **FR-003**: On an **approved** resolution (`approved: true`) the chain MUST resume automatically
  (plan → `tasks`; merge → `/specflow merge`); on a **rejected** resolution (`approved: false`) it
  MUST halt cleanly and report the rejection plus any `note` (comment-and-revise).
- **FR-004**: A non-answer outcome (timeout/cancelled/error from `specflow gate`) MUST halt the
  checkpoint cleanly with the distinct reason — a STOP MUST NEVER proceed without an explicit
  approval.
- **FR-005**: With remote mode off, both checkpoints MUST run their current local behaviour verbatim
  (silent plan gate; interactive merge prompt) — no gate opened, no regression.
- **FR-006**: The project MUST document a **headless VM operating mode** that composes remote mode +
  the clarify/plan/merge gates into an unattended end-to-end run (enable, launch via `/goal` or
  `claude -p`, resolve gates remotely), including the fallback when prerequisites are unmet.
- **FR-007**: The approval checkpoints MUST reuse the #358 `specflow gate` command and the public
  wire contract only — no new Cloud coupling, no Cloud-internal identifier on any surface (§ I).
- **FR-008**: All existing chain mechanics (lite/full shape, silent gates, artefact-detection
  re-entry, STOP #1 clarification) MUST remain unchanged; this feature only augments the two
  approval STOPs behind the remote switch.

### Key Entities

- **Plan-approval checkpoint** — the post-plan gate decision (`approved`, `note?`) that gates entry
  into `tasks`.
- **Merge-approval checkpoint** — the pre-merge STOP #2 gate decision that gates entry into `merge`.
- **Headless VM mode** — the documented composition enabling a fully unattended run.

## Domain Model _(mandatory)_

**Bounded context**: The Specflow **chain control + approval checkpoints** — how the plan and merge
human STOPs are presented and resolved (locally or remotely) and how they compose into an unattended
run. It owns checkpoint→gate mapping + resume/halt control; it does NOT own gate persistence, the
human resolve action, or the wire contract (#17/#356), nor the `specflow gate` command internals
(#358) — it consumes them.

**Ubiquitous language**:

- **Plan approval / merge approval** — the two `*_approval` gates raised at the respective STOPs.
- **Resume / halt** — the chain proceeds on approve, stops cleanly on reject/non-answer.
- **Headless VM mode** — remote mode + all STOP gates, run unattended.

**Entities**: none new with identity (gate identity is the contract's `id`).

**Value objects**: plan-approval decision, merge-approval decision (`{approved, note?}`) — by value.

**Invariants**:

- A STOP never proceeds without an explicit `approved: true`; any other outcome halts.
- Remote mode off ⇒ byte-for-byte current local behaviour at both checkpoints.
- Only the public wire format crosses the boundary (§ I).
- Existing chain shapes and the STOP #1 clarification checkpoint are unchanged.

**Out of scope**:

- The clarify checkpoint (#358, shipped).
- Mobile UI (#2/#3); Cloud push delivery (#18).
- New gate types or contract changes; new client code (reuses #358's command).

## Success Criteria _(mandatory)_

- **SC-001**: A fully unattended run (`specify → plan STOP → tasks → … → merge STOP → done`)
  completes with both approval STOPs resolved remotely and zero terminal interaction.
- **SC-002**: An approved plan gate resumes into `tasks`; a rejected one halts with the note — in
  100% of runs (a STOP never auto-proceeds without approval).
- **SC-003**: An approved merge gate runs `/specflow merge`; a rejected one halts on the branch with
  the pre-merge summary.
- **SC-004**: With remote mode off, both checkpoints' behaviour and output are identical to the
  prior release (verified by the unchanged STOP text on the off-path + template-diff confined to
  guarded remote branches).
- **SC-005**: The headless-VM doc lets an operator enable + launch + resolve an unattended run end
  to end, and states the unmet-prerequisite fallback.

## Assumptions

- #358 shipped the `specflow gate` command (raises any gate type; here `plan_approval` /
  `merge_approval`) and the remote-mode switch; this feature consumes them.
- The plan and merge STOPs live in `phases/auto-chain.md` (STOP #2) and the plan/merge phase docs;
  editing those bundled templates (re-bundled + plugin-mirrored) is the deliverable.
- `plan_approval`/`merge_approval` answer is `{approved: boolean, note?}` per the contract; reject +
  note = comment-and-revise (the chain halts; revision is a fresh run, not an auto-loop).
- The headless-VM doc lives alongside existing CLI docs and references `/goal` and `claude -p`.

## Dependencies

- **#358** — `specflow gate` command + gate-aware clarify (the pattern/command reused). Done.
- **#357 / #17 / #356** — gate client, backend, wire contract. Done.
