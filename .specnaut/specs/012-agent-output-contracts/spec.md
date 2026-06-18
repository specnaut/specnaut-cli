# Feature Specification: Machine-readable agent output contracts

**Feature Branch**: `012-agent-output-contracts` **Created**: 2026-06-12 **Status**: Draft
**Input**: User description: "Machine-readable agent output contracts for the Specflow CLI bundled
fleet (mechanism A from the miximodel audit-team port, epic mkrlabs/specflow-monorepo#12). Add four
user-invocable:false contract skills to the bundled template set and wire the existing
auditor/review/qa/developer agents to preload them, so their output carries normalized fenced blocks
parsable by downstream tooling."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A reviewer agent emits a parsable verdict (Priority: P1)

When any review or audit agent finishes its work, its final output carries a single, fixed-format
`REVIEW SUMMARY` block — an explicit verdict plus severity counts — appended after its
human-readable prose. A person skims the prose; a downstream skill, script, or supervisor reads the
block without interpreting natural language.

**Why this priority**: This is the foundational capability the whole epic stands on. Without a
normalized verdict block, mechanism B (multi-seat audit synthesis) cannot merge findings across
seats and mechanism C (status supervision) cannot detect a failing gate. Every other story depends
on this one.

**Independent Test**: Dispatch any `*-auditor` agent over a small scope; confirm its output ends
with a `REVIEW SUMMARY` block whose verdict and four severity counts are explicit integers, and that
the prose above it is unchanged in character from today's output.

**Acceptance Scenarios**:

1. **Given** a security-auditor reviewing code with two high-severity findings, **When** it
   completes, **Then** its output ends with a `REVIEW SUMMARY` block carrying
   `REVIEW_VERDICT: fail`, `HIGH` count `2`, and the other counts as explicit integers including
   zero.
2. **Given** an architecture-auditor that finds only one low-severity nit, **When** it completes,
   **Then** the block carries `REVIEW_VERDICT: needs_followup` (critical and high both zero, but not
   entirely clean).
3. **Given** any auditor that finds nothing, **When** it completes, **Then** the block carries
   `REVIEW_VERDICT: pass` with all four counts `0`.

---

### User Story 2 - A working agent reports structured state and a precise handoff (Priority: P1)

When a workflow agent (developer, review-coordinator) finishes a segment of work, it appends a
`WORKFLOW STATUS` block stating where it is (in progress, blocked, awaiting review/qa, done,
failed), whether its exit criteria were actually met, what changed, and who should act next. When
that next actor is another agent, it also appends a `HANDOFF` block naming the target, the exact
requested action, and the payload the next actor needs.

**Why this priority**: Structured state is what lets an orchestrator or supervisor route work
without re-reading the whole transcript, and it is the second half of the parsable-output
foundation. Equal priority to Story 1 — both are prerequisites for mechanisms B and C.

**Independent Test**: Dispatch the developer agent on a trivial change; confirm the output ends with
a `WORKFLOW STATUS` block whose `STATE` and `HANDOFF_TARGET` are drawn from the fixed allowed
values, followed by a `HANDOFF` block iff `HANDOFF_TARGET` is not `none`.

**Acceptance Scenarios**:

1. **Given** the developer finishes implementing but review has not happened, **When** it reports,
   **Then** `STATE: awaiting_review` (never `done`) and a `HANDOFF` block targets the
   review-coordinator with a concrete `REQUESTED_ACTION` and the changed-file list as `PAYLOAD`.
2. **Given** an agent cannot proceed because a prerequisite is missing, **When** it reports,
   **Then** `STATE: blocked`, `DONE_CRITERIA_MET: no`, the obstacle is named in `BLOCKERS`, and no
   `done` is emitted.
3. **Given** an agent's assigned scope is genuinely complete with nothing downstream, **When** it
   reports, **Then** `STATE: done` with `HANDOFF_TARGET: none` and no `HANDOFF` block.

---

### User Story 3 - A QA run reports countable results (Priority: P2)

When the qa-tester agent finishes a validation run, it appends a `QA SUMMARY` block with an explicit
verdict (pass / fail / blocked), test counts, and a bug count, so a supervisor can tell a clean run
from a real-bug run from an environment-blocked run without reading the narrative.

**Why this priority**: QA is one consumer of the contract system rather than a prerequisite for the
others, so it trails the two P1 foundations — but it completes the set of agent roles the downstream
ledger expects.

**Independent Test**: Dispatch the qa-tester on a project with a passing suite; confirm the output
ends with a `QA SUMMARY` block whose verdict and numeric fields are explicit integers.

**Acceptance Scenarios**:

1. **Given** a QA run where every requested check passes, **When** it reports, **Then**
   `QA_VERDICT: pass` with a zero bug count.
2. **Given** a QA run that cannot execute because the environment is missing, **When** it reports,
   **Then** `QA_VERDICT: blocked` (distinct from `fail`).

---

### User Story 4 - A project that adopts a new Specflow version inherits the contracts (Priority: P2)

A team running `specflow init` or `specflow upgrade` receives the four contract skills and the
contract-aware agent frontmatter as part of the standard bundled fleet, with no extra opt-in step.
Their agents start emitting the normalized blocks immediately.

**Why this priority**: The contracts are a product capability, not a Specflow-internal convenience —
their value is realized only when shipped to user projects. P2 because the format must be settled
(Stories 1–3) before it is distributed.

**Independent Test**: Scaffold a fresh project with the new bundle; confirm the four contract skills
are present and the bundled agents carry the contract preload references.

**Acceptance Scenarios**:

1. **Given** a fresh `specflow init`, **When** the bundle is installed, **Then** the four contract
   skills exist and the auditor/review/qa/developer agents reference the relevant contracts.
2. **Given** an existing project on an older bundle, **When** it upgrades, **Then** the contract
   skills are added without overwriting the team's own customised files.

---

### Edge Cases

- **A non-preloaded agent** (one not in the wired set) produces no contract block — the contracts
  are scoped to the named roles, not forced on every agent.
- **An agent with nothing to hand off** omits the `HANDOFF` block entirely rather than emitting it
  with `TARGET: none`.
- **A clean review** still emits a full `REVIEW SUMMARY` with explicit `0` counts — absence of
  findings is never expressed by an absent block.
- **An agent claims `done` while exit criteria are unmet** — this is a contradiction the format
  makes detectable (`STATE: done` with `DONE_CRITERIA_MET: no`); the contract forbids it, and a
  downstream audit can flag any leak.
- **A team has hand-customised one of the bundled agents** — an upgrade must not silently clobber
  their version while still making the contract available.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The bundle MUST provide four contract artifacts — a workflow-status contract, a
  handoff contract, a review-findings contract, and a QA-report contract — each marked
  non-user-invocable (they are agent instructions, never invoked directly by a person).
- **FR-002**: Each contract artifact MUST document its block's exact shape: the field names, the
  allowed values for any enumerated field, the integer requirement for count fields, and the
  omit-when-empty rules — precisely enough that an author and a parser independently agree on the
  schema.
- **FR-003**: The workflow-status contract MUST define a `WORKFLOW STATUS` block with fields
  `STATE`, `DONE_CRITERIA_MET`, `SUMMARY`, `ARTIFACTS`, `FILES_CHANGED`, `VALIDATION`, `BLOCKERS`,
  `NEXT_ACTION`, `HANDOFF_TARGET`, and constrain `STATE` to a fixed set (in progress, blocked,
  awaiting review, awaiting qa, awaiting user, done, failed).
- **FR-004**: The handoff contract MUST define a `HANDOFF` block with fields `TARGET`, `REASON`,
  `REQUESTED_ACTION`, `PAYLOAD`, `OPEN_RISKS`, emitted only when the workflow-status
  `HANDOFF_TARGET` is not `none`, and require `TARGET` to match that `HANDOFF_TARGET`.
- **FR-005**: The review-findings contract MUST define a `REVIEW SUMMARY` block with a
  `REVIEW_VERDICT` constrained to {pass, fail, needs_followup}, explicit integer counts for Critical
  / High / Medium / Low, a top-issues summary, and a recommendation; and MUST define the verdict
  rule: `pass` only when Critical and High are both zero, `fail` when either is non-zero,
  `needs_followup` when only Medium/Low remain.
- **FR-006**: The QA-report contract MUST define a `QA SUMMARY` block with a `QA_VERDICT`
  constrained to {pass, fail, blocked}, explicit integer test counts and bug count, and a
  recommendation.
- **FR-007**: Every count / numeric field across all contracts MUST be an explicit integer including
  zero — never blank, never "none" for a number.
- **FR-008**: The bundled agents MUST be wired to preload the relevant contracts so the blocks are
  produced automatically: every `*-auditor` agent carries the review-findings and workflow-status
  contracts; the review-coordinator carries the workflow-status and handoff contracts; the qa-tester
  carries the QA-report and workflow-status contracts; the developer carries the workflow-status and
  handoff contracts.
- **FR-009**: Contract output MUST be additive — appended after the agent's existing human-readable
  prose at end of turn — and MUST NOT replace or suppress that prose. No wired agent's existing
  behaviour regresses.
- **FR-010**: A contract block MUST appear at most once per agent turn, in a fixed position (after
  the prose; handoff after workflow-status when both apply).
- **FR-011**: The contracts and the contract-aware agents MUST ship through the standard
  distribution path so a project gains them via `specflow init` (fresh) and `specflow upgrade`
  (existing), the latter without clobbering files the team has marked as their own.

### Key Entities _(see Domain Model section below for full structure)_

- **Contract**: a named, non-user-invocable instruction set that defines one normalized output
  block's schema and the rules for filling it.
- **Status block**: the fenced, fixed-format text an agent appends — an instance of a contract's
  schema (`WORKFLOW STATUS`, `HANDOFF`, `REVIEW SUMMARY`, `QA SUMMARY`).
- **Wired agent**: an existing bundled agent declared to preload one or more contracts, thereby
  obligated to emit their blocks.

## Domain Model _(mandatory)_

**Bounded context:** Agent Output Contracts — the schema layer that makes Specflow agent output
machine-readable, sitting between the agents that produce work and the skills/scripts that supervise
it.

**Vocabulary (Ubiquitous language):**

- **Contract** — a non-user-invocable skill whose sole job is to instruct a preloading agent to emit
  one normalized block. It is documentation-of-schema, not executable logic.
- **Block** — the fenced, fixed-shape text an agent appends at end of turn (`WORKFLOW STATUS`,
  `HANDOFF`, `REVIEW SUMMARY`, `QA SUMMARY`).
- **Preload** — the declarative link by which an agent commits to a contract, so the contract's
  instructions are in force every time that agent runs.
- **Wired agent** — a bundled agent that preloads at least one contract.
- **Verdict** — the single enumerated field (`REVIEW_VERDICT`, `QA_VERDICT`) that summarizes a
  gate's outcome.
- **Handoff target** — the next actor named by an agent; `none` when work terminates with that
  agent.

**Entities (have identity):**

- **Contract** [aggregate root] — identified by its name (`workflow-contract`, `handoff-protocol`,
  `review-findings-contract`, `qa-report-contract`). Owns its block's schema and fill rules. Source
  of truth for both producers (agents) and future consumers (parsers).
- **Wired agent** — identified by its agent name; holds the set of contracts it preloads. Existing
  entity; this feature adds the preload links and the obligation, not the agent.

**Value objects (no identity, immutable):**

- **Block(fields…)** — one emitted instance of a contract; meaningful only by its content,
  interchangeable if identical.
- **Verdict(value)** — constrained to its contract's allowed set; enforces the verdict-derivation
  rule (e.g. review `pass` ⇒ Critical = High = 0).
- **SeverityCounts(critical, high, medium, low)** — four non-negative integers; the review verdict
  is a function of them.

**Invariants (rules the domain must never break):**

- A `REVIEW_VERDICT: pass` requires Critical and High counts both zero — verdict and counts can
  never contradict.
- An agent must not emit `STATE: done` while `DONE_CRITERIA_MET: no`.
- A `HANDOFF` block exists iff `HANDOFF_TARGET` ≠ `none`, and its `TARGET` equals that
  `HANDOFF_TARGET`.
- Every numeric field is an explicit integer (including 0); never blank.
- A block is additive: it never removes or replaces the agent's prose, and appears at most once per
  turn.

**Out of scope (other bounded contexts touched but not owned here):**

- **Status supervision (mechanism C, epic issue #381)** — parses and consumes these blocks (status
  ledger + `/status-audit`). This feature only guarantees the blocks are produced to a fixed schema;
  it reads nothing.
- **Multi-seat audit synthesis (mechanism B, epic issue #379)** — aggregates `REVIEW SUMMARY` blocks
  across parallel seats; depends on this schema but is built separately.
- **Cloud / Mobile agent fleets** — only the CLI bundled fleet is wired here.
- **FinOps cost-projection seat** — Cloud-specific; not part of this port.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of the wired agents (every `*-auditor`, review-coordinator, qa-tester, developer)
  emit their declared contract block(s) on a representative dispatch — zero wired agents produce
  prose-only output.
- **SC-002**: A reader given only a contract's documentation and an emitted block can confirm the
  block is well-formed (every required field present, every enumerated value in range, every count
  an integer) with no judgement calls — the schema is unambiguous.
- **SC-003**: Across a sample of dispatches, zero blocks violate an invariant (no
  `pass`-with-findings, no `done`-with-unmet-criteria, no handoff/target mismatch).
- **SC-004**: A freshly scaffolded project and an upgraded existing project both contain the four
  contracts and contract-aware agents, and the upgrade preserves any team-customised files.
- **SC-005**: The wired agents' existing human-readable output is unchanged in substance — the
  contracts add a trailing block and nothing else (no regression in the prose review/QA/work
  summaries teams rely on).

## Assumptions

- The contract format is ported faithfully from the proven `miximodel` system; field names and
  allowed values follow that source unless a Specflow-specific role name differs (e.g. handoff
  targets are Specflow's agent names).
- Contracts are scoped to the named agent roles, not applied globally — agents outside the wired set
  intentionally produce no blocks.
- "Preload" is expressed through the existing bundled-agent definition mechanism (a frontmatter
  declaration on the agent), consistent with how miximodel wires it; the exact field is an
  implementation detail for the plan.
- Distribution reuses Specflow's existing `init` / `upgrade` bundling and the established
  customisation-preservation behaviour (spec 011); this feature adds files to the bundle and does
  not change the upgrade machinery.
- Downstream consumers (mechanisms B and C) are built later against this schema; this feature is
  complete when the blocks are produced correctly, independent of any consumer existing yet.
