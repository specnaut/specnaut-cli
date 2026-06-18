# Feature Specification: Product Owner ↔ Specflow Cloud stage integration

**Feature Branch**: `002-po-cloud-stages`\
**Created**: 2026-05-31\
**Status**: Draft\
**Input**: User description: "product-owner integration with Specflow Cloud stages — when the
backlog backend is `cloud`, the PO agent reads the board's column layout and is triggered on stage
transitions via the public Specflow Cloud HTTP API, with behaviour equivalent to the GitHub Projects
integration (classify / move / comment). Strictly bounded to the versioned public API; no
Cloud-internal terminology or identifiers in this repo." (issue #354)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - PO reads the live board column layout (Priority: P1)

A project using the `cloud` backlog backend has a Specflow Cloud board whose columns are defined by
the team (a default board ships Backlog / Ready / In Progress / In Review / Done, but a team may
rename or reorder them). When the Product Owner agent runs any backlog operation, it must first
learn the board's current column layout — names and order — so it reasons about real stages instead
of assuming a fixed set. Today the PO hard-codes the GitHub Projects status names; on the Cloud
backend it must instead discover them at runtime.

**Why this priority**: Every other PO behaviour on the Cloud backend depends on knowing the columns.
Reading the layout is the irreducible foundation and is independently useful (the PO can already
list/triage against real stages) even before any event handling exists.

**Independent Test**: Point a project's `backlog-config.yml` at a Cloud board with renamed columns,
dispatch the PO for a "what's the board state?" request, and confirm it reports the team's actual
column names/order — not a hard-coded GitHub status list.

**Acceptance Scenarios**:

1. **Given** a `cloud`-backend project with a reachable board, **When** the PO needs the stage list,
   **Then** it retrieves the columns (name + order) from the public API and uses those names
   verbatim in its reasoning and output.
2. **Given** a board whose columns were renamed/reordered since the last run, **When** the PO reads
   the layout again, **Then** it reflects the new names/order without any code change or re-install.
3. **Given** the board is unreachable or the token is invalid, **When** the PO tries to read
   columns, **Then** it fails with a clear, actionable message and does not fall back to a
   hard-coded stage list.

---

### User Story 2 - Stage transition triggers the matching PO hook (Priority: P1)

When a task moves between columns on the Specflow Cloud board (e.g. into "In Review", or into
"Done"), the Product Owner agent is triggered to run the behaviour that stage warrants — the same
hooks it runs for GitHub Projects today (classify a newly-arrived item, post a stage-appropriate
comment, advance or reconcile status). The integration consumes only the documented public
stage-transition signal; it carries no knowledge of how Cloud produces it.

**Why this priority**: This is the actual point of the issue — making the board an event source for
the PO so stages drive PO action, matching the GitHub integration. Without it the Cloud backend is
read/write-only and the PO is inert between explicit commands.

**Independent Test**: Move a task into a hook-bearing column on a test board, run the integration's
transition-handling entry point, and confirm the PO performs exactly the mapped action for that
column (and nothing for columns with no mapped hook).

**Acceptance Scenarios**:

1. **Given** a task is moved into a column that has a mapped PO hook, **When** the transition is
   processed, **Then** the PO runs that hook's action (classify / comment / move) against the task
   via the public API.
2. **Given** a task is moved into a column with no mapped hook, **When** the transition is
   processed, **Then** the PO takes no action and records a no-op (it never invents behaviour for
   unmapped columns).
3. **Given** the same transition is processed more than once, **When** the PO runs the hook,
   **Then** the effect is idempotent — it does not post duplicate comments or re-apply a
   classification that is already set.
4. **Given** a hook's action fails (API error mid-hook), **When** the PO handles it, **Then** the
   failure is surfaced and the transition can be safely retried without partial duplicate side
   effects.

---

### User Story 3 - Behavioural parity with the GitHub Projects integration (Priority: P2)

For the core PO use-cases — classify an item, move it between stages, comment on it — a maintainer
switching a project from the GitHub backend to the Cloud backend gets the same PO behaviour. The
stage names and transport differ, but the PO's decisions and the shape of its output do not.

**Why this priority**: Parity is the acceptance bar Kevin set, but it is verified on top of Stories
1–2; it is a quality gate over the mechanics rather than a separate mechanism.

**Independent Test**: Run the same PO scenario (e.g. "triage and classify this new item") against an
equivalent GitHub-backed and Cloud-backed project and diff the PO's resulting decisions and comment
structure — they match modulo stage-name vocabulary.

**Acceptance Scenarios**:

1. **Given** equivalent boards on each backend, **When** the PO classifies a new item, **Then** it
   assigns the same priority/size/type reasoning and writes it through each backend's documented
   mechanism.
2. **Given** a stage advance on each backend, **When** the PO moves an item, **Then** the item lands
   in the corresponding stage on each board.

---

### Edge Cases

- **Renamed canonical column**: a team renames "In Review" to "Review". Stage hooks are mapped by
  canonical meaning, so the integration must resolve the team's column to the canonical stage (or
  treat it as unmapped) — see FR-005.
- **Duplicate / ambiguous column names**: two columns share a name; the integration must resolve
  deterministically or report ambiguity rather than guess.
- **Transition into a column that was deleted before processing**: the hook lookup must degrade to a
  clear no-op/error, not crash.
- **Board with zero tasks or zero columns**: layout read returns empty; PO reports an empty board
  rather than erroring.
- **Stale config**: `api_url` / `api_token` / `project_key` missing or wrong — one clear
  configuration error, never a silent hard-coded fallback.
- **Replayed / out-of-order transitions**: the same or older transition is seen again; idempotency
  (FR-008) protects against duplicate side effects.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: When the backlog backend is `cloud`, the Product Owner agent MUST obtain the board's
  current column layout (column names and their order) from the versioned public Specflow Cloud HTTP
  API before reasoning about stages.
- **FR-002**: The PO MUST use the discovered column names verbatim in its reasoning and user-facing
  output, and MUST NOT assume the GitHub Projects status set on the Cloud backend.
- **FR-003**: The integration MUST react to stage-transition events (a task moving between columns)
  by invoking the PO hook mapped to the destination stage, equivalent to the GitHub Projects stage
  hooks for classify / move / comment.
- **FR-004**: A transition into a stage with no mapped hook MUST result in an explicit no-op
  (recorded, no side effect).
- **FR-005**: The integration MUST define how arbitrary board column names map to the canonical
  Specflow stages that carry hooks. Default behaviour (assumption, see Assumptions): match the
  canonical stage names (Backlog / Ready / In Progress / In Review / Done) case-insensitively;
  unmatched columns are treated as unmapped (FR-004).
- **FR-006**: All Cloud reads and writes the PO performs MUST go through the documented versioned
  public HTTP API contract only.
- **FR-007**: No Cloud-internal terminology, identifiers, hostnames revealing the backend
  technology, type names, or error strings may appear anywhere in this repository as a result of
  this feature. The only coupling is the versioned public wire format.
- **FR-008**: PO hook actions triggered by a transition MUST be idempotent — re-processing the same
  transition MUST NOT post duplicate comments or re-apply an already-applied classification.
- **FR-009**: Configuration or connectivity failures MUST produce a single clear, actionable error;
  the PO MUST NOT silently substitute a hard-coded stage list or skip a hook without recording it.
- **FR-010**: Board-originated stage transitions reach the local, on-demand PO agent via a **poll /
  reconcile (cursor)** model: the PO reads a public "transitions/activity since `<cursor>`" surface
  (on demand or on a `/loop` schedule), processes each returned transition in order, then persists
  the new cursor. The PO MUST persist the cursor durably per project so that, across separate runs,
  each transition is delivered at-least-once and processed at most one effective time (paired with
  FR-008 idempotency). No webhook receiver and no always-on process are introduced. This creates a
  hard dependency: the Specflow Cloud public API MUST expose a versioned, cursor-paginated
  activity/changes surface that yields, per entry, at least the task number, the origin and
  destination stage, and an ordering token usable as the next cursor.
- **FR-011**: The behaviour for the three core use-cases (classify, move, comment) MUST be
  functionally equivalent to the GitHub Projects integration, differing only in stage vocabulary and
  transport.

### Key Entities _(see Domain Model section below for full structure)_

- **Board column / stage**: a named, ordered position a task occupies; the unit the PO reasons about
  and the trigger surface for hooks.
- **Stage transition**: the event of a task moving from one column to another; the signal that may
  fire a PO hook.
- **Stage hook**: the mapping from a canonical stage to a PO action (classify / move / comment).
- **Backlog config**: the per-project pointer (`api_url`, `api_token`, `project_key`) that scopes
  all Cloud API access.

## Domain Model _(mandatory)_

**Bounded context:** Backlog orchestration (CLI side) — specifically the Product Owner's view of a
hosted Kanban board reached over a public contract.

**Vocabulary (Ubiquitous language):**

- **Backend** — the chosen backlog store for a project (`local` / `github` / `gitlab` / `cloud`);
  selected at `specflow init`.
- **Column / Stage** — a named position on the board. "Column" is the board's word; "stage" is the
  workflow meaning the PO attaches to it.
- **Canonical stage** — one of the Specflow workflow stages that may carry a hook (Backlog, Ready,
  In Progress, In Review, Done).
- **Stage transition** — a task moving between columns; a candidate trigger.
- **Stage hook** — a PO action bound to a canonical stage (classify on arrival, comment on review,
  summarise on done, etc.).
- **Public API contract** — the versioned `/api/v1` HTTP surface; the sole, documented bridge
  between this repo and Specflow Cloud.

**Entities (have identity):**

- **Task** [referenced, not owned] — identified by its board `number` within a project; the subject
  of hooks. Owned by the Cloud half; the PO only references it by number through the public API.
- **Stage hook mapping** [aggregate root] — the canonical-stage → PO-action table that defines what
  fires where; owned by this feature.

**Value objects (no identity, immutable):**

- **Column(name, order)** — a board column as read from the layout endpoint; immutable snapshot for
  a given read.
- **Transition(taskNumber, fromStage, toStage)** — the described move that a hook reacts to.
- **BacklogConfig(api_url, api_token, project_key)** — the immutable per-project access tuple read
  from `backlog-config.yml`.
- **Cursor(token)** — an opaque ordering token marking the last processed transition; persisted per
  project, advanced after each reconcile pass.

**Invariants (rules the domain must never break):**

- The PO never assumes stage names on the Cloud backend — it always reads the live layout first
  (FR-001/FR-002).
- No Cloud-internal identifier ever enters this repo; only the versioned public wire format crosses
  the boundary (FR-006/FR-007). Authoritative source: constitution § I.
- A transition with no mapped hook produces a recorded no-op, never invented behaviour (FR-004).
- Hook side effects are idempotent under replay (FR-008).
- Configuration/connectivity failure is loud, never a silent hard-coded fallback (FR-009).

**Out of scope (other bounded contexts touched but not owned here):**

- **Specflow Cloud (private half)** — owns the board, columns, tasks, and however it emits/stores
  transitions. This feature consumes only its public API; it neither defines nor inspects Cloud
  internals.
- **Specflow workflow phases** — the existing specify→…→merge PO touchpoints; this feature may
  attach to them (delivery model (c)) but does not redefine them.
- **Epics / sub-tasks / label management on Cloud** — explicitly "not yet on the Cloud backend" per
  the backlog skill; out of scope here.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a `cloud`-backend project, the PO reports the board's actual column names/order in
  100% of runs, and 0 runs surface a hard-coded GitHub status list.
- **SC-002**: For every canonical stage that carries a hook, moving a task into that stage triggers
  exactly the mapped PO action, and moving into an unmapped stage triggers none — verified across
  all configured stages with no false triggers.
- **SC-003**: Re-processing any single transition produces zero duplicate comments and zero
  redundant classification writes (idempotency holds at 100%).
- **SC-004**: A side-by-side run of the classify / move / comment use-cases on a GitHub-backed vs
  Cloud-backed project yields equivalent PO decisions (same priority/size/type reasoning;
  corresponding destination stage) in every case.
- **SC-005**: A repo-wide scan finds zero Cloud-internal identifiers, backend technology names, or
  private type/error strings introduced by this feature.

## Assumptions

- **Stage-name mapping default**: board columns map to canonical stages by case-insensitive name
  match against Backlog / Ready / In Progress / In Review / Done; unmatched columns are unmapped (no
  hook). A configurable alias map is a possible later refinement, not part of this slice. (FR-005)
- **Core hook set = parity set**: the hooks in scope are the three Kevin named — classify, move,
  comment. Any richer Cloud-side automation is a Cloud-internal concern this feature neither mirrors
  nor depends on.
- **Existing API surface is reused**: column-read and move-by-status-name already exist on the
  public API (`GET /api/v1/columns`, `GET/PATCH
  /api/v1/tasks`) and are consumed as-is; only a
  transition-delivery surface may be new (gated by FR-010).
- **Single project per config**: one `backlog-config.yml` scopes one project; multi-project routing
  is out of scope.
- **No always-on process**: the CLI runs on demand; the chosen poll/reconcile model (FR-010) needs
  no receiver and no daemon — it reconciles at invocation or on a `/loop` schedule.
- **Dependency (hard, cross-half)**: poll/reconcile requires a versioned, cursor-paginated **public
  activity/changes endpoint** on the Specflow Cloud API (yielding per entry: task number,
  from-stage, to-stage, ordering token). The column-read (`GET /api/v1/columns`) and move
  (`PATCH /api/v1/tasks`) surfaces already exist and are reused; the activity surface does **not**
  exist yet. Per the monorepo cross-cutting discipline, the Cloud half must ship that endpoint
  **before** the CLI integration can be implemented and verified.
