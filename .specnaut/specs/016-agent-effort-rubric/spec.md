# Feature Specification: Per-agent `effort` tuning rubric

**Feature Branch**: `016-agent-effort-rubric` **Created**: 2026-06-13 **Status**: Draft **Input**:
User description: "Mechanism D of the miximodel audit-team port (epic mkrlabs/specflow-monorepo#12).
Give every bundled agent an explicit `effort:` frontmatter field (low|medium|high|xhigh) per a
documented rubric — low for pure orchestrators, medium for report-generating auditors/reviewers +
product-owner, high for design/architecture, xhigh for coding/agentic agents — and add an agents
README explaining the compound cost/quality rationale. No agent left without `effort:`."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Predictable token spend across the agent fleet (Priority: P1)

A maintainer dispatches many agents (a `/code-audit` with several seats, a `review-coordinator`
run). Today the effort level is the opaque default, over-provisioning fire-and-forget orchestrators
and risking under-provisioning coding agents. With every agent carrying an explicit `effort:`, spend
is intentional and legible: orchestrators run cheap, coding agents run deep.

**Why this priority**: The entire value of mechanism D — explicit, rubric-driven effort so parallel
dispatch is cost-predictable.

**Independent Test**: Inspect each bundled agent's frontmatter; confirm every one has an `effort:`
field whose value matches the rubric for its role.

**Acceptance Scenarios**:

1. **Given** any bundled agent, **When** its frontmatter is read, **Then** it has exactly one
   `effort:` field with a value in {low, medium, high, xhigh}.
2. **Given** a pure orchestrator (review-coordinator, workflow-manager), **When** read, **Then**
   `effort: low`.
3. **Given** a coding/agentic agent (developer, qa-tester, devops-sre), **When** read, **Then**
   `effort: xhigh`.

---

### User Story 2 - Understand why each agent is tuned as it is (Priority: P2)

A maintainer (or a future agent author) reads an agents README that states the rubric and its
rationale — the compound cost/quality tradeoff that makes `low` right for dispatchers and `xhigh`
right for code-writers — so new agents follow the same logic.

**Why this priority**: Durability — without the documented rationale, future agents are tuned ad
hoc. Trails the assignment itself.

**Acceptance Scenarios**:

1. **Given** the agents README, **When** read, **Then** it lists each effort tier, which agents are
   in it, and the rationale.
2. **Given** the README, **When** read, **Then** it notes the model-compatibility caveat (`xhigh` is
   Opus-only) so an author doesn't set `xhigh` on a Sonnet-pinned agent.

---

### Edge Cases

- **`xhigh` on a Sonnet-pinned agent** → invalid (would 400). The rubric assigns `xhigh` only to
  Opus-pinned agents; the README documents the caveat.
- **An agent not explicitly named in the rubric** (e.g. specflow-expert, code-reviewer,
  test-reviewer) → assigned by its role class (read-only structured-findings/Q&A → medium), and the
  README records the mapping so none is left unclassified.
- **A future agent added without `effort:`** → the README's rule (every agent declares effort) plus
  a test that asserts presence catches the omission.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every bundled agent under `templates/core/agents/` MUST carry exactly one `effort:`
  frontmatter field with a value in {`low`, `medium`, `high`, `xhigh`}.
- **FR-002**: Assignments MUST follow the rubric: pure orchestrators (route+dispatch only) → `low`;
  report-generating auditors, structured reviewers, the Q&A explainer, and product-owner → `medium`;
  design/UX (and architecture-level reasoning) → `high`; coding/agentic agents (write code / run
  suites / operate infra) → `xhigh`.
- **FR-003**: `effort: xhigh` MUST only be assigned to agents pinned to an Opus `model:` (xhigh is
  Opus-only); no Sonnet-pinned agent may carry `xhigh`.
- **FR-004**: An agents README (`templates/core/agents/README.md`, delivered to
  `.claude/agents/README.md`) MUST document the rubric: each tier, its member agents, the compound
  cost/quality rationale, and the `xhigh`-is-Opus-only caveat.
- **FR-005**: The change MUST be additive frontmatter only — no agent's description, body, tools, or
  other frontmatter is altered.
- **FR-006**: The README and the updated agents MUST ship through the bundle (`init`/`upgrade`); the
  README registered in the manifest, the agents re-bundled. Plugin mirror updated (agents + README
  are markdown).

### Key Entities _(see Domain Model section below for full structure)_

- **Effort tier**: one of low/medium/high/xhigh, with a role definition and a member set.
- **Agent effort assignment**: the binding of one agent to one tier.

## Domain Model _(mandatory)_

**Bounded context:** Agent Effort Tuning — a frontmatter-level cost/quality policy over the bundled
agent fleet. Pure configuration + documentation; no runtime behaviour change (effort is a dispatch
hint).

**Vocabulary (Ubiquitous language):**

- **Effort tier** — `low` | `medium` | `high` | `xhigh`; the reasoning budget hint.
- **Role class** — orchestrator / auditor-reviewer / designer / coder; maps to a tier.
- **Model-compatibility** — `xhigh` is Opus-only; other tiers are universal.

**Entities (have identity):**

- **Agent** — identified by file stem; gains one `effort:` field. Existing entity; this adds the
  field.

**Value objects (no identity, immutable):**

- **EffortTier(value, roleDefinition, rationale)** — documented in the README.

**Invariants (rules the domain must never break):**

- Every bundled agent has exactly one `effort:` ∈ {low, medium, high, xhigh}.
- `xhigh` ⇒ the agent's `model:` is an Opus model.
- The change is additive frontmatter only (no body/description/tools edits).
- The README's member lists match the actual agent assignments (no drift).

**Out of scope (other bounded contexts touched but not owned here):**

- Tuning agent prompts for quality (separate from effort).
- The dispatch mechanism (effort is a hint, not a runtime switch).
- Cloud/Mobile agent tuning; `architect`/`product-manager` (monorepo-root agents, not in the CLI
  bundle).
- FinOps cost-projection seat (Cloud-specific).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of bundled agents carry an `effort:` field with a valid value — verifiable by a
  test that loops the agents.
- **SC-002**: 0 Sonnet-pinned agents carry `xhigh` (model-compat invariant) — verifiable by a test
  cross-checking `model:` vs `effort:`.
- **SC-003**: The README documents all four tiers, their members, the rationale, and the Opus-only
  caveat; its member lists match the actual assignments.
- **SC-004**: No agent's description/body/tools changed (additive frontmatter only) — verifiable
  from the diff.
- **SC-005**: A fresh `specflow init` / `upgrade` delivers the effort-tuned agents and the README.

## Assumptions

- The bundled fleet is the 15 agents under `templates/core/agents/`; `architect`/`product-manager`
  are monorepo-root agents and out of scope here.
- Current model pins: developer/devops-sre/qa-tester/product-owner = opus; the rest = sonnet. So the
  rubric's `xhigh` set (developer, qa-tester, devops-sre) is Opus-pinned and valid; all other tiers
  are model-agnostic.
- `effort` is consumed by the harness as a frontmatter hint (no Specflow runtime code reads it);
  shipping it is additive and safe for agents on any model (except the Opus-only `xhigh`
  constraint).
- Distribution reuses the bundle/manifest path; agents + the new README are markdown → mirrored to
  `plugin/`.
