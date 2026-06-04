# Specflow Cloud API — Gates (`/api/v1`)

> **Status:** versioned public contract (`v1`). This document is the single source of truth for the
> **gate** wire format. Both the Specflow CLI and the Specflow Cloud backend implement exactly what
> is written here. Issue: #356.

A **gate** is a remotely-resolvable blocking point. When a headless agent can't proceed without a
human decision — a spec clarification, a plan or merge approval, an unblock, or a choice — it
**opens** a gate instead of halting. A human **resolves** it later from anywhere (e.g. a phone); the
answer flows back and the agent **applies** it and continues. A gate the agent no longer needs can
be **cancelled**.

This contract extends the existing [`GET /api/v1/activity`](#activity-feed-events) poll/reconcile
feed (#354): gate lifecycle changes appear there as events, so an agent learns "a gate you opened
was answered" over the channel it already drains.

## Versioning & compatibility

- All endpoints are under `/api/v1`. Changes within `v1` are **additive and forward-compatible
  only** — new fields, new gate types, new event kinds.
- **Consumers MUST ignore unknown fields** and unknown enum values they don't recognise (treat an
  unknown `type`/`kind` as opaque, don't error).
- A breaking change requires a new API version.

## Authentication

Every endpoint requires a bearer token (`Authorization: Bearer <token>`), the same scheme as the
rest of `/api/v1`. Opening, applying, and cancelling are agent actions; resolving is a human action
and is **permissioned** — only a suitably-authorized member of the gate's project may resolve it.
Exact role thresholds are defined by the backend (see #17), not by this contract.

## Gate object

```jsonc
{
  "id": "gate_7Kf3Qx9", // opaque, stable, globally unique, project-scoped
  "projectKey": "CLOUD", // the project the gate belongs to
  "taskNumber": 42, // optional — present ⇒ task-scoped; absent ⇒ project-scoped
  "type": "clarification", // see "Gate types"
  "title": "Which auth model for the CLI?", // short human-readable summary
  "payload": {/* type-specific, see "Gate types" */},
  "state": "open", // open | answered | applied | cancelled
  "answer": null, // type-specific; null until answered
  "createdBy": "agent:specflow-cli", // opaque actor handle
  "resolvedBy": null, // actor who answered; null until answered
  "createdAt": "2026-06-04T10:00:00Z", // RFC 3339 / ISO 8601 UTC
  "resolvedAt": null // when answered; null until then
}
```

| Field        | Type           | Required                | Notes                                                        |
| ------------ | -------------- | ----------------------- | ------------------------------------------------------------ |
| `id`         | string         | always                  | Opaque, stable, project-scoped.                              |
| `projectKey` | string         | always                  | The project's short key.                                     |
| `taskNumber` | number         | optional                | Present ⇒ the gate is about a specific task.                 |
| `type`       | enum           | always                  | One of the five gate types.                                  |
| `title`      | string         | always                  | One-line summary for a list view.                            |
| `payload`    | object         | always                  | Shape determined by `type` (below).                          |
| `state`      | enum           | always                  | `open` \| `answered` \| `applied` \| `cancelled`.            |
| `answer`     | object \| null | when `state ≥ answered` | Shape determined by `type`. `null` while `open`/`cancelled`. |
| `createdBy`  | string         | always                  | Opaque actor handle of the opener.                           |
| `resolvedBy` | string \| null | when `state ≥ answered` | Opaque actor handle of the resolver.                         |
| `createdAt`  | string         | always                  | RFC 3339 UTC timestamp.                                      |
| `resolvedAt` | string \| null | when `state ≥ answered` | RFC 3339 UTC timestamp.                                      |

## Gate types

Five types. Each fixes the shape of `payload` (what the human reads) and `answer` (what they
submit). The resolve endpoint **validates** that the submitted answer matches the gate's type — a
mismatch is `422` (see [Errors](#error-responses)).

| `type`           | `payload`                                                                                        | `answer`                                                |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `clarification`  | `{ "question": string, "context"?: string }`                                                     | `{ "text": string }`                                    |
| `decision`       | `{ "question": string, "options": [{ "id": string, "label": string, "description"?: string }] }` | `{ "choiceId": string }` — MUST match an `options[].id` |
| `plan_approval`  | `{ "summary": string, "planRef"?: string, "context"?: string }`                                  | `{ "approved": boolean, "note"?: string }`              |
| `merge_approval` | `{ "summary": string, "prUrl"?: string, "context"?: string }`                                    | `{ "approved": boolean, "note"?: string }`              |
| `agent_unblock`  | `{ "reason": string, "context"?: string }`                                                       | `{ "acknowledged": true, "note"?: string }`             |

## State machine

```
           resolve (human)        apply (agent)
  open ───────────────────▶ answered ───────────────▶ applied   (terminal)
    │
    │ cancel (opener)
    ▼
cancelled   (terminal)
```

| Transition           | Endpoint                   | Actor                | Notes                                                              |
| -------------------- | -------------------------- | -------------------- | ------------------------------------------------------------------ |
| `open → answered`    | `POST /gates/{id}/resolve` | human (permissioned) | Single-shot. Sets `answer`, `resolvedBy`, `resolvedAt`.            |
| `answered → applied` | `POST /gates/{id}/apply`   | agent                | **Idempotent** — re-applying an `applied` gate is a success no-op. |
| `open → cancelled`   | `POST /gates/{id}/cancel`  | opener (agent)       | Withdraws a gate that's no longer needed.                          |

`applied` and `cancelled` are **terminal**. Any transition not listed above is illegal and returns
`409 conflict` (e.g. resolving an `answered` gate, applying an `open` gate, cancelling an `answered`
gate).

## Endpoints

Base: `https://<deployment>/api/v1`

### `POST /api/v1/gates` — open a gate

Request:

```jsonc
{
  "projectKey": "CLOUD",
  "type": "clarification",
  "title": "Which auth model for the CLI?",
  "payload": { "question": "Device flow or pasted token?", "context": "spec 003 FR-003" },
  "taskNumber": 42 // optional
}
```

Response `201`:

```jsonc
{ "gate": {/* the full gate object, state: "open" */} }
```

Errors: `422` invalid type / payload shape · `404` unknown project · `401`.

### `GET /api/v1/gates?projectKey=&cursor=&state=` — list gates

Cursor-paginated, **identical opaque-cursor semantics to `GET /api/v1/activity`** (opaque,
collision-safe; pass the previous response's `cursor` to continue). `state` is an optional filter
(e.g. `state=open` for a human's inbox).

Response `200`:

```jsonc
{
  "gates": [/* gate objects, oldest-first */],
  "cursor": "opaque-string", // pass back as ?cursor= for the next page
  "hasMore": false
}
```

Errors: `404` unknown project · `401`.

### `POST /api/v1/gates/{id}/resolve` — submit an answer (human)

Request: a typed `answer` matching the gate's type.

```jsonc
{ "answer": { "text": "Use the device flow." } }
```

Response `200`: `{ "gate": { /* state: "answered", answer/resolvedBy/resolvedAt set */ } }`

Errors: `422` answer shape doesn't match the gate's type · `409` gate not `open` (already
resolved/applied/cancelled) · `404` unknown gate / wrong project · `401`.

### `POST /api/v1/gates/{id}/apply` — acknowledge consumption (agent)

No body required. Moves `answered → applied`. **Idempotent.**

Response `200`: `{ "gate": { /* state: "applied" */ } }`

Errors: `409` gate not `answered` (and not already `applied`) · `404` · `401`.

### `POST /api/v1/gates/{id}/cancel` — withdraw a gate (opener)

No body required. Moves `open → cancelled`.

Response `200`: `{ "gate": { /* state: "cancelled" */ } }`

Errors: `409` gate not `open` · `404` · `401`.

## Activity feed events

Gate lifecycle changes surface in
[`GET /api/v1/activity`](../../templates/core/skills/backlog/SKILL.md) as events, sharing that
feed's ordering and opaque-cursor pagination (no separate poller). One kind per transition:

```jsonc
{ "kind": "gate_opened",    "gateId": "gate_7Kf3Qx9", "gateType": "clarification", "state": "open",      "taskNumber": 42, "ts": "2026-06-04T10:00:00Z" }
{ "kind": "gate_answered",  "gateId": "gate_7Kf3Qx9", "gateType": "clarification", "state": "answered",  "taskNumber": 42, "ts": "…" }
{ "kind": "gate_applied",   "gateId": "gate_7Kf3Qx9", "gateType": "clarification", "state": "applied",   "taskNumber": 42, "ts": "…" }
{ "kind": "gate_cancelled", "gateId": "gate_7Kf3Qx9", "gateType": "clarification", "state": "cancelled", "taskNumber": 42, "ts": "…" }
```

`taskNumber` is present only for task-scoped gates. Consumers MUST ignore event `kind`s they don't
recognise.

## Error responses

All errors are JSON with a stable, public shape — never an internal identifier, table, function, or
error string (constitution § I).

```jsonc
{ "error": "<stable public message>" }
```

| Status | When                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------- |
| `401`  | Missing / invalid / expired bearer token.                                                       |
| `404`  | Unknown gate id, or the gate/project isn't visible to the caller (no cross-project disclosure). |
| `409`  | Illegal state transition (resolve non-`open`, apply non-`answered`, cancel non-`open`).         |
| `422`  | Unknown gate `type`, or an `answer`/`payload` whose shape doesn't match the type.               |

## Boundary (constitution § I)

This document is the **only** coupling between the public OSS CLI (`mkrlabs/specflow`) and the
proprietary Cloud half. It exposes only the versioned public wire format. No Cloud-internal
identifier, table, function, or error string appears here, and both halves implement it without
either half's internals crossing the line.
