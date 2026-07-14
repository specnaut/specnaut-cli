# Feature Specification: Phase-entry spec pull, auto-generation & parallel orchestration

**Feature Branch**: `021-cli-phase-wiring` **Created**: 2026-07-14 **Status**: Draft **Input**: User
description: "Lot 4 (cli#425) — wire the cloud spec backend into the phase flow: (1) each phase that
consumes the spec (implement/review/analyze/tasks) does a single automatic `spec pull <task>` at
entry in cloud mode, so agents read materialised files and no agent is network-aware; (2)
auto-generate a task's spec at creation time (cloud mode, opt-in) so it's ready when implementation
starts; (3) support authoring multiple specs in parallel — enabled by Lot 2's branch decoupling —
without collisions."

> **Design of record**: `docs/superpowers/specs/2026-07-14-cloud-hosted-specs-design.md` (monorepo).
> Backlog: epic `specnaut-monorepo#15`, this lot `specnaut-cli#425`. Depends on **Lot 2 (cli#424,
> shipped)** — the `spec push`/`spec pull` commands, cloud-mode `specify`, and the gitignored
> materialisation cache. **Scope of THIS spec**: the phase-doc / workflow wiring that makes the
> cloud backend _automatic_ (no manual `spec pull`), the opt-in auto-generation at task creation,
> and the parallel-authoring guidance. It ships mostly template/phase-doc edits + orchestration
> guidance, building on Lot 2's compiled commands.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Agents read the spec automatically at phase entry (Priority: P1)

In cloud mode, when a phase that needs the spec runs — `implement`, `review`, `analyze`, `tasks` —
the flow performs **one** `spec pull <task>` at the start, materialising the spec's tabs into the
gitignored cache, so every downstream agent reads plain files. No agent has to know the spec lives
in the cloud; no agent makes a network call.

**Why this priority**: This is the payoff of the whole design — it neutralises the "every agent must
fetch online" risk. Without it, cloud specs aren't usable in the phase flow.

**Independent Test**: with cloud mode and a task whose spec is on Cloud, run a consuming phase → the
cache is populated once at entry and the agents read the materialised files; running the same phase
twice refreshes the cache without error.

**Acceptance Scenarios**:

1. **Given** cloud mode and a task with a cloud spec, **When** `implement` (or `review` / `analyze`
   / `tasks`) starts, **Then** a single `spec pull <task>` runs first and the phase proceeds against
   the materialised files.
2. **Given** local mode, **When** any phase runs, **Then** no pull happens and behaviour is
   byte-identical to today.
3. **Given** cloud mode but the pull fails (offline/auth), **When** a phase starts, **Then** it
   surfaces the actionable error from Lot 2's `spec pull` (reuse cache if present) and does not
   proceed against an empty spec.

---

### User Story 2 - Auto-generate a task's spec at creation (Priority: P1)

In cloud mode, creating a task can **also generate its specification immediately** (opt-in), so that
when the task is later picked for implementation the spec is already written — no waiting.

**Why this priority**: This is what unlocks "prepare many tasks' specs ahead of time"; it turns spec
authoring from a blocking pre-step into background preparation.

**Independent Test**: with cloud mode and auto-generation enabled, create a task → its cloud spec is
generated and attached without a manual `specify` step; with it disabled, task creation is
unchanged.

**Acceptance Scenarios**:

1. **Given** cloud mode with auto-generation enabled, **When** a task is created, **Then** its spec
   is generated and pushed to that task (via Lot 2's cloud `specify` path) with no branch.
2. **Given** auto-generation disabled (the default), **When** a task is created, **Then** no spec is
   generated — task creation is unchanged.
3. **Given** local mode, **When** a task is created, **Then** auto-generation never triggers.

---

### User Story 3 - Author multiple specs in parallel (Priority: P2)

Because cloud-mode `specify` no longer creates a branch (Lot 2), several specs can be authored at
once. This lot provides the guidance/orchestration so a user (or an agent fleet) can drive N task
specs in parallel without git-branch collisions or shared local state.

**Why this priority**: Valuable throughput gain, but the single-spec flow (US1/US2) already delivers
the core; parallelism is an amplifier.

**Independent Test**: author specs for 3 different tasks concurrently in cloud mode → all three are
pushed to their tasks with no branch created and no file-system collision.

**Acceptance Scenarios**:

1. **Given** cloud mode, **When** specs for several tasks are authored concurrently, **Then** each
   is pushed to its own task with no git branch and no shared-state collision.

---

### Edge Cases

- **Local mode**: none of this lot's behaviour triggers — phases, task creation, and authoring are
  byte-identical to today (no auto-pull, no auto-gen, no orchestration change).
- **Pull-on-entry when the task has no spec yet**: the phase reports "no spec for this task" clearly
  (from Lot 2's `spec pull`) rather than proceeding against nothing.
- **Auto-generation failure**: a failed spec generation must not fail the task creation itself — the
  task is created; the spec-gen error is surfaced separately and retryable.
- **Parallel authoring with the same task twice**: idempotent (Lot 1 upsert) — the last push wins on
  content, no duplication.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: In cloud mode, the consuming phases (`implement`, `review`, `analyze`, `tasks`) MUST
  perform exactly one `spec pull <task>` at entry, before any agent reads the spec.
- **FR-002**: Agents MUST continue to read the spec as local files (the materialised cache) — no
  agent may be required to make a network call to read a spec.
- **FR-003**: In local mode, no phase MUST perform a pull; all phase behaviour MUST be
  byte-identical to the pre-feature CLI.
- **FR-004**: A pull failure at phase entry MUST surface Lot 2's actionable error (reuse cache if
  present) and MUST NOT let the phase proceed against an empty/partial spec.
- **FR-005**: In cloud mode, task creation MUST support opt-in auto-generation of the task's spec
  (via Lot 2's cloud `specify` path), **disabled by default**.
- **FR-006**: Auto-generation failure MUST NOT fail the task creation; the error MUST be surfaced
  separately and be retryable.
- **FR-007**: Cloud-mode `specify` MUST remain branch-free so multiple specs can be authored
  concurrently without git-branch collision or shared local state (this lot adds the guidance; the
  branch-free behaviour ships in Lot 2).
- **FR-008**: The whole lot MUST NOT introduce any Cloud coupling beyond Lot 2's commands / the
  versioned HTTP API — no private-half identifier enters the public CLI (§ I).

### Key Entities _(see Domain Model section below for full structure)_

- **Phase entry hook**: the point at which a consuming phase materialises the spec.
- **Auto-generation toggle**: the opt-in setting that couples task creation with spec-gen.

## Domain Model _(mandatory)_

**Bounded context:** Spec/phase orchestration (CLI) — making the cloud spec backend automatic across
the workflow.

**Vocabulary (Ubiquitous language):**

- **Consuming phase** — a phase that reads the spec: `implement`, `review`, `analyze`, `tasks`.
- **Phase-entry pull** — the single `spec pull <task>` a consuming phase runs first in cloud mode.
- **Auto-generation** — generating a task's spec at creation time (opt-in, cloud mode).
- **Materialised cache** — Lot 2's gitignored `.specnaut/specs/.cache/<task>/` the agents read.

**Entities (have identity):**

- **Workflow phase** — a phase doc; in cloud mode it gains a pull-on-entry step.
- **Auto-generation setting** — the opt-in toggle (config/flag) governing task-creation spec-gen.

**Value objects (no identity, immutable):**

- **PhaseMode(local | cloud)** — derived from the persisted spec backend (Lot 2); selects the
  rendered phase behaviour.

**Invariants (rules the domain must never break):**

- **Local parity** — with the local backend, no auto-pull, no auto-gen, no orchestration change.
- **No network-aware agents** — the only network touch in a phase is the single entry pull.
- **Auto-gen is non-fatal** — it never fails task creation.
- **API-only boundary** — all Cloud interaction goes through Lot 2's commands / the versioned API (§
  I).

**Out of scope (other bounded contexts touched but not owned here):**

- **The `spec pull`/`push` commands, cloud `specify`, materialisation** — Lot 2 (owned there).
- **Cloud store/API, Web UI** — Lots 1 & 3.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In cloud mode, a consuming phase materialises the spec exactly once at entry, and
  agents read only local files (zero agent network calls).
- **SC-002**: In local mode, the full existing phase test suite passes unchanged (zero regressions)
  — no pull, no auto-gen.
- **SC-003**: With auto-generation enabled, creating a task yields a generated cloud spec with no
  branch; disabled (default), task creation is unchanged.
- **SC-004**: A pull or auto-gen failure produces an actionable message and never a silent empty
  spec / failed task creation.
- **SC-005**: Three specs can be authored concurrently in cloud mode, each pushed to its task, with
  zero branches and zero file-system collisions.
- **SC-006**: No CLI source or wire payload references a private-half identifier (§ I).

## Assumptions

- Lot 2's `spec pull`/`spec push` commands, cloud-mode `specify`, and the materialisation cache are
  available (shipped).
- The consuming phases are the four that read the spec (`implement`, `review`, `analyze`, `tasks`);
  `specify` authors (Lot 2) and `merge`/`constitution`/etc. don't consume it.
- Auto-generation is opt-in (default off) to avoid surprising task creation with heavy spec-gen; the
  toggle lives with the project config (mirroring how backends are persisted).
- Parallel authoring is primarily guidance + relying on Lot 2's branch-free `specify`; no new
  compiled orchestration engine is required for v1.
