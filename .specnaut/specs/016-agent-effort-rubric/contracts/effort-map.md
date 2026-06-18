# Contract: agent → effort assignment (authoritative)

Every bundled agent under `templates/core/agents/` gets exactly this `effort:`. `xhigh` only on
Opus.

| Agent                | model (current) | effort     | Role class                              |
| -------------------- | --------------- | ---------- | --------------------------------------- |
| review-coordinator   | sonnet          | **low**    | pure orchestrator (dispatch only)       |
| workflow-manager     | sonnet          | **low**    | pure orchestrator                       |
| a11y-auditor         | sonnet          | **medium** | read-only auditor (structured findings) |
| architecture-auditor | sonnet          | **medium** | read-only auditor                       |
| dependency-auditor   | sonnet          | **medium** | read-only auditor                       |
| performance-auditor  | sonnet          | **medium** | read-only auditor                       |
| security-auditor     | sonnet          | **medium** | read-only auditor                       |
| code-reviewer        | sonnet          | **medium** | structured reviewer                     |
| test-reviewer        | sonnet          | **medium** | structured reviewer                     |
| specflow-expert      | sonnet          | **medium** | Q&A / explainer                         |
| product-owner        | opus            | **medium** | backlog management                      |
| ui-ux-designer       | sonnet          | **high**   | design / higher-order reasoning         |
| developer            | opus            | **xhigh**  | coding / agentic                        |
| qa-tester            | opus            | **xhigh**  | runs suites / agentic                   |
| devops-sre           | opus            | **xhigh**  | operates infra / agentic                |

Tally: 2 low · 9 medium · 1 high · 3 xhigh = 15.

## Rules

- Insert `effort:` into existing frontmatter (adjacent to `model:`); change nothing else.
- The three `xhigh` agents are all `model: opus` — valid. No sonnet-pinned agent gets `xhigh`.
- The README's tier member lists must match this table exactly.
