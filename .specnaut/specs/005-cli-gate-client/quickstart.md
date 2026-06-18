# Quickstart: CLI remote mode + gate client

## Unit (no network) — the primary verification

The client injects `FetchFn`, `now()`, and `sleep()`, so the whole open→await→apply loop runs
against a stub with a fake clock:

```ts
// pseudo — see tests/gate_session_test.ts
const fetchStub = scriptedFetch([
  { match: "POST /api/v1/gates", reply: 201, body: { gate: openGate } },
  {
    match: "GET  /api/v1/gates",
    reply: 200,
    body: { gates: [openGate], cursor: "c1", hasMore: false },
  },
  {
    match: "GET  /api/v1/gates",
    reply: 200,
    body: { gates: [answeredGate], cursor: "c2", hasMore: false },
  },
  { match: "POST /api/v1/gates/ID/apply", reply: 200, body: { gate: appliedGate } },
]);
const session = makeGateSession({ apiUrl, fetchFn: fetchStub, token: () => "tok", now, sleep });

const out = await session.raiseAndAwait({
  projectKey: "CLOUD",
  type: "clarification",
  title: "Which auth model?",
  payload: { question: "Device flow or token?" },
});
// out.kind === "answered"; out.answer.text === "Use the device flow."
const done = await session.apply(out.gate);
// done.kind === "answered" (now applied) — re-calling apply() is a success no-op
```

Cases the unit suite covers (maps to SC-001…SC-007):

- open → poll-until-answered → return typed answer (no TTY).
- apply idempotency: apply twice, second is success no-op.
- await timeout: clock advances past `awaitTimeoutMs` with no resolution → `{ kind: "unresolved" }`.
- transient 5xx/network during poll → backs off and keeps awaiting (does not abort).
- token refresh mid-await: stub returns 401 once, refresh path issues a new token, await continues.
- remote-mode off → no fetch calls happen; on-but-no-creds →
  `{ kind: "error", reason: "no_remote" }`.
- § I: assert no request body / stored value contains a Convex/internal identifier; only wire
  fields.

```bash
deno task test            # full suite incl. gate_client / gate_session / remote_mode
deno task check && deno lint && deno fmt --check
```

## Live smoke (optional) — against the Cloud dev deployment

With a logged-in project (`specflow cloud login`) and remote mode enabled:

```bash
export SPECFLOW_REMOTE=1
# 1. open a clarification gate, then resolve it from another device (phone/web)
# 2. the awaiting CLI observes `answered`, prints the answer, applies → `applied`
# 3. confirm on /api/v1/activity that gate_opened → gate_answered → gate_applied appear in order
```

The live path is identical to the unit path with the stub swapped for the real deployment; the
backend (#17) was already smoke-validated end-to-end.
