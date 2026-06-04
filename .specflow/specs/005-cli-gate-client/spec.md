# Feature Specification: CLI remote mode + gate client

**Feature Branch**: `005-cli-gate-client`\
**Created**: 2026-06-04\
**Status**: Draft\
**Input**: User description: "Let the CLI and its skill phases open, poll, and resolve gates over
the public `/api/v1` contract. A `remote`/gating config flag enables remote-gate mode; a gate client
module opens a gate (`POST /api/v1/gates`), awaits its resolution by polling, applies the resolved
answer to local state, and can cancel a gate it no longer needs. Works headless (no interactive
prompt required). The client is composable — skill phases wire it in rather than re-implementing it.
Out of scope: wiring into specific phases (clarify #5; plan/merge approval #6) and push delivery
(Cloud-side)." (issue #357; CLI half of the remote-control epic, monorepo#5)

## Overview

A **gate** is a blocking point a headless agent raises when it cannot proceed without a human
decision. Today a Specflow CLI session that hits such a point has only one option: stop and wait for
a human at the same terminal. This feature gives the CLI the **agent side** of the gate contract
(`docs/api/gates.md`, #356; backend #17): a reusable client that **opens** a gate carrying the
question, **blocks** until a human resolves it from anywhere (phone/web), **applies** the returned
answer, and continues — all without an interactive terminal. A `remote` switch decides whether a
gate is raised remotely (the new behaviour) or the session falls back to its current local prompt.

The CLI is the **opener/agent**: it opens, awaits, applies, and cancels. It never **resolves** —
resolution is the human action performed against the Cloud backend from another device. This feature
delivers the foundation; individual skill phases (clarify, plan/merge approval) wire it in under
separate issues (#5, #6).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A headless agent opens a gate and blocks for an answer (Priority: P1)

A headless Specflow session reaches a point it cannot decide alone. With remote mode enabled, it
opens a gate carrying the question + context, receives a stable gate `id`, and then **awaits
resolution** — polling the backend until the gate becomes `answered` — instead of returning control
to a non-existent terminal. When a human resolves it elsewhere, the agent observes the answer and
proceeds.

**Why this priority**: Open-then-await is the irreducible behaviour of the whole remote-control loop
on the CLI side. Without it, a headless run still dead-ends at the first decision point. Everything
else (apply, cancel, phase wiring) decorates this core.

**Independent Test**: Configure remote mode against a stub backend, call the client's "open and
await" path with a clarification gate, have the stub flip the gate to `answered`, and confirm the
call returns the typed answer without any terminal interaction.

**Acceptance Scenarios**:

1. **Given** remote mode is enabled and the project is Cloud-linked, **When** the agent raises a
   gate, **Then** the client opens it via the contract, obtains a stable `id`, and reports the gate
   is `open`.
2. **Given** an `open` gate the agent is awaiting, **When** a human resolves it on another device,
   **Then** the client's await loop observes the `answered` state and returns the typed answer.
3. **Given** an awaiting agent, **When** the gate has not yet been resolved, **Then** the client
   keeps polling at a bounded cadence (no tight loop, no terminal prompt) until resolution or a
   configured timeout.

---

### User Story 2 - The agent applies the answer and continues (Priority: P1)

Once a gate is `answered`, the agent consumes the answer into its local state and acknowledges
consumption so the gate moves to `applied` (terminal). Acknowledgement is idempotent — a retried or
duplicated apply is a success no-op, which keeps the headless loop safe to resume after a crash or a
network blip.

**Why this priority**: Applying closes the loop. An answered-but-never-applied gate would re-surface
on every poll and never let the run progress. Idempotency is what makes "open → await → apply" safe
to retry, which is the whole point of headless durability.

**Independent Test**: Drive a gate to `answered`, call apply, confirm the client reports `applied`;
call apply again and confirm it still reports success (no error) without a second state change.

**Acceptance Scenarios**:

1. **Given** an `answered` gate, **When** the agent applies it, **Then** the client moves it to
   `applied` and surfaces the answer for the caller to act on.
2. **Given** an already-`applied` gate, **When** apply is called again, **Then** the client reports
   success without raising an error (idempotent).
3. **Given** apply fails transiently (network), **When** the agent retries, **Then** repeating the
   call eventually succeeds without corrupting local state.

---

### User Story 3 - The agent cancels a gate it no longer needs (Priority: P2)

An agent that opened a gate but then determined the decision is moot (e.g. the run was aborted, or
another path resolved the question) **cancels** the `open` gate so it disappears from the human's
inbox.

**Why this priority**: Cancellation keeps the human's gate inbox honest — without it, abandoned
gates accumulate and a human wastes effort answering decisions that no longer matter. Important, but
the loop is functional without it, so P2.

**Independent Test**: Open a gate, cancel it, confirm the client reports `cancelled`; confirm
cancelling a non-`open` gate surfaces the contract's conflict outcome rather than a crash.

**Acceptance Scenarios**:

1. **Given** an `open` gate the agent owns, **When** the agent cancels it, **Then** the client moves
   it to `cancelled` (terminal).
2. **Given** a gate that is already `answered`/`applied`/`cancelled`, **When** cancel is attempted,
   **Then** the client surfaces a conflict outcome the caller can handle, not an unhandled error.

---

### User Story 4 - Remote mode is a switch, with a safe local fallback (Priority: P1)

Whether a gate is raised remotely is governed by a single **remote-mode** switch resolved from
configuration (and an environment override for headless/CI). When remote mode is **off** (the
default), the CLI keeps today's behaviour — the decision is handled locally / the session prompts as
it does now. When **on**, gates route through the client. A misconfigured remote mode (no Cloud
link, no credentials) fails clearly rather than silently hanging.

**Why this priority**: The switch is what makes this feature adoptable without regressing every
existing local workflow. It must ship with the client, or the client has no safe on-ramp.

**Acceptance Scenarios**:

1. **Given** remote mode is unset, **When** any gated phase runs, **Then** the CLI behaves exactly
   as it does today (no remote calls, no behavioural change).
2. **Given** remote mode is enabled but the project has no Cloud link or no valid credentials,
   **When** the agent tries to raise a gate, **Then** the CLI reports a clear, actionable error
   (e.g. "remote mode requires `specflow cloud login`") instead of hanging.
3. **Given** a headless/CI run, **When** remote mode is toggled via the documented environment
   override, **Then** the override is honoured without editing project files.

---

### Edge Cases

- **Resolution never comes** — the await loop is bounded by a configurable timeout; on timeout the
  client returns a distinct "unresolved" outcome the caller can act on (e.g. cancel + fall back),
  never an infinite hang.
- **Credentials expire mid-await** — a long await refreshes the access token transparently (reusing
  the existing refresh path); an unrecoverable auth failure ends the await with a clear re-login
  error rather than a silent 401 loop.
- **Gate resolved then cancelled race** — the client treats the contract's state as authoritative:
  if a poll observes `answered`, it proceeds to apply; contract conflict outcomes are surfaced, not
  guessed around.
- **Unknown gate `type`/event `kind`** — per the contract, the client ignores enum values it does
  not recognise rather than erroring (forward-compatibility).
- **Backend transient 5xx / network flaps** — polling tolerates transient failures with backoff and
  keeps awaiting; only an exhausted retry budget or the overall timeout ends the loop.
- **Answer shape unexpected** — a malformed/typeless answer body is reported as an invalid-answer
  outcome, never blindly trusted into local state.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The CLI MUST provide a reusable gate client that **opens** a gate against
  `POST /api/v1/gates`, carrying project key, gate type, title, type-specific payload, and an
  optional task number, and returns the opened gate (including its stable `id` and `open` state).
- **FR-002**: The client MUST **await resolution** of an open gate by polling until the gate reaches
  `answered`, at a bounded cadence, and return the typed answer — with **no interactive terminal
  prompt** required.
- **FR-003**: The await loop MUST be bounded by a **configurable timeout**; on timeout it MUST
  return a distinct "unresolved" outcome (not hang, not throw an opaque error).
- **FR-004**: The client MUST **apply** an answered gate against `POST /api/v1/gates/{id}/apply`,
  moving it to `applied`, and this apply MUST be **idempotent** (re-applying an `applied` gate is a
  success no-op).
- **FR-005**: The client MUST **cancel** an open gate against `POST /api/v1/gates/{id}/cancel`,
  moving it to `cancelled`, and MUST surface the contract's conflict outcome when the gate is not
  `open` rather than crashing.
- **FR-006**: The client MUST authenticate every request with a bearer token obtained through the
  existing credential path, **refreshing transparently** when the access token nears expiry, and
  MUST surface a clear re-login outcome when credentials are unrecoverable.
- **FR-007**: The client MUST map the contract's documented error statuses to typed outcomes the
  caller can branch on — at minimum: invalid type/payload/answer (422), illegal transition (409),
  unknown gate/project (404), and unauthorized (401) — never leaking a raw backend string.
- **FR-008**: The client MUST treat the gate contract as the single source of truth: it MUST
  **ignore unknown fields and unknown `type`/event `kind` values** (forward-compatible) and MUST NOT
  depend on any Cloud-internal identifier.
- **FR-009**: A **remote-mode switch** MUST govern whether gates are raised remotely; it MUST be
  resolvable from project configuration with a documented **environment-variable override** for
  headless/CI, and MUST default to **off** (today's behaviour preserved).
- **FR-010**: With remote mode **off**, gated code paths MUST behave exactly as they do today (no
  remote calls, no regression). The client is a dependency phases opt into, never an implicit global
  behaviour change.
- **FR-011**: With remote mode **on** but the prerequisites unmet (no Cloud link, no/expired
  credentials), the CLI MUST fail with a **clear, actionable** message rather than hanging or
  silently no-op'ing.
- **FR-012**: The client MUST be **composable** — exposed as a unit a skill phase can construct and
  drive (open → await → apply, or cancel) — with all IO (HTTP, clock, sleep) injectable so it is
  unit-testable without network, and MUST NOT itself wire into any specific phase (that is #5/#6).
- **FR-013**: The client MUST poll using the contract's documented mechanism (the gate state via the
  list/get surface and/or the shared activity feed's opaque-cursor events), reusing the established
  reconcile-cursor semantics rather than inventing a new pagination scheme.

### Key Entities

- **Gate (client view)**: the agent-side projection of the contract's gate object — `id`,
  `projectKey`, optional `taskNumber`, `type`, `title`, `payload`, `state`, `answer`, timestamps.
  Read-only mirror of the wire object; the client never invents fields.
- **Gate request**: the inputs an agent supplies to open a gate — type, title, payload, optional
  task number — validated against the type before the call.
- **Resolution outcome**: the typed result of awaiting — `answered` (with the typed answer),
  `unresolved` (timeout), or an error outcome (auth / conflict / invalid).
- **Remote-mode setting**: the resolved boolean (config + env override) that decides remote vs local
  handling of a gate.

## Domain Model _(mandatory)_

**Bounded context**: The Specflow **CLI's Cloud-bridge** — the agent-side consumer of the public
`/api/v1` gate contract. It owns "how a headless agent raises and resolves a blocking decision
remotely". It does NOT own the gate's persistence, the human resolve action, or push delivery (those
are Cloud-side, #17/#18).

**Ubiquitous language**:

- **Open** — the agent creates a gate (it becomes the opener/owner).
- **Await / poll** — the agent blocks, polling the backend, until the gate is `answered`.
- **Apply** — the agent consumes the answer into local state and acknowledges (→ `applied`).
- **Cancel** — the opener withdraws an `open` gate it no longer needs (→ `cancelled`).
- **Remote mode** — the switch deciding whether a decision is raised as a remote gate or handled
  locally.
- **Resolve** — the _human_ action (elsewhere) that answers a gate. The CLI never resolves.

**Entities** (have identity):

- **Gate** — identified by its opaque, project-scoped `id` from the contract.

**Value objects** (no identity):

- **Gate request**, **resolution outcome**, **remote-mode setting** — as above; compared by value.

**Invariants**:

- The CLI acts only as opener/agent: it performs open, await, apply, cancel — never resolve.
- Apply is idempotent; awaiting always terminates (answer, timeout, or error) — never an unbounded
  hang.
- Remote mode defaults off; off ⇒ byte-for-byte current behaviour.
- Only the versioned public wire format crosses the boundary; no Cloud-internal identifier is read
  or stored (constitution § I).
- The client never blindly trusts an answer whose shape doesn't match the gate type.

**Out of scope**:

- Wiring the client into specific skill phases — clarification (#5), plan/merge approval (#6).
- Push delivery / device notification (Cloud-side, #18).
- The human resolve UI / mobile client.
- Defining or changing the wire contract itself (frozen in #356) or the backend (#17).
- OS-native keychain storage (tracked separately, #360).

## Success Criteria _(mandatory)_

- **SC-001**: A headless run (no TTY) can open a gate, block while a human resolves it on another
  device, receive the answer, and continue — with zero terminal interaction.
- **SC-002**: Re-applying an already-applied gate, or retrying apply after a transient failure,
  never errors and never double-applies.
- **SC-003**: An awaited gate that is never resolved ends the await within the configured timeout
  with a distinct "unresolved" outcome, in 100% of runs — never an infinite hang.
- **SC-004**: With remote mode off, every existing workflow behaves identically to the prior release
  (no remote calls observable, no regression in the test suite).
- **SC-005**: Enabling remote mode without a Cloud login produces one clear, actionable error
  pointing at `specflow cloud login`, not a hang or a stack trace.
- **SC-006**: The client is exercised end-to-end (open → await → apply, and cancel) in tests using
  injected HTTP/clock/sleep, with no real network, and no Cloud-internal identifier appears in any
  request, stored value, or assertion.
- **SC-007**: A long await spanning the access-token expiry refreshes transparently and completes
  without a spurious auth failure.

## Assumptions

- The gate wire contract (`docs/api/gates.md`, #356) is frozen and authoritative; where the original
  issue text differs (it mentions `?since=cursor`), the **contract's opaque-cursor semantics
  govern**, consistent with the backend (#17) and the activity feed (#354).
- The Cloud backend (#17) implements the five gate endpoints and emits gate lifecycle events on the
  shared `/api/v1/activity` feed; this client targets exactly that surface.
- Credentials and the `api_url`/`project_key` coordinates already exist via `specflow cloud login`
  (#353) and its credential store; this feature reuses them rather than introducing new storage.
- "Apply resolution to local state" at this layer means **returning the typed answer to the calling
  phase** and acknowledging consumption; what each phase does with the answer is that phase's
  concern (#5/#6).
- Polling the gate's state (list/get) is an acceptable resolution-detection mechanism; sharing the
  activity-feed cursor is an optimization the client may use but is not required to function.
- Remote mode is opt-in for this release; no existing default flips on.

## Dependencies

- **#356** — the frozen public gate wire-format contract (the shape this client speaks). Done.
- **#17** — the Cloud gate backend serving the five endpoints + activity events. Done.
- **#353** — Cloud auth + credential store + `backlog-config.yml` coordinates (reused). Done.
