---
description: Manage the product backlog — list, add, update, groom, brief, and sync tasks. All mutations route through the product-owner agent.
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
| `sync`              | (Future) push all tasks to remote tracker   |
| `sync <id>`         | (Future) push a single task                 |
| `<number>`          | Show details for task NNN                   |

## Rules

1. **Every invocation MUST go through the `product-owner` agent** — even
   short-circuit cases. The agent owns the frontmatter schema, index placement,
   and summary table.
2. After any mutation (add / update / groom / estimate), the orchestrator
   commits the backlog changes with a message like
   `chore(backlog): add task NNN — <short title>` or
   `chore(backlog): update task NNN — <what changed>`. Stage only
   `tasks/backlog.md` and `tasks/backlog/*.md`.
3. The `sync` sub-commands currently emit a stub that tells the user the
   feature is not yet available in this Specflow version. Do not fabricate a
   sync behavior.

## Backlog layout

- Index: `tasks/backlog.md`
- Task files: `tasks/backlog/NNN-slug.md` with YAML frontmatter

## Frontmatter schema (enforced by product-owner)

```yaml
---
id: NNN                # zero-padded 3 digits
title: string
category: string
priority: critical | high | medium | low
complexity: 1 | 2 | 3 | 5 | 8 | 13 | 21    # Fibonacci story points
status: todo | in_progress | done | deferred | blocked
depends_on: [string]
spec: string | null
tags: [string]
created: YYYY-MM-DD
---
```

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
