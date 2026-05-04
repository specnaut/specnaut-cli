---
description: Manage the product backlog — list, add, update, groom, and brief tasks. All mutations route through the product-owner agent.
---

## User Input

```text
$ARGUMENTS
```

## Dispatch

| Input pattern       | Action                                      |
|---------------------|---------------------------------------------|
| _(empty)_ or `list` | Show backlog overview                       |
| `next`              | Recommend top 3 tasks with workflow advice  |
| `add <title>`       | Create a new task                           |
| `update <id>`       | Update an existing task                     |
| `estimate <id>`     | Estimate complexity for a task              |
| `status`            | Dashboard summary                           |
| `groom`             | Full grooming session                       |
| `brief <id>`        | Generate PO business brief                  |
| `<number>`          | Show details for task NNN                   |

## Rules

1. **Every invocation MUST go through the `product-owner` agent** — even
   short-circuit cases. The agent owns the frontmatter schema, index placement,
   and summary table.
2. After any mutation (add / update / groom / estimate), the orchestrator
   commits the backlog changes with a message like
   `chore(backlog): add task NNN — <short title>` or
   `chore(backlog): update task NNN — <what changed>`. Stage only the
   files the product-owner agent reports as touched.

## Backlog storage

The product-owner agent reads and writes the backlog directly to whichever
backend the project uses. When the backend is local Markdown:

- Index: `.specflow/backlog.md`
- Task files: `.specflow/backlog/NNN-slug.md`

When the backend is remote (GitHub Issues + Project V2, GitLab, etc.) the
agent talks to that backend directly — the CLI does not push or pull on
its own.

## Frontmatter schema

The product-owner agent owns the canonical schema (see
`.claude/agents/product-owner.md` or the equivalent path for your harness).
Do not duplicate it here — the dispatcher defers to the agent.

## Quick reference

```
/backlog              — View the full backlog
/backlog next         — Recommend the top 3 tasks with workflow advice
/backlog add <title>  — Add a new task
/backlog update <id>  — Update task status/priority
/backlog estimate <id>— Get complexity estimate
/backlog status       — Dashboard summary
/backlog groom        — Full grooming session
/backlog brief <id>   — Generate business brief
/backlog <id>         — View task details
```
