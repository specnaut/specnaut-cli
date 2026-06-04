# Feature Specification: Gate wire-format contract (remote-control gates)

**Feature Branch**: `004-gate-wire-format`\
**Created**: 2026-06-04\
**Status**: Draft\
**Input**: User description: "Define the public, versioned `/api/v1` contract both the CLI and the
Cloud backend implement for **gates** — remotely-resolvable blocking points. Specify the gate object
shape, the `open → answered → applied` lifecycle, the five gate types, the open/list/resolve
endpoints, and how gates surface in the existing `GET /api/v1/activity` feed. This is the single
source of truth that every other gate workstream depends on. Contract docs only — no backend, no CLI
client, no push delivery." (issue #356; first deliverable of the remote-control epic, monorepo#5)

## Overview

A **gate** is a blocking point an agent raises when it cannot proceed without a human decision — a
spec clarification, a plan or merge approval, an unblock, or a choice between options. Instead of
halting the session, the agent **opens a gate**, keeps the run resumable, and a human **resolves**
it later from anywhere (e.g. a phone). The resolved answer flows back so the agent continues
headlessly. This spec defines only the **versioned wire-format contract** — the shared truth the CLI
and the Cloud backend both implement — not either implementation.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - An agent opens a gate and learns its lifecycle (Priority: P1)

A headless agent hits a point it cannot decide alone (e.g. a spec has an unresolved clarification).
It opens a gate carrying the question and enough context for a human to answer, receives a stable
gate `id`, and knows — from the documented state machine — that the gate is now `open` and will move
to `answered` once a human responds and to `applied` once the agent consumes the answer.

**Why this priority**: Opening a gate is the irreducible primitive of the whole remote-control loop.
Without an agreed object shape and lifecycle, nothing downstream (backend, CLI client, push, mobile)
can be built. The contract is the foundation every other workstream is blocked on.

**Independent Test**: Take the documented gate schema and a sample `open` request; confirm a
conformant producer and consumer serialize/deserialize the same object, agree on which fields are
required vs optional, and agree that the only legal initial state is `open`.

**Acceptance Scenarios**:

1. **Given** the documented gate object schema, **When** an agent opens a gate of a valid `type`
   with the required fields, **Then** the contract defines the exact response shape including a
   stable `id`, `state: open`, `createdBy`, and `createdAt`.
2. **Given** the documented state machine, **When** a reader inspects it, **Then** the only legal
   transitions are `open → answered → applied`, and every other transition is specified as illegal.
3. **Given** a gate `type` outside the five enumerated values, **When** an open is attempted,
   **Then** the contract specifies a documented validation error (not an undefined behaviour).

---

### User Story 2 - A human lists open gates and resolves one (Priority: P1)

A human (via a future mobile/web client) lists the open gates for a project, picks one, reads its
question + context, and submits an answer or approval. The contract defines the list endpoint (with
cursor pagination), the resolve endpoint, the answer shape per gate type, and the resulting state.

**Why this priority**: Resolution is the other half of the loop — a gate nobody can answer is
useless. Listing + resolving must be specified alongside opening so the round-trip is complete and
testable.

**Independent Test**: Against the documented endpoints, confirm: the list response is
cursor-paginated and filterable by project; the resolve request carries a typed answer; and
resolving an `open` gate moves it to `answered` with `answer`, `resolvedBy`, and `resolvedAt`
populated.

**Acceptance Scenarios**:

1. **Given** the list endpoint, **When** a client requests gates for a project, **Then** the
   contract defines a cursor-paginated response (opaque cursor, consistent with
   `GET /api/v1/activity`) and the filterable parameters.
2. **Given** an `open` gate and a typed answer valid for its gate type, **When** a client resolves
   it, **Then** the gate becomes `answered`, carrying the `answer`, `resolvedBy`, and `resolvedAt`.
3. **Given** a gate already `answered` or `applied`, **When** a client tries to resolve it again,
   **Then** the contract specifies a documented conflict response (resolution is single-shot).
4. **Given** a resolve request whose answer shape does not match the gate's `type`, **When** it is
   submitted, **Then** the contract specifies a documented validation error.

---

### User Story 3 - Gates surface in the activity feed (Priority: P2)

The agent already polls `GET /api/v1/activity` (the poll/reconcile feed from #354) to react to board
changes. Gate lifecycle events appear in that same feed, so the agent learns "a gate you opened was
answered" through the channel it already drains — no second polling mechanism.

**Why this priority**: It makes resolution observable to a headless agent over the existing
transport. P2 because the open/list/resolve trio (US1–US2) is independently usable first; feed
integration is the ergonomic delivery path that lets the loop close without a new poller.

**Independent Test**: Against the documented activity event additions, confirm a gate `open` and a
gate `answered` each emit a documented activity event carrying the gate `id`, `type`, and new
`state`, ordered and cursor-paginated identically to existing activity events.

**Acceptance Scenarios**:

1. **Given** the activity feed contract, **When** a gate is opened or resolved, **Then** a
   documented activity event of a gate-related kind is emitted with the gate `id`, `type`, and
   resulting `state`.
2. **Given** a consumer draining activity by cursor, **When** gate events are interleaved with task
   events, **Then** they share the same ordering + opaque-cursor semantics (no separate pagination).

---

### Edge Cases

- **Unknown gate type / malformed answer** → documented validation errors, never undefined
  behaviour.
- **Double resolution** → documented conflict; resolution is single-shot (`open` is the only
  resolvable state).
- **Resolve of a non-existent / wrong-project gate id** → documented not-found (no cross-project
  leak).
- **`applied` transition** → the contract defines that moving `answered → applied` is the consumer
  (agent) acknowledging it has used the answer; it specifies whether that transition is a client
  action or implicit, and its idempotency.
- **Optional `taskNumber`** → a gate may be project-scoped (no task) or task-scoped; the contract
  specifies the meaning of its presence/absence.
- **Versioning** → the contract states how a future field is added without breaking existing
  consumers (additive, ignore-unknown-fields).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The contract MUST define the gate object with these fields and their required/optional
  status, types, and meaning: `id`, `projectKey`, `taskNumber` (optional), `type`, `title`,
  `payload` (the question + spec/plan context a human needs to answer), `state`, `answer`
  (optional), `createdBy`, `resolvedBy` (optional), `createdAt`, `resolvedAt` (optional).
- **FR-002**: The contract MUST enumerate exactly five gate `type` values — `clarification`,
  `plan_approval`, `merge_approval`, `agent_unblock`, `decision` — and define what each means.
- **FR-003**: The contract MUST define the state machine `open → answered → applied` as the only
  legal transitions, with every other transition specified as illegal.
- **FR-004**: The contract MUST define the **answer** shape per gate type (e.g. free-text response
  for `clarification`; approve/reject + optional note for `plan_approval` / `merge_approval`; a
  chosen option for `decision`; an unblock acknowledgement for `agent_unblock`), and require the
  submitted answer to match the gate's type.
- **FR-005**: The contract MUST specify `POST /api/v1/gates` — request (open a gate: type, title,
  payload, projectKey, optional taskNumber) and response (the created gate with `id`,
  `state: open`).
- **FR-006**: The contract MUST specify `GET /api/v1/gates?projectKey=&cursor=&state=` — a
  cursor-paginated, project-filtered, optionally state-filtered list, using the **same opaque-cursor
  pagination as `GET /api/v1/activity`** (not a timestamp watermark).
- **FR-007**: The contract MUST specify `POST /api/v1/gates/{id}/resolve` — request (a typed answer)
  and response (the gate now `answered`, with `answer`, `resolvedBy`, `resolvedAt`), including the
  single-shot conflict behaviour on an already-resolved gate.
- **FR-008**: The contract MUST specify how gate lifecycle events appear in `GET /api/v1/activity` —
  the event kind(s), the fields carried (gate `id`, `type`, new `state`), and that they share the
  feed's existing ordering + opaque-cursor semantics.
- **FR-009**: The contract MUST specify the documented error responses (validation, not-found,
  conflict, unauthorized) as stable, public response codes/shapes — no implementation-defined
  errors.
- **FR-010**: The contract MUST state the authentication + authorization requirements abstractly:
  opening and resolving require an authenticated caller, and resolution is permissioned (only a
  suitably-authorized human may resolve). Exact role thresholds are deferred to the backend spec.
- **FR-011**: The contract MUST be **versioned** under `/api/v1` and define its compatibility rule:
  additive, forward-compatible changes only; consumers ignore unknown fields.
- **FR-012**: The contract MUST be **boundary-clean** (constitution § I): it exposes only the public
  wire format; no Cloud-internal identifier, table, function, or error string appears, and the same
  document is implementable by both halves without either half's internals leaking.
- **FR-013**: The contract MUST live in the CLI's public contract documentation (a discoverable doc,
  not buried in a skill), so both halves and future clients reference one source of truth.

### Key Entities _(see Domain Model section below for full structure)_

- **Gate**: a remotely-resolvable blocking point with identity, a type, a question/context payload,
  a lifecycle state, and (once resolved) an answer.
- **Answer**: the typed human response that resolves a gate; its shape depends on the gate's type.
- **Gate activity event**: the projection of a gate lifecycle change into the existing activity
  feed.

## Domain Model _(mandatory)_

**Bounded context:** Remote-control Gates — the public, versioned `/api/v1` contract for raising and
resolving blocking points. Consumed identically by the CLI (producer/consumer agent side) and the
Cloud backend (store/serve side); the document is the only coupling.

**Vocabulary (Ubiquitous language):**

- **Gate** — a blocking point an agent raises to get a human decision without halting the run.
- **Open** — the act of raising a gate; also the initial state.
- **Resolve** — a human submitting the answer/approval that moves a gate to `answered`.
- **Apply** — the agent consuming a resolved answer and continuing; moves a gate to `applied`.
- **Gate type** — which kind of decision is needed (one of five).
- **Payload** — the question plus the spec/plan context a human needs to answer well.
- **Answer** — the typed response; its shape is dictated by the gate type.
- **Activity feed** — the existing `GET /api/v1/activity` poll/reconcile stream (#354) gates project
  into.
- **Public wire format** — the documented, versioned request/response contract; the only thing
  crossing between the OSS CLI and the proprietary Cloud half.

**Entities (have identity):**

- **Gate** [aggregate root] — identity = `id`. Holds `projectKey`, optional `taskNumber`, `type`,
  `title`, `payload`, `state`, optional `answer`, `createdBy`, optional `resolvedBy`, `createdAt`,
  optional `resolvedAt`. Owns its lifecycle; only it transitions state.

**Value objects (no identity, immutable):**

- **GateType(`clarification`|`plan_approval`|`merge_approval`|`agent_unblock`|`decision`)** — closed
  set.
- **GateState(`open`|`answered`|`applied`)** — closed set; transitions only forward.
- **Answer(typed-by-GateType)** — the response shape; valid only for its gate's type.
- **GateId(string)** — opaque, stable, globally unique within the contract.

**Invariants (rules the domain must never break):**

- State advances only `open → answered → applied`; never backwards, never skipping.
- `answer`, `resolvedBy`, `resolvedAt` are absent while `open`, and present from `answered` onward.
- Resolution is single-shot: only an `open` gate is resolvable.
- An answer's shape MUST match its gate's `type`.
- Only the public wire format crosses the boundary — no private-half identifier appears
  (constitution § I).
- Gate `id`s and lists are project-scoped; no cross-project disclosure.

**Out of scope (other bounded contexts touched but not owned here):**

- **Cloud gate backend (#17)** — stores gates, enforces RBAC, emits activity events; implements this
  contract, owns none of it here.
- **Push delivery (#18)** — notifies the human's device a gate is waiting; consumes the contract.
- **CLI gate client (#357+)** — opens/polls/applies gates from the agent side; consumes the
  contract.
- **Activity feed (#354)** — owns the feed transport; this contract only specifies the gate events
  it carries.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Two independent implementers (CLI + Cloud) can each implement open / list / resolve
  from the document alone, with **0** clarifying questions about field shape, required-ness, or
  state transitions.
- **SC-002**: A gate round-trips through the documented lifecycle (open → answered → applied) with
  the field-presence rules holding at every state in a conformance check — **100%** of states valid.
- **SC-003**: **100%** of the contract's responses (success and error) are specified as public
  codes/shapes; **0** implementation-defined or undocumented responses.
- **SC-004**: Gate list + activity pagination use the identical opaque-cursor semantics as the
  existing activity feed — **0** new pagination models introduced.
- **SC-005**: A boundary check over the contract document finds **0** Cloud-internal identifiers,
  table/function names, or error strings.

## Assumptions

- The activity feed (`GET /api/v1/activity`, #354) is the transport gates surface through; this
  contract extends its event vocabulary rather than introducing a second feed.
- Pagination follows #354's opaque, collision-safe cursor (the issue's `since=` is superseded by the
  opaque `cursor=` for the same no-miss reason that drove the #354 design).
- The five gate types are sufficient for the remote-control loop's first iteration; new types are an
  additive, forward-compatible change under FR-011.
- Auth uses the same bearer model as the rest of `/api/v1`; exact resolve-permission thresholds are
  the backend's concern (#17), referenced abstractly here.

## Dependencies

- **#354 (`GET /api/v1/activity`)** — shipped. This contract extends its feed + reuses its
  opaque-cursor pagination.
- **Boundary (constitution § I)** — the only bridge between the OSS CLI and the proprietary Cloud
  half is this versioned public wire format.
- **Downstream (blocked on this):** Cloud gate backend (#17), push delivery (#18), CLI gate client
  and gate-aware phases (#357–#359), mobile gate inbox.
