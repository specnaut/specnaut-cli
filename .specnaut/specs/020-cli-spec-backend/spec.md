# Feature Specification: CLI pluggable spec backend + init choice (local | cloud)

**Feature Branch**: `020-cli-spec-backend` **Created**: 2026-07-14 **Status**: Draft **Input**: User
description: "Lot 2 (cli#424) — add a second spec-storage backend to the Specnaut CLI, chosen at
`specnaut init` like the backlog backend: `local` (current .specnaut/specs/ markdown, unchanged,
first-class default) or `cloud` (recommended — specs hosted on SpecNaut Cloud via the versioned
/api/v1/specs* contract from Lot 1). A SpecStore port with local + cloud adapters; `spec push` /
`spec pull` commands; gitignored materialisation under .specnaut/specs/.cache/<task>/ so agents read
plain files; cloud-mode `specify` pushes steps instead of writing local files and creates NO branch
(branch decoupled to implement). The local backend must never be degraded. Boundary: the CLI talks
to Cloud only through the versioned HTTP API — no private-half identifier enters the public CLI (§
I)."

> **Design of record**: `docs/superpowers/specs/2026-07-14-cloud-hosted-specs-design.md` (monorepo).
> Backlog: epic `specnaut-monorepo#15`, this lot `specnaut-cli#424`. Depends on **Lot 1 (cloud#154,
> shipped)** — the `/api/v1/specs*` contract this consumes. **Scope of THIS spec**: the CLI-side
> backend abstraction, the init choice, the `spec push`/`spec pull` commands, cloud-mode `specify`,
> and the gitignored materialisation. **Automatic** phase-entry pull, auto-generation at task
> creation, and parallel orchestration are **Lot 4** (cli#425).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Choose the spec backend at init (Priority: P1)

When a user runs `specnaut init`, they are offered where specifications should be stored: **local**
(markdown files in `.specnaut/specs/`, the current behaviour — the first-class default) or **cloud**
(recommended — hosted on SpecNaut Cloud). The choice is recorded so every later command knows which
backend is active. Mirrors the existing backlog-backend picker.

**Why this priority**: Nothing else in this lot can key off a backend that isn't selected and
persisted; this is the entry point and the MVP.

**Independent Test**: run `init` and pick `local` → the recorded backend is `local` and `specify`
writes files as today; run `init` and pick `cloud` (or press Enter for the recommended default) →
the recorded backend is `cloud`.

**Acceptance Scenarios**:

1. **Given** a fresh `init`, **When** the user is prompted for a spec backend and presses Enter,
   **Then** the recommended default (`cloud`) is selected and persisted.
2. **Given** a fresh `init`, **When** the user picks `local`, **Then** `local` is persisted and the
   CLI behaves exactly as it does today for all spec operations.
3. **Given** a non-interactive `init` (flag/CI), **When** a spec-backend flag is supplied, **Then**
   it is honoured without a prompt; absent, the default is used.

---

### User Story 2 - Cloud-mode `specify` pushes steps and creates no branch (Priority: P1)

With the cloud backend active, running the spec-authoring flow generates the same step content as
today but **sends it to SpecNaut Cloud** (attached to the backlog task) instead of writing
`.specnaut/specs/` files, and **does not create a git branch**. This is what makes specs
parallelisable — no dedicated branch per spec.

**Why this priority**: This is the authoring half of the cloud path; without it the cloud backend
can store nothing the CLI produces.

**Independent Test**: with backend `cloud` and a linked task, run the authoring flow → the task's
spec on Cloud gains the generated steps (verified by a read), no branch is created, and no
`.specnaut/specs/<n>/` directory is written.

**Acceptance Scenarios**:

1. **Given** backend `cloud` and a linked task, **When** the authoring flow runs, **Then** the
   generated steps are pushed to that task's cloud spec and no git branch is created.
2. **Given** backend `local`, **When** the authoring flow runs, **Then** behaviour is byte-identical
   to today (files written, branch per the existing hook).
3. **Given** backend `cloud` and **no** linked task, **When** the authoring flow runs, **Then** the
   CLI auto-creates a backlog task (from the feature name), links it, and attaches the new spec to
   it — so the task and its spec are created together (no manual pre-step). An explicit `--issue N`
   still overrides by attaching to that existing task.

---

### User Story 3 - Materialise a cloud spec for reading (`spec pull`) (Priority: P1)

`specnaut spec pull <task>` fetches a task's cloud-hosted spec and writes its tabs as **gitignored**
local files under `.specnaut/specs/.cache/<task>/`, so any downstream agent (developer, reviewer,
QA) reads the spec as ordinary files — with **no** knowledge that it lives in the cloud. One fetch
materialises the whole spec; the cache is disposable and never the source of truth.

**Why this priority**: This is the reading half and the core mitigation of the "every agent must
fetch online" risk — agents keep reading files; only `spec pull` talks to the network.

**Independent Test**: with a task that has a cloud spec, run `spec pull <task>` → the tabs appear as
ordered markdown files under `.specnaut/specs/.cache/<task>/`, the path is git-ignored, and
re-running refreshes them without error.

**Acceptance Scenarios**:

1. **Given** a task with a cloud spec, **When** `spec pull <task>` runs, **Then** each step is
   written as an ordered markdown file under `.specnaut/specs/.cache/<task>/` and that path is
   gitignored.
2. **Given** a previously-pulled task, **When** `spec pull <task>` runs again, **Then** the cache is
   refreshed to the current cloud state (stale files reconciled).
3. **Given** no network/expired auth, **When** `spec pull` runs, **Then** it reuses an existing
   cache if present, otherwise fails with an actionable message — never a partial or silent empty
   spec.

---

### User Story 4 - Push local spec content to Cloud (`spec push`) (Priority: P2)

`specnaut spec push <task>` sends spec content for a task to Cloud via the upsert-only contract
(from a materialised cache edit or a locally-authored set), so a user who edited a tab locally can
re-sync it. Upsert-only: it never deletes a tab it doesn't send (Lot 1 FR-011).

**Why this priority**: Useful for round-tripping edits, but the author (US2) and read (US3) paths
already deliver the core loop; explicit re-push is a convenience.

**Independent Test**: edit a materialised tab, run `spec push <task>` → the cloud spec reflects the
edit as a new version, and tabs not included are left untouched.

**Acceptance Scenarios**:

1. **Given** an edited cache tab, **When** `spec push <task>` runs, **Then** the cloud spec records
   the change (a new version) and untouched tabs are preserved.

---

### Edge Cases

- **Backend `local`**: every spec operation behaves exactly as today — this lot adds no friction and
  no new required flags on the local path.
- **Cloud unreachable / token expired** on `push`/`pull`: actionable error (retry / `login`); on
  `pull`, fall back to an existing cache; never implement against an empty spec.
- **Cache vs cloud drift**: the cache is disposable; `spec pull` reconciles it to the cloud state
  (the source of truth). A user is never asked to merge cache and cloud by hand.
- **`.gitignore` already ignores `.specnaut/specs/.cache/`**: idempotent — no duplicate entry; if
  missing, the cache path is added.
- **Upgrading a project that predates this feature**: an existing install with no recorded spec
  backend is treated as `local` (backward compatible — no behaviour change).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `specnaut init` MUST offer a spec-backend choice — `local` (first-class default
  behaviour) or `cloud` (recommended default selection) — and MUST persist it to the install record,
  mirroring the backlog-backend picker (interactive + non-interactive).
- **FR-002**: The CLI MUST resolve spec operations through a single backend abstraction with a
  `local` adapter (filesystem, current behaviour) and a `cloud` adapter (HTTP), selected from the
  persisted choice.
- **FR-003**: With backend `local`, all spec behaviour (authoring, file layout, branch creation)
  MUST be byte-identical to the pre-feature CLI — no regression, no new required flags.
- **FR-004**: With backend `cloud`, the authoring flow MUST push generated steps to the linked
  task's cloud spec via the versioned `/api/v1/specs*` contract and MUST NOT write
  `.specnaut/specs/` files nor create a git branch.
- **FR-005**: `specnaut spec pull <task>` MUST materialise a cloud spec's tabs as ordered markdown
  files under `.specnaut/specs/.cache/<task>/`, and MUST ensure that path is gitignored.
- **FR-006**: `specnaut spec push <task>` MUST send spec content to Cloud using the upsert-only
  contract (never deletes an omitted tab).
- **FR-007**: The cloud adapter MUST authenticate using the CLI's existing Cloud credential store
  (device/refresh tokens) — no new credential type.
- **FR-008**: On a cloud `push`/`pull` failure (network/auth), the CLI MUST surface an actionable
  message; `pull` MUST reuse an existing cache when present and MUST NOT leave a partial or
  silently-empty spec.
- **FR-009**: The cloud adapter MUST speak **only** the versioned public HTTP API. No private-half
  identifier, type, or error string may enter the CLI (constitution § I).
- **FR-010**: An install with no recorded spec backend MUST be treated as `local`
  (backward-compatible upgrade path).
- **FR-011**: In cloud mode, when the authoring flow runs with no linked task, the CLI MUST
  auto-create a backlog task (named from the feature) and link it, then attach the spec — so the
  task and its spec are created together. An explicit `--issue N` overrides by attaching to that
  existing task.

### Key Entities _(see Domain Model section below for full structure)_

- **Spec backend selection**: the persisted `local | cloud` choice.
- **Spec store**: the backend abstraction; two adapters (local fs, cloud HTTP).
- **Materialisation cache**: gitignored local files mirroring a cloud spec for reading.

## Domain Model _(mandatory)_

**Bounded context:** Spec storage (CLI side) — how the Specnaut CLI stores and retrieves the
specifications it authors.

**Vocabulary (Ubiquitous language):**

- **Spec backend** — where specs live: `local` (fs) or `cloud` (SpecNaut Cloud).
- **Spec store** — the CLI abstraction over a backend (push / pull / read).
- **Step / Tab** — one named markdown section of a spec (the framework phase), opaque to the cloud.
- **Materialisation cache** — gitignored local files under `.specnaut/specs/.cache/<task>/`
  mirroring a cloud spec, so agents read files.
- **Linked task** — the backlog task/epic a cloud spec attaches to (`projectKey` + number).

**Entities (have identity):**

- **Install record** [aggregate root] — the persisted project install (`installed.lock`); now also
  carries the spec-backend selection.
- **Materialisation cache** — identified by task; the on-disk mirror of a cloud spec.

**Value objects (no identity, immutable):**

- **SpecBackend("local" | "cloud")** — the backend choice; default `cloud`, `local` fully supported.
- **SpecStep(key, name, order, body)** — an opaque step exchanged with the cloud contract.

**Invariants (rules the domain must never break):**

- **Local parity** — with backend `local`, behaviour is identical to the pre-feature CLI.
- **Cache is disposable** — the materialisation cache is gitignored and never the source of truth;
  the cloud (or local files) is authoritative.
- **API-only boundary** — the cloud adapter uses only the versioned HTTP API; no private-half
  identifier crosses into the public CLI (§ I).
- **No branch in cloud authoring** — cloud-mode `specify` never creates a git branch.

**Out of scope (other bounded contexts touched but not owned here):**

- **Cloud spec store + API** — Lot 1 (cloud#154, shipped); this lot only consumes it.
- **Web UI** — Lot 3 (cloud#155).
- **Automatic phase-entry pull, auto-generation at task creation, parallel orchestration** — Lot 4
  (cli#425). This lot ships the manual `spec pull`/`push` commands and cloud `specify`; wiring them
  automatically into every phase is Lot 4.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can select each backend at `init`; the choice persists and drives every later
  spec operation.
- **SC-002**: With backend `local`, the full existing spec test suite passes unchanged (zero
  regressions).
- **SC-003**: With backend `cloud`, authoring a spec results in the steps being retrievable from
  Cloud and produces zero `.specnaut/specs/` files and zero new git branches.
- **SC-004**: After `spec pull <task>`, an agent with no network access can read the full spec as
  local files, and the cache path is gitignored (0 cache files ever tracked by git).
- **SC-005**: A cloud `push`/`pull` under a broken connection yields an actionable error and never a
  partial/empty spec.
- **SC-006**: No CLI source file or wire payload references a private-half identifier (verified by
  boundary review) — the only Cloud coupling is the versioned `/api/v1/specs*` contract.

## Assumptions

- Lot 1's `/api/v1/specs*` contract is available and stable (shipped).
- The spec-backend choice is stored in the existing install record (`installed.lock`), like the
  backlog backend; absence means `local` (backward compatible).
- Cloud auth reuses the CLI's existing credential store (device/refresh tokens).
- A cloud spec attaches to a backlog task; when cloud-mode `specify` runs with no linked task, the
  CLI auto-creates and links one (FR-011, resolved) — an explicit `--issue N` overrides.
- Automatic phase-entry pull and parallel orchestration are Lot 4; this lot delivers the backend,
  the init choice, the manual commands, and cloud `specify`.
