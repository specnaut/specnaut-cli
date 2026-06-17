# Agent effort rubric

Every bundled agent declares an `effort:` field in its frontmatter. `effort`
is a reasoning-budget hint the harness reads when it dispatches the agent: it
trades **token spend** against **reasoning depth**. A higher tier thinks
harder (and costs more); a lower tier returns faster and cheaper.

Effort is assigned by **role class**, not by how important an agent feels. The
goal is *legible, intentional spend*: when a coordinator fans out several
agents in parallel, fire-and-forget dispatchers must not burn a coding-agent's
budget, and a code-writer must not be starved of the depth it needs.

## The four tiers

| Tier     | Role class                                                     | Agents |
| -------- | -------------------------------------------------------------- | ------ |
| `low`    | Pure orchestrators — route and dispatch only, no deep reasoning | `review-coordinator`, `workflow-manager` |
| `medium` | Read-only auditors, structured reviewers, the Q&A explainer, and the backlog owner | `a11y-auditor`, `architecture-auditor`, `dependency-auditor`, `performance-auditor`, `security-auditor`, `code-reviewer`, `test-reviewer`, `specnaut-expert`, `product-owner` |
| `high`   | Design / higher-order reasoning                                | `ui-ux-designer` |
| `xhigh`  | Coding / agentic work — writes multi-file changes, runs suites, operates infra | `developer`, `qa-tester`, `devops-sre` |

Tally: 2 `low` · 9 `medium` · 1 `high` · 3 `xhigh` = 15 agents.

## Rationale — the compound cost/quality tradeoff

Effort compounds. A coordinator that itself spawns N sub-agents pays its own
reasoning budget *plus* every child's. So the budget belongs where the
thinking actually happens:

- **`low` for pure orchestrators.** `review-coordinator` and
  `workflow-manager` don't reason about the work — they decide *who* runs and
  aggregate what comes back. Spending deep-reasoning tokens on a dispatcher is
  pure waste, multiplied across every fan-out.
- **`medium` for auditors, reviewers, the explainer, and the PO.** These read
  code (or backlog) and emit structured findings. They need genuine analysis
  but not the open-ended exploration of writing a feature. `medium` buys
  enough depth to spot real issues without over-provisioning a read-only pass.
- **`high` for design.** `ui-ux-designer` does higher-order, open-ended
  reasoning (synthesising a coherent design system from a brief), which
  rewards more budget than a structured audit — but it isn't writing and
  running multi-file code.
- **`xhigh` for coding/agentic agents.** `developer`, `qa-tester`, and
  `devops-sre` write multi-file changes, run suites, and operate
  infrastructure. Under-provisioning them is the expensive failure mode: a
  shallow coding pass ships bugs that cost far more than the saved tokens.
  This is the one tier where spending *more* is the economical choice.

## Caveat — `xhigh` is Opus-only

`xhigh` is only valid on an agent pinned to an Opus `model:`. A Sonnet-pinned
agent that declares `effort: xhigh` is rejected by the harness (it would 400
on dispatch). The three `xhigh` agents above (`developer`, `qa-tester`,
`devops-sre`) are all `model: opus`, which is why the tier is valid for them.

When adding a new agent: pick its tier by role class from the table above, and
**never** set `xhigh` unless the agent is also `model: opus`. Every bundled
agent must carry exactly one `effort:` value from {`low`, `medium`, `high`,
`xhigh`}.
