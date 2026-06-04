# Data Model: CLI remote mode + gate client

Client-side types only (the agent's read view of the contract). The Cloud backend owns persistence;
nothing here is a database. All shapes derive from `docs/api/gates.md` (#356).

## Wire types (`gate_contract.ts`, pure)

```ts
export type GateType =
  | "clarification"
  | "decision"
  | "plan_approval"
  | "merge_approval"
  | "agent_unblock";

export type GateState = "open" | "answered" | "applied" | "cancelled";

// The agent's read view of a gate object. Mirrors the contract; unknown fields ignored.
export type Gate = {
  id: string;
  projectKey: string;
  taskNumber?: number;
  type: GateType | string; // tolerate unknown future types (FR-008)
  title: string;
  payload: Record<string, unknown>;
  state: GateState | string; // tolerate unknown future states
  answer: Record<string, unknown> | null;
  createdBy: string;
  resolvedBy: string | null;
  createdAt: string; // RFC 3339
  resolvedAt: string | null;
};
```

- `parseGate(json): Gate | null` — defensive projection; returns null on a structurally-invalid body
  (never throws into the await loop).
- Type guards `isGateType`, `isGateState` used only to branch behaviour, never to reject unknowns.

## Open request (`GateRequest`, value object)

```ts
export type GateRequest = {
  projectKey: string;
  type: GateType;
  title: string;
  payload: Record<string, unknown>; // shape-validated against `type` before the call
  taskNumber?: number;
};
```

Local pre-validation rejects an obviously-wrong payload before the network call (clarification needs
`question`, decision needs `options[]`, etc.) so a misuse fails fast with a CLI error rather than a
round-trip 422 — but the backend remains the authority.

## Resolution outcome (value object)

```ts
export type ResolutionOutcome =
  | { kind: "answered"; gate: Gate; answer: Record<string, unknown> }
  | { kind: "unresolved" } // await timeout (FR-003)
  | { kind: "cancelled"; gate: Gate } // observed cancelled while awaiting
  | { kind: "error"; reason: GateErrorReason };

export type GateErrorReason =
  | "unauthorized" // 401 — needs `specflow cloud login`
  | "not_found" // 404
  | "conflict" // 409 — illegal transition
  | "invalid" // 422 — bad type/payload/answer
  | "no_remote" // remote mode prerequisites unmet (no link / no creds)
  | "transient"; // exhausted retries (network/5xx) before resolution
```

## Remote-mode setting (value object)

```ts
export type RemoteMode = {
  enabled: boolean;
  awaitTimeoutMs: number; // resolved from config or default
  pollIntervalMs: number; // resolved from config or default
};
```

Resolution precedence (D3): `SPECFLOW_REMOTE` env → `remote.enabled` in `backlog-config.yml` →
default off.

## Client + session interfaces

```ts
// HTTP verbs — sibling of CloudClient. All IO via injected FetchFn.
export interface GateClient {
  open(token: string, req: GateRequest): Promise<Gate>;
  get(token: string, projectKey: string, id: string): Promise<Gate | null>;
  apply(token: string, id: string): Promise<Gate>; // idempotent (D6)
  cancel(token: string, id: string): Promise<Gate>;
}

// Orchestration — open → await → apply, plus cancel. Injects clock + sleep + token provider.
export interface GateSession {
  raiseAndAwait(req: GateRequest): Promise<ResolutionOutcome>; // open, poll until answered, return
  apply(gate: Gate): Promise<ResolutionOutcome>; // ack consumption (→ applied)
  cancel(id: string): Promise<ResolutionOutcome>;
}
```

`raiseAndAwait` is the composable primitive phases use (FR-012): it returns the typed answer or a
terminal outcome; the calling phase decides what to do with the answer (#5/#6) and whether to
`apply`.

## State machine (client's view)

```
open ──await(poll until)──▶ answered ──apply()──▶ applied   (terminal)
  │
  └── cancel() ──▶ cancelled   (terminal)
```

Invariants: the CLI performs open/await/apply/cancel — never resolve; await always terminates
(answered | unresolved | cancelled | error); apply is idempotent; only public wire fields cross (§
I).
