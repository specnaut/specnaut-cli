# Feature Spec: `specnaut login` + `cloud orgs` / `cloud board`

**Issue**: specnaut-cli#398 (child of epic specnaut-monorepo#14 — `specnaut login`) **Status**:
draft → implementing **Half**: CLI (`apps/specnaut-cli`, public OSS)

## Summary

The CLI already has the full Specnaut Cloud auth foundation (`specnaut cloud
login/token/logout`:
device-auth browser flow, OS-keychain credential storage, transparent refresh, interactive project
selection). This feature adds the last ergonomic pieces of the `specnaut login` epic:

1. **`specnaut login`** — a top-level alias for `specnaut cloud login` (the verb users reach for
   first, à la `gh auth login`).
2. **`specnaut cloud orgs`** — list the organizations the authenticated account belongs to, flagging
   the active one.
3. **`specnaut cloud board`** — show the linked project's board: tasks grouped by column.

All three consume only the versioned `/api/v1` HTTP contract (the sole OSS↔Cloud coupling): `orgs`
calls the new `GET /api/v1/orgs` (cloud#145); `board` calls the existing
`GET /api/v1/columns?projectKey=` + `GET /api/v1/tasks?projectKey=`.

## User Scenarios & Testing

- **Login alias**: `specnaut login` behaves identically to `specnaut cloud login` (same device flow,
  same project binding).
- **Orgs**: an authenticated user runs `specnaut cloud orgs` and sees each org they belong to with
  its role; the active org is marked.
- **Board**: in a project linked via `backlog-config.yml`, `specnaut cloud board` prints the columns
  in order, each with its tasks (`#number title [priority
  size]`).
- **Not authenticated**: `orgs`/`board` print a clear "run `specnaut login`" hint and exit non-zero
  — never a stack trace, never a leaked token.
- **No project linked**: `board` explains there's no linked project and exits non-zero.

## Functional Requirements

- **FR1** — `specnaut login [--api-url <url>]` parses to the same intent as `specnaut cloud login`
  and runs the identical handler.
- **FR2** — `specnaut cloud orgs` resolves the deployment URL + a fresh access token (no prompt),
  calls `GET /api/v1/orgs`, and renders the list; empty list → a friendly "No organizations."
  message, exit 0.
- **FR3** — `specnaut cloud board` requires a linked `projectKey` (from `backlog-config.yml`); it
  fetches columns + tasks concurrently and renders the board grouped by column, columns sorted by
  `order`.
- **FR4** — Both read commands share one auth path (`authedSession`): missing URL or missing/expired
  credentials → guidance + non-zero exit, no token leak.

## Success Criteria

- `specnaut login` works as a drop-in for `specnaut cloud login`.
- A user can list their orgs and view a project board without leaving the terminal, in one command
  each.
- New commands appear in `--help`.

## Security (epic #14 focus)

- **Token never leaks**: the bearer access token travels only in the `Authorization` header (shared
  `getJson` helper); it is never logged, printed, or placed in a URL/querystring, and never appears
  in error messages (those carry only the server's error body).
- **URL safety**: the deployment URL flows through the existing `normalizeApiUrl()` (rejects
  non-`http(s)` schemes) — same guard as the pre-existing auth commands; no new SSRF surface.
- **Query-injection safe**: `projectKey` is `encodeURIComponent`-escaped before it reaches the
  `?projectKey=` querystrings.
- **Terminal-escape hardening**: server-provided display strings (org name/slug, column name, task
  title) are stripped of control / non-printable characters before printing, so a hostile or
  misconfigured API can't inject ANSI/OSC escape sequences into the user's console
  (`cloud_client.ts:cleanText`).
- **Boundary**: no private-half identifier, type, or secret enters the public CLI — only the
  documented `/api/v1` wire shapes (`CloudOrg`, `CloudColumn`, `CloudTask`). The frozen
  `specflow-cli` OAuth client id is a contract string, intentionally unchanged.

## Domain Model

- **Bounded context**: the CLI's Specnaut Cloud client + command surface.
- **Ubiquitous language**: _session_ = a resolved (apiUrl, fresh access token) pair; _active org_ =
  the org the token is bound to; _linked project_ = the `projectKey` in `backlog-config.yml`.
- **Value objects**: `CloudOrg { slug, name, role, isActive }`, `CloudColumn { id, name, order }`,
  `CloudTask { number, title, columnId, priority, size }`.
- **Invariants**: read commands never run without a valid token; the token is never emitted to
  stdout/stderr; rendered server text contains no control characters.
- **Out of scope**: mutating the board from the CLI; switching the active org over the API; a
  machine-readable `--json` output mode (the CLI has none today; a follow-up if scripts need it).

## Notes

Known follow-up (pre-existing, not introduced here; flagged by the security review): a malicious
`backlog-config.yml` can redirect the bearer token to an attacker `https://` host — the same surface
as the existing `login`/`token` commands. Hardening (e.g. warn when the configured URL changes from
the last authenticated one) is a separate backlog item.
