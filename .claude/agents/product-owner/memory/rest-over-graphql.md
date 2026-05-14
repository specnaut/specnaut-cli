---
name: rest-over-graphql
description: Always prefer the REST API over raw GraphQL — GraphQL burns the shared quota far faster and exhausts independently of REST
type: feedback
---

Always reach for REST (`gh api <path>` / `gh issue` / `gh project` CLI / `mcp__github__*`
tools) before raw `gh api graphql`. Use raw GraphQL **only** when no REST/CLI/MCP path
exists for that operation.

**Why:** GraphQL and REST share the same 5,000-points/hour authenticated quota, but a
GraphQL call is scored by query complexity and costs many times more than the REST
equivalent — and the two buckets drain independently, so GraphQL can hit `0/5000` while
REST still has thousands left. On 2026-05-14, a session's GraphQL bucket was fully
exhausted by backlog dispatches while REST sat at ~4000 remaining; that blocked PR
creation and field mutations until the hourly reset. The `set-field.sh` IssueType path
was deliberately built on a single REST `PATCH .../issues/N -f type=…` call instead of
the 3-call GraphQL `updateIssue` flow for exactly this reason.

**How to apply:**
- Reads → `gh issue view/list`, `gh api repos/…`, or `mcp__github__*` REST tools.
- Issue Type → `set-field.sh <num> IssueType <…>` (REST PATCH under the hood).
- Priority/Size → `set-field.sh` (`gh project item-edit`, the thin CLI wrapper).
- Raw `gh api graphql` is the last resort — e.g. `updateProjectV2ItemFieldValue` and
  the targeted project-item-ID lookup, which genuinely have no REST equivalent. Keep
  those queries as small as possible.
- This reinforces the agent prompt's "Tool preference order: CLI → MCP → GraphQL" — REST
  always wins ties.
