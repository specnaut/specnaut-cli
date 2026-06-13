# Data Model — per-agent effort rubric

No runtime store. The model is the agent→tier assignment + the model-compat invariant. Asserted by a test.

## Entity: Agent
Identity = file stem. Gains one `effort:` frontmatter field. Carries an existing `model:`.

## Value object: EffortTier(value, roleDefinition)
`value` ∈ {low, medium, high, xhigh}. Role definitions per contracts/effort-map.md.

## Relation: assignment (authoritative — see contracts/effort-map.md)
- low: review-coordinator, workflow-manager
- medium: a11y-auditor, architecture-auditor, dependency-auditor, performance-auditor, security-auditor, code-reviewer, test-reviewer, specflow-expert, product-owner
- high: ui-ux-designer
- xhigh: developer, qa-tester, devops-sre  (all model: opus)

## Invariants
- Every bundled agent has exactly one `effort:` ∈ {low, medium, high, xhigh}.
- `effort: xhigh` ⇒ `model:` is opus.
- Additive frontmatter only (no body/description/tools change).
- README member lists == actual assignments (no drift).
