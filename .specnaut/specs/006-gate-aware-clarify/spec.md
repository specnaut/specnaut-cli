# Feature Specification: Gate-aware clarify phase

**Feature Branch**: `006-gate-aware-clarify`\
**Created**: 2026-06-04\
**Status**: Draft\
**Input**: "Turn `[NEEDS CLARIFICATION]` markers into remotely-resolvable gates. When remote mode is
enabled, `/specflow clarify` opens a gate (question + spec context) instead of blocking locally,
polls for resolution via the gate client, writes the clarified spec on resolution, and resumes the
chain — idempotently (a resolved gate applies once). Falls back to the local interactive prompt when
remote mode is off (no regression)." (issue #358; CLI half of the remote-control epic, monorepo#5)

## Overview

The clarify phase resolves spec ambiguities by asking a human up to five questions, one at a time,
at the terminal. That requires someone present at the session. This feature makes those questions
**remotely resolvable**: with remote mode on (#357), each clarify question is raised as a **gate**
the human answers from anywhere (e.g. a phone), and the phase **suspends and auto-resumes** when the
answer arrives — no terminal interaction. With remote mode off, the existing interactive loop is
unchanged.

The bridge is a thin `specflow gate` CLI command that wraps the agent-side gate client/session
(#357), so the markdown clarify phase invokes it rather than re-implementing HTTP/polling. A
multiple-choice question maps to a `decision` gate (options → `choiceId`); a free-form question maps
to a `clarification` gate (→ `text`).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A clarify question is answered from a phone (Priority: P1)

A headless `/specflow clarify` run finds an ambiguity. With remote mode on, instead of printing the
question to a terminal nobody is watching, it raises a gate carrying the question, its options (if
any), and spec context. The human answers later from their phone; the phase observes the answer,
records it into the spec, and continues the chain — unattended.

**Why this priority**: This is the entire point of the issue — moving the clarify checkpoint off the
terminal is what unblocks headless operation. Everything else is fallback or idempotency around it.

**Independent Test**: With remote mode on against a stub backend, run the clarify path for one
question, have the stub resolve the gate, and confirm the answer is written into the spec with no
terminal prompt.

**Acceptance Scenarios**:

1. **Given** remote mode on and a multiple-choice ambiguity, **When** clarify needs the answer,
   **Then** it opens a `decision` gate (question + options + context) and suspends.
2. **Given** remote mode on and a free-form ambiguity, **When** clarify needs the answer, **Then**
   it opens a `clarification` gate (question + context) and suspends.
3. **Given** a suspended clarify gate, **When** the human resolves it remotely, **Then** the phase
   receives the typed answer, writes the clarification into the spec, and resumes.

---

### User Story 2 - Idempotent application (Priority: P1)

A resolved clarification is applied to the spec **exactly once**. Re-running clarify when a gate is
already `answered`/`applied` reuses the existing answer rather than opening a duplicate gate or
double-writing — so a crash-resumed headless run converges.

**Why this priority**: Without idempotency, a resumed or retried run would re-ask answered questions
or corrupt the spec with duplicate clarifications, defeating headless durability.

**Acceptance Scenarios**:

1. **Given** an `answered` gate for a question, **When** clarify runs again, **Then** it applies the
   existing answer (→ `applied`) without opening a new gate.
2. **Given** an `applied` gate, **When** clarify runs again, **Then** the clarification is present
   in the spec exactly once (no duplicate bullet, no re-open).

---

### User Story 3 - Local fallback unchanged (Priority: P1)

With remote mode off (the default), `/specflow clarify` behaves exactly as today: the interactive
one-question-at-a-time loop with recommendations.

**Why this priority**: Most users run clarify locally; the feature must not regress them. The remote
path is strictly additive behind the switch.

**Acceptance Scenarios**:

1. **Given** remote mode off, **When** clarify runs, **Then** no gate is opened and the local
   interactive loop runs verbatim.
2. **Given** remote mode on but prerequisites unmet (no Cloud link / creds), **When** clarify tries
   to raise a gate, **Then** it reports a clear, actionable error (pointing at
   `specflow cloud
   login`) rather than hanging.

---

### Edge Cases

- **Gate cancelled / times out while awaiting** — the `specflow gate` command exits non-zero with a
  distinct status (cancelled vs unresolved); the phase reports it and stops cleanly rather than
  looping or guessing an answer.
- **Answer doesn't fit the question** — a `decision` answer whose `choiceId` isn't an offered option
  is rejected by the backend (422); the command surfaces it and the phase does not write a bogus
  clarification.
- **More than five questions** — the five-question cap is unchanged; remote mode raises at most five
  gates per session, one per accepted question.
- **Mixed availability** — if remote mode is on but a single question is better left to planning,
  the existing "defer to plan" rule still applies (no gate opened for deferred questions).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The CLI MUST expose a `specflow gate` command that lets a skill phase, without
  re-implementing HTTP/polling, (a) check whether remote mode is enabled for the project, (b) raise
  a gate of a given type with a JSON payload and block until it is resolved, printing the typed
  answer, and (c) cancel a gate.
- **FR-002**: `specflow gate raise` MUST open the gate (#357 client), await resolution, apply it
  (idempotent), and emit the answer as machine-readable JSON on success; on a terminal non-answer
  (timeout, cancelled) it MUST exit non-zero with a distinct, parseable status.
- **FR-003**: The gate command MUST resolve remote mode and credentials exactly as #357 defines
  (config + `SPECFLOW_REMOTE`, transparent token refresh) and MUST emit a clear "remote mode
  requires login" error when prerequisites are unmet — never hang.
- **FR-004**: The `clarify` phase template MUST, when remote mode is enabled, raise each accepted
  clarification as a gate instead of prompting at the terminal: a multiple-choice question as a
  `decision` gate (its options → `choiceId`), a free-form question as a `clarification` gate (→
  `text`), including the relevant spec context in the payload.
- **FR-005**: On resolution the phase MUST integrate the answer into the spec using the **same**
  rules as the local loop (Clarifications log bullet + targeted section update) and MUST apply each
  resolved gate's answer **exactly once** (idempotent re-runs).
- **FR-006**: With remote mode off, the `clarify` phase MUST run the existing interactive loop
  verbatim — no gate command invoked, no behavioural change (no regression).
- **FR-007**: The gate command MUST NOT leak any Cloud-internal identifier or backend error string
  (constitution § I); it speaks only the public wire format via the #357 client.
- **FR-008**: The five-question cap, deferral rules, and the Domain-Model exit gate of the clarify
  phase MUST remain in force unchanged in both modes.

### Key Entities

- **Gate command invocation** — the phase's call to `specflow gate raise/status/cancel`; inputs are
  type + title + payload (+ task), output is the typed answer JSON or a status exit code.
- **Clarification answer** — the typed result (`{text}` or `{choiceId}`) the phase maps back to a
  spec edit.

## Domain Model _(mandatory)_

**Bounded context**: The Specflow **CLI clarify phase + its gate command surface** — how the
clarification checkpoint is raised and resolved (locally or remotely). It owns the question→gate
mapping and spec integration; it does NOT own gate persistence, the human resolve action, or the
wire contract (those are #17/#356) — it consumes the #357 client.

**Ubiquitous language**:

- **Clarify gate** — a gate opened to answer one clarify question (`decision` or `clarification`).
- **Raise** — open + await + apply a gate via `specflow gate raise`, yielding the answer.
- **Local loop** — the existing interactive terminal questioning (the off-mode fallback).

**Entities**: none new with identity (the Gate's identity is the #357 contract's `id`).

**Value objects**: gate command invocation, clarification answer — compared by value.

**Invariants**:

- Remote mode off ⇒ byte-for-byte the current local loop (no gate command runs).
- Each resolved gate's answer is written to the spec exactly once (idempotent).
- At most five clarify gates per session (the question cap is unchanged).
- Only the public wire format crosses the boundary (§ I); the command never prints a backend string.

**Out of scope**:

- Plan/merge approval STOPs and headless VM mode (#359).
- Mobile UI (#2/#3); push delivery (#18).
- Changing the wire contract (#356) or the #357 client internals.

## Success Criteria _(mandatory)_

- **SC-001**: A headless `clarify` run resolves a question via a remotely-answered gate and writes
  the answer into the spec with zero terminal interaction.
- **SC-002**: Re-running clarify after a gate is resolved applies the answer exactly once — no
  duplicate clarification bullet, no re-opened gate.
- **SC-003**: With remote mode off, the clarify phase's behaviour and output are identical to the
  prior release (verified by the unchanged local-loop tests + template diff confined to a guarded
  remote branch).
- **SC-004**: Enabling remote mode without a Cloud login yields one clear, actionable error from
  `specflow gate`, not a hang.
- **SC-005**: The `specflow gate` command round-trips open→await→apply against a stub with injected
  fetch/clock, emitting the typed answer as JSON, with no Cloud-internal identifier in its output.

## Assumptions

- #357 (gate client/session + remote mode) is shipped and is the only mechanism this phase uses to
  talk to Cloud.
- The clarify phase template is the bundled `templates/core/skills/specflow/phases/clarify.md`
  (re-bundled into `templates_bundle.ts`); editing it is the deliverable that reaches end users.
- Mapping MC→`decision` and free-form→`clarification` is faithful to the contract's gate types and
  needs no contract change.
- "Writes the clarified spec to disk" reuses the phase's existing integration rules; this feature
  changes only _how the answer is obtained_, not how it is integrated.

## Dependencies

- **#357** — CLI remote mode + gate client/session (consumed by the new `gate` command). Done.
- **#17 / #356** — Cloud gate backend + wire contract. Done.
