# Research: CLI remote mode + gate client

Decisions resolving the plan's Technical Context. Format: Decision / Rationale / Alternatives.

## D1 — Resolution-detection mechanism: poll the gate's state via list/get

**Decision**: The await loop detects resolution by polling the gate's own state —
`GET
/api/v1/gates?projectKey=&state=` (or a single-gate read) — and treating `state === "answered"`
as the trigger. The shared `/api/v1/activity` cursor feed is recognized as an available signal but
is **not required** for this client to function.

**Rationale**: The gate object is the authoritative source of `state` + `answer`; polling it needs
no cursor bookkeeping and is trivially correct for a single awaited gate. The contract guarantees
opaque-cursor list semantics identical to the activity feed, so we can page if needed, but for
"await this one gate" a direct state check is simpler and has no missed-event window. The activity
feed is the right channel for "learn about _any_ gate change" (a future inbox/daemon), not for
blocking on one known id.

**Alternatives**: (a) Drain the activity feed cursor and watch for `gate_answered` — couples the
await to cursor persistence and to events that may interleave with task transitions; deferred to a
future multi-gate watcher. (b) Server push / long-poll — not in the contract; that's #18.

## D2 — Original issue `?since=cursor` vs the frozen contract

**Decision**: Follow `docs/api/gates.md` (#356): **opaque-cursor** pagination (`?cursor=`), not a
`since=` timestamp. The issue body predates the frozen contract.

**Rationale**: The contract is the single source of truth and the backend (#17) + activity feed
(#354) already implement opaque cursors. Consistency across the three trumps stale issue text.
Documented in spec Assumptions.

**Alternatives**: Honour `?since=` — rejected; would diverge from the implemented backend.

## D3 — Remote-mode resolution precedence

**Decision**: Resolve the switch as `SPECFLOW_REMOTE` env override → `remote.enabled` in
`backlog-config.yml` → default **off**. The env value parses truthy (`1`/`true`/`on`) / falsy; unset
means "defer to config". This mirrors the existing `SPECFLOW_CLOUD_TOKEN` headless escape hatch.

**Rationale**: Headless/CI must flip remote mode without editing tracked files; an env override on
top of file config is the established CLI idiom. Default-off guarantees zero regression (FR-010).

**Alternatives**: Config-only (no env) — fails the headless/CI requirement. Env-only — not
discoverable/persistent for a project. CLI flag — phases, not the user, drive gates; a flag would
have to be threaded through every phase.

## D4 — Await timeout + backoff policy

**Decision**: The await loop polls at a base interval (default ~5s), bounded by a configurable
overall timeout (default generous, e.g. 30 min) after which it returns a distinct `unresolved`
outcome. Transient errors (network, 5xx) don't end the loop; they back off (additive, capped) and
retry until the overall timeout. Interval/timeout are injectable for tests (fake clock).

**Rationale**: A headless agent may legitimately wait a long time for a human on a phone, so the
timeout is generous but always finite (FR-003 / SC-003). Backoff on transient failure keeps a flaky
link from aborting a valid wait while still bounding total work. Injected clock keeps tests instant.

**Alternatives**: Infinite wait — violates SC-003. Fixed retry count with no overall timeout — two
knobs where one suffices; the overall timeout is the user-meaningful bound.

## D5 — Error → typed outcome mapping (no string leakage)

**Decision**: Map HTTP status → typed CLI outcome: `422 → invalid`, `409 → conflict`,
`404 →
not_found`, `401 → unauthorized`, network/5xx → `transient` (retryable inside await). The
client never surfaces the backend's `error` string verbatim to logs/state — it emits its own
CLI-owned message keyed off the status.

**Rationale**: § I forbids leaking any backend-authored string; status codes are public contract
surface, messages are not. Typed outcomes let callers (phases) branch deterministically. Reuses the
spirit of `CloudApiError` (status-carrying) already in `cloud_client.ts`.

**Alternatives**: Re-throw `CloudApiError` with the server message — risks § I leakage and forces
callers to string-match. Rejected.

## D6 — Idempotent apply + cancel conflict handling

**Decision**: `apply` treats both `200 applied` and a `409` that indicates the gate is already
`applied` as **success** (idempotent, per contract). `cancel` on a non-`open` gate returns a
`conflict` outcome the caller handles; the client does not retry a conflict. Apply's retryability is
limited to transient (network/5xx) failures.

**Rationale**: The contract declares apply idempotent and apply/cancel conflicts as `409`. To make
"open→await→apply" crash-safe (SC-002), a re-apply after an uncertain network result must succeed.
Distinguishing "already applied" (success) from "not answered yet" (real conflict) follows the
contract's stated apply semantics.

**Alternatives**: Treat every 409 as failure — breaks idempotent resumption. Blindly retry cancel —
could mask a genuine state error. Rejected.

## Config surface (summary)

`backlog-config.yml` gains an optional block (absent ⇒ off, fully backward compatible):

```yaml
remote:
  enabled: false # raise decisions as remote gates instead of local prompts
  await_timeout_s: 1800 # optional; overall await bound
  poll_interval_s: 5 # optional; base poll cadence
```

Env override: `SPECFLOW_REMOTE=1|true|on` forces enabled; `0|false|off` forces disabled; unset =
defer to config.
