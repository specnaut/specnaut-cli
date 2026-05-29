# Feature Specification: Carry agent model assignment into Codex sub-agent TOML

**Feature Branch**: `feat/codex-subagent-model-mapping` **Created**: 2026-05-29 **Status**: Draft
**Linked issue**: mkrlabs/specflow#340 (axis 1, re-scoped) **Input**: User description: "Extend
CodexHarness — carry the per-agent model assignment into the generated `.codex/agents/*.toml` so
Codex sub-agents run at the capability tier the Specflow agent declares, instead of all silently
inheriting the session default."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Codex sub-agents run at their declared capability tier (Priority: P1)

A user runs `specflow init --ai codex` on a project. Specflow's bundled agents each declare a
deliberate capability tier (e.g. the heavy `qa-tester` is meant to run on a high-capability model;
the lighter `code-reviewer` on a mid tier). After init, when the user's Codex CLI spawns one of
those sub-agents, it runs at a tier that reflects what the agent author intended — not a flat
session default applied uniformly to every agent.

**Why this priority**: This is the entire feature. Without it, `--ai codex` produces sub-agents that
have lost the model intent the Claude harness preserves, making the Codex experience a
lower-fidelity copy. It is the only axis of issue #340 that is both unbuilt and unblocked.

**Independent Test**: Generate the Codex bundle for a project whose agents declare differing tiers,
inspect the emitted `.codex/agents/*.toml`, and confirm each file carries a capability signal
derived from its source agent's declared tier — a heavy agent and a light agent produce different
signals.

**Acceptance Scenarios**:

1. **Given** a bundled agent that declares the higher capability tier, **When** the Codex bundle is
   generated, **Then** its `.codex/agents/<name>.toml` carries the capability signal corresponding
   to that tier.
2. **Given** a bundled agent that declares the mid capability tier, **When** the Codex bundle is
   generated, **Then** its `.codex/agents/<name>.toml` carries the mid-tier signal — distinct from
   the higher tier.
3. **Given** an agent whose frontmatter declares no model, **When** the Codex bundle is generated,
   **Then** its TOML omits the capability signal entirely so the agent inherits the parent Codex
   session default (today's behaviour, preserved).
4. **Given** the existing `name` / `description` / `developer_instructions` fields, **When** the
   capability signal is added, **Then** those three fields are emitted unchanged and the TOML
   remains valid and discoverable by Codex.

### Edge Cases

- **Unrecognised model value** — an agent declares a tier Specflow does not map (a typo, or a future
  tier). The emitter must not produce an invalid TOML file; it omits the capability signal (falls
  back to session-default inheritance) rather than emitting a guessed or malformed value.
- **`model: inherit`** (or an explicit "use the session default" sentinel) — treated the same as "no
  model declared": the signal is omitted.
- **Empty / whitespace model value** — treated as "no model declared".

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The Codex sub-agent TOML emitter MUST read the source agent's declared capability tier
  from its frontmatter when generating each `.codex/agents/<name>.toml`.
- **FR-002**: The emitter MUST translate a recognised declared tier into the Codex
  `model_reasoning_effort` field (NOT the `model` field — resolved in clarify: effort is tier-shaped
  and stable, whereas `model` would hard-code drifting OpenAI model identifiers). Mapping: `opus` →
  `high`, `sonnet` → `medium`.
- **FR-003**: When the source agent declares no recognised tier (absent, empty, `inherit`, or an
  unmapped value), the emitter MUST omit the capability signal so the sub-agent inherits the parent
  Codex session default.
- **FR-004**: The emitter MUST continue to emit the existing `name`, `description`, and
  `developer_instructions` fields unchanged, and the output MUST remain valid TOML that Codex CLI
  discovers without further configuration.
- **FR-005**: The tier→signal translation MUST live in one place so the supported tiers and their
  mapping are auditable and extendable from a single location.
- **FR-006**: The behaviour MUST be covered by automated tests asserting the emitted signal for a
  high-tier agent, a mid-tier agent, and a no-model agent.

### Key Entities _(see Domain Model section below for full structure)_

- **Source agent**: a bundled Specflow agent definition carrying a `model` tier in its frontmatter
  (today: `opus` or `sonnet`).
- **Codex sub-agent file**: the generated `.codex/agents/<name>.toml` Codex reads to discover and
  configure a sub-agent.
- **Capability signal**: the Codex `model_reasoning_effort` value through which a declared tier is
  expressed (resolved in clarify).

## Domain Model _(mandatory)_

**Bounded context:** Harness bundling — translating the harness-agnostic core bundle into Codex's
on-disk conventions.

**Vocabulary (Ubiquitous language):**

- **Core agent** — a harness-agnostic agent definition in the core bundle, authored in the Claude
  frontmatter shape.
- **Capability tier** — the model intent an agent author declares (`opus` = higher, `sonnet` = mid
  today); harness-agnostic, expresses "how much model this agent needs", not a vendor model id.
- **Capability signal** — the Codex-side expression of a tier in the generated TOML.
- **Session default** — the model/effort the parent Codex session runs with, inherited by any
  sub-agent that declares nothing.

**Entities (have identity):**

- **Codex sub-agent file** [aggregate root] — one `.codex/agents/<name>.toml` per core agent;
  identified by agent name.

**Value objects (no identity, immutable):**

- **Tier mapping(tier → signal)** — the pure, total function from a declared tier to a capability
  signal (or "omit"); the single source of truth for what Specflow supports.

**Invariants (rules the domain must never break):**

- A generated TOML file is always valid and discoverable — an unmapped or absent tier never yields a
  malformed or guessed field.
- The three existing fields (`name`, `description`, `developer_instructions`) are never altered by
  this feature.
- Boundary: this is public-CLI-only work; no private-half (Cloud / Mobile) identifier is involved.

**Out of scope (other bounded contexts touched but not owned here):**

- **Claude harness** — owns its own model handling; untouched.
- **Codex Agents SDK integration** (#340 axis 2) — blocked on an upstream TypeScript SDK release;
  tracked separately.
- **`/goal` scaffolding** (#340 axis 3) — already delivered
  (`templates/harness-specific/codex/goal.md`); not part of this feature.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For every bundled agent that declares a recognised tier, the generated Codex TOML
  carries a capability signal — measured as 100% of tier-declaring agents (today 15 of 15) emitting
  a non-empty signal.
- **SC-002**: A higher-tier agent and a mid-tier agent emit _different_ capability signals — the
  tier distinction survives the translation.
- **SC-003**: An agent declaring no recognised tier emits a TOML file with no capability signal —
  byte-identical, for the agent body, to today's output.
- **SC-004**: 100% of generated Codex sub-agent TOML files parse as valid TOML and are discovered by
  Codex CLI without manual edits.

## Assumptions

- Codex sub-agent TOML supports an optional capability field (`model` and/or
  `model_reasoning_effort`) that, when omitted, inherits from the parent session — per the current
  OpenAI Codex sub-agents documentation.
- Bundled Specflow agents declare their tier via a `model:` frontmatter key (verified: values are
  `opus` and `sonnet` today).
- The set of tiers Specflow uses is small and stable; new tiers are added by extending the single
  mapping, not by changing call sites.
- This change is confined to the Codex harness mapping and its tests — no change to the core bundle,
  the agent frontmatter shape, or any other harness.
