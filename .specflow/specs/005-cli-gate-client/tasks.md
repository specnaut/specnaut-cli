# Tasks: CLI remote mode + gate client

**Feature**: `005-cli-gate-client` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Repo**: `apps/specflow` (`mkrlabs/specflow`, issue #357)

Ordering is dependency-driven. `[P]` = parallelizable with siblings (different files, no shared
state). `deno task check && deno lint && deno fmt --check && deno task test` is the standing gate
after every code task.

## Phase A — Contract types & config (foundation)

- [x] **T001** `[P]` `src/domain/cloud/gate_contract.ts` (NEW): `GateType`, `GateState`, `Gate`,
      `GateRequest` types; `parseGate(json)` defensive projection (null on malformed, never throws);
      `isGateType`/`isGateState` guards (branch only, never reject unknowns); local
      `validatePayload(type, payload)` fast-fail. Only public wire fields. (FR-001, FR-008)
- [x] **T002** `[P]` `src/domain/cloud/remote_mode.ts` (NEW): `RemoteMode` +
      `resolveRemoteMode(config,
      env)` with precedence `SPECFLOW_REMOTE` → `remote.enabled` →
      off; parse await/poll knobs with defaults. Pure (env injected). (FR-009, D3)
- [x] **T003** `src/domain/cloud/cloud_config.ts` (EXTEND): add optional `remote` block to
      `CloudConfig` (`enabled`, `await_timeout_s?`, `poll_interval_s?`); read it in
      `readCloudConfig` (absent ⇒ undefined, backward compatible); extend `renderCloudConfig` to
      emit a commented, default-off `remote:` stanza. (FR-009, FR-010)

## Phase B — Gate HTTP client (`gate_client.ts`, NEW)

Depends on A. Sibling of `CloudClient`; injected `FetchFn`; `{base}/api/v1` +
`Authorization: Bearer`.

- [x] **T004** `open(token, req)` → `POST /api/v1/gates`; 201 → `parseGate(json.gate)`; map
      422/404/401 → typed `GateApiError(status)`; never surface backend message text. (FR-001,
      FR-007)
- [x] **T005** `get(token, projectKey, id)` via `GET /api/v1/gates?projectKey=&state=` (opaque
      cursor if paging) returning the matching gate or null; the await loop's resolution probe.
      (FR-002, FR-013, D1, D2)
- [x] **T006** `apply(token, id)` → `POST /api/v1/gates/{id}/apply`; treat 200 and "already applied"
      409 as success (idempotent); other 409 → conflict. (FR-004, D6)
- [x] **T007** `cancel(token, id)` → `POST /api/v1/gates/{id}/cancel`; 200 → cancelled; non-`open`
      409 → conflict outcome (no retry). (FR-005, D6)
- [x] **T008** Shared status→`GateErrorReason` mapper (`401→unauthorized`, `404→not_found`,
      `409→conflict`, `422→invalid`, network/5xx→`transient`); no backend string leaks (§ I).
      (FR-007, FR-008)

## Phase C — Gate session orchestration (`gate_session.ts`, NEW)

Depends on B + `auth_flow.freshAccessToken`. Injects `now()`, `sleep()`, token provider.

- [x] **T009** `raiseAndAwait(req)`: resolve remote mode; if disabled → caller handles locally; if
      enabled-but-no-creds → `{error, no_remote}`; else open, then poll `get` at `pollIntervalMs`
      until `answered` (→ `{answered, gate, answer}`), `cancelled` (→ `{cancelled}`), or
      `awaitTimeoutMs` elapses (→ `{unresolved}`). (FR-002, FR-003, FR-011, D4)
- [x] **T010** Transient tolerance + transparent refresh inside the await loop: network/5xx →
      additive capped backoff, keep awaiting until overall timeout; 401 → `freshAccessToken` refresh
      then continue; unrecoverable auth → `{error, unauthorized}`. (FR-006, SC-007, D4, D5)
- [x] **T011** `apply(gate)` and `cancel(id)` session wrappers returning `ResolutionOutcome`;
      idempotent apply surfaced as success. (FR-004, FR-005)
- [x] **T012** A small factory (`makeGateSession(deps)`) wiring config → remote mode → client →
      session so a phase constructs it in one call (composability, FR-012). No phase wiring here.

## Phase D — Tests (no network)

- [x] **T013** `[P]` `tests/gate_client_test.ts`: scripted `FetchFn` for open/get/apply/cancel incl.
      201/200/404/409/422/network; assert idempotent apply, conflict mapping, and **no internal
      identifier in any request body** (§ I). (SC-002, SC-006)
- [x] **T014** `[P]` `tests/gate_session_test.ts`: fake clock — open→poll→answered→apply; apply
      twice (no-op); timeout→`unresolved`; transient 5xx keeps awaiting; 401 mid-await refreshes and
      continues; no-creds→`no_remote`. (SC-001, SC-002, SC-003, SC-005, SC-007)
- [x] **T015** `[P]` `tests/remote_mode_test.ts`: precedence env>config>off; default off ⇒ no fetch;
      knob parsing/defaults. (SC-004)

## Phase E — Validation & review

- [x] **T016** `deno task check && deno lint && deno fmt --check && deno task test` — all green.
- [x] **T017** Boundary review (§ I): grep the new files + tests for any Convex/internal identifier,
      table, function, or backend error string; confirm only `docs/api/gates.md` wire fields cross.
      Update `docs/api/gates.md`'s consumer note / `README` if a client-usage pointer is warranted;
      mark #357 row done in the epic tracker if present.

## Dependencies

```
A (T001–T003) → B (T004–T008) → C (T009–T012) → D (T013–T015) → E (T016–T017)
```

T001/T002 are `[P]`. Within D, T013/T014/T015 are `[P]` (separate files). T003 extends an existing
file so it serializes with any other edit to `cloud_config.ts`.
