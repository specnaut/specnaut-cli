# Research — per-agent effort rubric

## Decision 1 — Tier assignment for the 15 bundled agents

**Decision**: Map each bundled agent to one tier by role class (authoritative table in
contracts/effort-map.md):
- **low** (pure orchestrators — route + dispatch, no generation): review-coordinator, workflow-manager.
- **medium** (read-only structured-findings producers + Q&A + backlog): a11y-auditor,
  architecture-auditor, dependency-auditor, performance-auditor, security-auditor, code-reviewer,
  test-reviewer, specflow-expert, product-owner.
- **high** (design / higher-order reasoning): ui-ux-designer.
- **xhigh** (coding / agentic / operates infra): developer, qa-tester, devops-sre.

**Rationale**: Mirrors miximodel's rubric. Orchestrators are fire-and-forget → cheapest; auditors/
reviewers produce bounded structured findings → medium; design needs more reasoning → high; agents
that write code across many files / run suites / operate infra → xhigh. The rubric's `architect` and
`product-manager` entries don't apply — those are monorepo-root agents, not in the CLI bundle.

**Alternatives considered**: low for the per-axis-scoped auditors — but a bundled auditor agent is a
single entity serving both the report flow and scoped dispatch; medium is the right single value for
the agent. code-reviewer/test-reviewer as low — they generate review findings, so medium fits.

## Decision 2 — Model compatibility (xhigh is Opus-only)

**Decision**: Verified current pins — developer=opus, devops-sre=opus, qa-tester=opus,
product-owner=opus; all others=sonnet. The `xhigh` set (developer, qa-tester, devops-sre) is therefore
Opus-pinned and valid. All other tiers (low/medium/high) are model-agnostic. The README documents the
caveat; a test asserts no sonnet-pinned agent carries xhigh.

**Rationale**: `xhigh` on Sonnet 400s. Locking this with a test prevents a future regression when an
agent's model is changed without revisiting its effort.

## Decision 3 — README + distribution

**Decision**: Ship `templates/core/agents/README.md` (→ `.claude/agents/README.md`) with the tier table,
rationale, and caveat; register it in the manifest; mirror agents + README to `plugin/`.
