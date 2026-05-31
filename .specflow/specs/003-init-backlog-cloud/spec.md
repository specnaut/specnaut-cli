# Feature Specification: `specflow init --backlog cloud` backend

**Feature Branch**: `003-init-backlog-cloud`\
**Created**: 2026-05-31\
**Status**: Draft\
**Input**: User description: "feat(init): add `--backlog cloud` backend (Specflow Cloud) — make
Specflow Cloud a first-class backlog backend in `specflow init`. The init flow authenticates the
user against Specflow Cloud, lets them select or create a Cloud project, stores credentials
securely, records `backend: cloud` in the project config, and routes all subsequent backlog
operations through the public Cloud HTTP API instead of `gh`. Strictly bounded to the documented,
versioned public wire format — no Cloud-internal terminology or identifiers in this repo." (issue
#353)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Connect a project to Specflow Cloud during init (Priority: P1)

A developer scaffolding a new project runs `specflow init` and, at the backlog-backend prompt
(today: local Markdown or GitHub), now sees a third option — **Specflow Cloud**. Choosing it (or
passing `--backlog cloud`) starts a guided flow: the CLI authenticates the user with Specflow Cloud,
lets them pick an existing Cloud project or create a new one, and writes a ready-to-use
`backlog-config.yml` with `backend: cloud`. When the flow finishes, the project's backlog is wired
to Cloud with no manual config editing required.

Today the `cloud` backend exists only as a placeholder: it writes an empty `backlog-config.yml` stub
(`api_url` / `api_token` / `project_key` all blank) and tells the user to paste values by hand. This
story replaces that manual stub with a real onboarding flow.

**Why this priority**: This is the feature. Without an authenticated, project-bound config at the
end of init, none of the downstream backlog commands can reach Cloud. It is the irreducible MVP — a
user who completes only this story already has a working Cloud-backed backlog.

**Independent Test**: Run `specflow init --backlog cloud` against a reachable Cloud deployment,
complete the auth + project-selection prompts, and confirm the resulting
`.specflow/backlog-config.yml` has `backend: cloud` plus a usable endpoint + project binding — and
that a follow-up `/backlog list` returns the board's items.

**Acceptance Scenarios**:

1. **Given** an interactive `specflow init`, **When** the user selects the Specflow Cloud backend,
   **Then** the CLI prompts them to authenticate and does not write a blank stub for manual editing.
2. **Given** a successful authentication, **When** the user has at least one Cloud project, **Then**
   the CLI lists their projects and lets them select one; **and When** they have none (or choose
   to), **Then** the CLI lets them create a new project inline.
3. **Given** a selected/created project, **When** init completes, **Then**
   `.specflow/backlog-config.yml` records `backend: cloud`, the public API base URL, and the project
   key — and contains no secret in plaintext (see User Story 3).
4. **Given** the user cancels or fails authentication, **When** the flow aborts, **Then** init exits
   with a clear, actionable message and leaves no half-written Cloud config behind.

---

### User Story 2 - All backlog commands transparently use the Cloud backend (Priority: P1)

After a project is initialised with `backend: cloud`, every backlog operation a developer or the
Product Owner agent runs — `/backlog add`, `move`, `list`, `view`, `clarify`, stage reconcile —
routes through the public Specflow Cloud HTTP API instead of GitHub's `gh`. The developer does
nothing special: the recorded backend selection makes the routing automatic and invisible.

**Why this priority**: The headline value of the Cloud backend is escaping GitHub's REST/GraphQL
rate limits under agent-driven workloads. That payoff only lands if, once connected, all backlog
traffic actually goes to Cloud. This story is what makes the connection from User Story 1 useful
day-to-day.

**Independent Test**: In a `backend: cloud` project, run `/backlog add` and `/backlog list`, then
confirm — via the Cloud board — that the item was created there and that no `gh` call was made.

**Acceptance Scenarios**:

1. **Given** a `backend: cloud` project, **When** any backlog command runs, **Then** it reads the
   recorded backend and dispatches to the Cloud API path, never the GitHub path.
2. **Given** the Cloud API returns a documented error code (e.g. unauthorized, not-found,
   rate-limited), **When** a backlog command surfaces it, **Then** the message references only the
   public response code/shape and no Cloud-internal terminology.
3. **Given** a project initialised before this feature with a hand-filled `cloud` stub, **When** it
   is re-run, **Then** the same commands work against the recorded config (backward compatible).

---

### User Story 3 - Credentials stored securely with transparent renewal (Priority: P2)

The Cloud access credential obtained at init is stored so that it is **not** committed to the repo
and **not** left in plaintext inside a tracked config file. When the credential approaches or
reaches expiry, the CLI renews it transparently so the user is not interrupted mid-task; only when
renewal is impossible does the CLI prompt the user to re-authenticate.

**Why this priority**: Security and unattended/agent-driven operation. A leaked token in a committed
config is a credential-disclosure incident, and an agent running headless cannot answer an "auth
expired" prompt — so silent renewal is what keeps long sessions and CI working. It is P2 because
User Stories 1–2 deliver a working backend first; hardening storage and renewal makes it safe and
durable.

**Independent Test**: Complete init, then inspect every tracked file and confirm the secret is
absent; simulate an expired credential and confirm the next backlog command renews and succeeds
without a prompt (or, if renewal is impossible, prompts to re-auth rather than failing opaquely).

**Acceptance Scenarios**:

1. **Given** a completed Cloud init, **When** the repository is inspected, **Then** the access
   secret appears in no version-controlled file.
2. **Given** a stored credential that has expired but is renewable, **When** the next backlog
   command runs, **Then** the CLI renews it transparently and the command succeeds.
3. **Given** a credential that cannot be renewed (revoked / hard-expired), **When** a backlog
   command runs, **Then** the CLI fails with a clear "re-authenticate with `specflow …`" message
   rather than a raw API error.

---

### User Story 4 - Non-interactive / CI initialisation (Priority: P3)

A pipeline or headless agent initialises a Cloud-backed project without interactive prompts by
supplying the credential and project up front (flag and/or environment variable). The flow validates
them and writes the same `backend: cloud` config, or fails fast with a precise reason.

**Why this priority**: Specflow is increasingly driven headless (`claude -p`, CI gates).
Interactive- only onboarding would block those flows. P3 because the interactive path proves the
feature first; the non-interactive path is a mechanical extension of it.

**Independent Test**: Run `specflow init --backlog cloud` in a non-interactive shell with the
credential and project supplied via the documented flag/env, and confirm a valid `backend: cloud`
config is produced with no prompt — and that a missing/invalid input fails fast with an actionable
message.

**Acceptance Scenarios**:

1. **Given** a non-interactive invocation with a valid credential + project reference, **When** init
   runs, **Then** it writes the `backend: cloud` config without prompting.
2. **Given** a non-interactive invocation missing a required input, **When** init runs, **Then** it
   exits non-zero with a message naming exactly what was missing.

---

### Edge Cases

- **Cloud unreachable / offline** during init → fail with an actionable network message; write no
  partial config.
- **No projects on the account** → offer inline creation rather than dead-ending.
- **Project key collision** when creating a new project → surface the public conflict response and
  let the user pick another key.
- **Re-running init** on a project that already has a `cloud` config → confirm before overwriting;
  never silently clobber a working credential binding.
- **Credential revoked mid-session** → the next command detects it and routes to the re-auth message
  (User Story 3, scenario 3), not an opaque 401 dump.
- **Cloud rate-limit / unavailability response** → degrade gracefully with the public code; the
  whole point of this backend is rate-limit relief, so its own error path must not look like the
  GitHub failure it replaces.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `specflow init` MUST offer Specflow Cloud as a selectable backlog backend in the
  interactive picker, alongside local Markdown and GitHub.
- **FR-002**: `specflow init --backlog cloud` MUST start a guided onboarding flow rather than
  writing a blank, manually-edited configuration stub.
- **FR-003**: The flow MUST authenticate the user against Specflow Cloud through an **interactive
  browser/device token-exchange** against the documented public authentication endpoint: the CLI
  opens a browser (or presents a device code), the user signs in on Cloud, and the CLI receives a
  short-lived access credential plus a renewable refresh credential. A pasted long-lived token is
  NOT the default path. (Resolved 2026-05-31.)
- **FR-004**: After authentication, the flow MUST let the user select an existing Cloud project from
  their accessible projects, or create a new one inline.
- **FR-005**: The flow MUST persist the obtained credential in the **OS-native secret store** (macOS
  Keychain / Linux libsecret / Windows Credential Manager) when one is available, falling back to a
  `0600`-permission file under the user's home directory (e.g. `~/.specflow/credentials`) on
  machines without one (CI / headless). The secret MUST stay out of every version-controlled file
  and out of plaintext in any tracked config. This establishes the Specflow credential-store pattern
  (none existed before). (Resolved 2026-05-31.)
- **FR-006**: On success, the flow MUST record `backend: cloud` plus the public API base URL and the
  selected project key in `.specflow/backlog-config.yml`, with no secret written in plaintext there.
- **FR-007**: After initialisation, every backlog operation (`add`, `move`, `list`, `view`,
  `clarify`, stage reconcile) MUST route through the public Specflow Cloud HTTP API and MUST NOT
  invoke the GitHub (`gh`) path.
- **FR-008**: All user-facing error messages on the Cloud path MUST reference only public API
  response codes/shapes — never Cloud-internal table names, function names, identifiers, or error
  strings.
- **FR-009**: The CLI MUST renew an expiring/expired-but-renewable credential transparently (using
  the refresh credential from FR-003) before a backlog command fails, and MUST fall back to an
  explicit re-authentication prompt only when renewal is impossible.
- **FR-010**: The flow MUST abort cleanly on cancellation, authentication failure, or an unreachable
  Cloud, leaving no half-written Cloud configuration and exiting with an actionable message.
- **FR-011**: The CLI MUST support a non-interactive initialisation path that accepts the credential
  and project reference via a documented flag and/or environment variable, producing the same
  `backend: cloud` config without prompts, or failing fast naming the missing input.
- **FR-012**: A project initialised before this feature (hand-filled `cloud` stub) MUST continue to
  work unchanged — backward compatibility with the existing `api_url` / `api_token` / `project_key`
  config shape.
- **FR-013**: The CLI MUST consume only the documented, versioned public wire format; it MUST NOT
  depend on any undocumented Cloud behaviour or internal contract.

### Key Entities _(see Domain Model section below for full structure)_

- **Backlog backend selection**: the recorded choice (`local` / `github` / `gitlab` / `cloud`) that
  determines how all backlog commands route.
- **Cloud project binding**: the association between this local project and one Specflow Cloud
  project (identified by its public project key).
- **Cloud credential**: the secret used to authorise public API calls, held in secure storage, not
  in tracked files.

## Domain Model _(mandatory)_

**Bounded context:** CLI Backlog Onboarding — the Specflow CLI's init/configuration surface for
choosing and wiring a backlog backend. The Cloud backend is consumed here strictly through the
public HTTP API contract.

**Vocabulary (Ubiquitous language):**

- **Backlog backend** — the system that stores this project's tasks; one of `local`, `github`,
  `gitlab`, `cloud`.
- **Specflow Cloud** — the hosted Kanban service, reached only via its versioned public HTTP API.
- **Cloud project** — a board on Specflow Cloud, identified to the CLI by its **project key**.
- **Project key** — the short, public, human-readable identifier of a Cloud project (e.g. `CLOUD`).
- **Credential** — the secret that authorises public API calls on the user's behalf.
- **Onboarding flow** — the interactive `init --backlog cloud` sequence: authenticate →
  choose/create project → persist config.
- **Public wire format** — the documented, versioned request/response contract; the only thing that
  crosses between this repo and Cloud.

**Entities (have identity):**

- **BacklogConfig** [aggregate root] — the persisted `.specflow/backlog-config.yml`; identity is the
  project it lives in. Owns the backend selection, API base URL, and project key. Never holds a
  plaintext secret.
- **CloudProjectBinding** — the link from this local project to one Cloud project; identity is the
  project key.
- **StoredCredential** — the secret in secure storage; identity is the (deployment, user) it
  authorises. Lives outside any tracked file.

**Value objects (no identity, immutable):**

- **BackendKind(`local`|`github`|`gitlab`|`cloud`)** — closed set; the picker and router agree on
  it.
- **ProjectKey(string)** — non-empty, public, collision-checked on create.
- **ApiBaseUrl(url)** — the public Cloud API base; well-formed absolute URL.

**Invariants (rules the domain must never break):**

- Exactly one backend is recorded per project; `cloud` selection always writes `backend: cloud`.
- No secret is ever written to a version-controlled or plaintext-tracked file.
- Only the public wire format crosses the boundary — no Cloud-internal identifier, type, table,
  function, or error string appears in this repo (constitution § I).
- A failed/cancelled onboarding leaves no partial Cloud config.
- Error messages expose only public API response codes/shapes.

**Out of scope (other bounded contexts touched but not owned here):**

- **Specflow Cloud auth/identity backend** — issues and validates credentials; the CLI only consumes
  its public endpoints.
- **Specflow Cloud projects/board service** — owns project creation and board state; the CLI calls
  its public endpoints, owns none of its internals.
- **Billing / subscription** — gating who may create projects is a Cloud concern, surfaced to the
  CLI only as public response codes.
- **The remote-control / gate feature** (monorepo epic) — a separate workstream; not part of this
  backend's onboarding.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can go from `specflow init --backlog cloud` to a working Cloud-backed backlog
  (config written, first `/backlog list` succeeds) in under 2 minutes, without manually editing any
  config file.
- **SC-002**: After init, 100% of backlog operations in the project reach Specflow Cloud and 0%
  invoke the GitHub `gh` path.
- **SC-003**: The access secret appears in 0 version-controlled files across the initialised
  project.
- **SC-004**: Under sustained agent-driven backlog activity, the project encounters 0
  GitHub-API-rate-limit failures (the rate-limit class this backend exists to eliminate).
- **SC-005**: An expired-but-renewable credential is renewed with 0 user prompts before the next
  backlog command succeeds.
- **SC-006**: 100% of Cloud-path error messages shown to the user contain no Cloud-internal
  terminology (verified against the public response-code vocabulary).

## Assumptions

- The Specflow Cloud **public** HTTP API exposes the endpoints this flow needs — an interactive
  token-exchange auth endpoint, a refresh endpoint, list-projects, and create-project — under the
  documented versioned contract. The token-exchange auth model (FR-003) **hard-depends** on these
  being published; there is no pasted-token fallback in the default path, so this feature is
  **Cloud-first** (see Dependencies).
- The existing `cloud` backlog scripts (`add` / `move` / `list` / `view` / `columns` / `reconcile` /
  `clarify-comment`) already consume `api_url` + `api_token` + `project_key` as a `Bearer` token;
  this feature reuses that read contract and only changes how those values are obtained and stored.
- `.specflow/backlog-config.yml` is the canonical per-project backend record; downstream skills and
  the Product Owner agent detect `backend: cloud` from it.
- Users run init on a machine with interactive terminal access for the default flow; the
  non-interactive path (User Story 4) covers CI/headless.
- The Cloud deployment URL is provided by the user (or a sensible default) — the CLI does not
  hard-code a single hosted endpoint.

## Dependencies

- **Cloud-first hard dependency** — the chosen token-exchange auth model (FR-003) means this feature
  **cannot ship end-to-end until the Cloud half publishes**: (1) an interactive token-exchange auth
  endpoint, (2) a refresh endpoint, (3) list-projects, and (4) create-project — all in the
  documented, versioned public wire format. The board/columns and activity endpoints already shipped
  (issues #12 / #354); these **auth + projects** endpoints are net-new contract surface. Mirrors the
  #354 pattern: the Cloud endpoint lands first, then the CLI integration. A Cloud-side ticket for
  these endpoints is the upstream blocker for `/specflow plan` → `implement` here.
- **Boundary (constitution § I)** — the only bridge to the private Cloud half is the versioned
  public HTTP API; no private-half identifier may enter this repo.
