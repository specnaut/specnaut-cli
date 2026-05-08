# Backlog

> Managed by the Product Owner agent (`/backlog`). Each task is one
> file under `.specflow/backlog/NNN-slug.md` with frontmatter; this
> index lists items grouped by status column.

The 5 status columns mirror the GitHub Projects "kanban" model:

- **Backlog** — needs more info, sizing, or prioritisation. The PO
  works these on `/specflow groom` until they're ready.
- **Ready** — clarified, sized, prioritised. The PO proposes these
  for development when asked "what's next".
- **In progress** — actively being worked on (a branch is open).
- **In review** — implementation done, PR open, awaiting merge.
- **Done** — closed / shipped (kept here for the recent audit trail;
  prune as needed).

Size and priority live in each item's frontmatter (see
`.specflow/backlog/NNN-*.md`):

```yaml
---
number: NNN
title: ...
status: Backlog | Ready | "In progress" | "In review" | Done
size: XS | S | M | L | XL
priority: P0 | P1 | P2 | P3
created: ...
---
```

The PO assigns size + priority during the `/specflow groom` pass.

---

## Backlog

_No tasks yet._

## Ready

_No tasks yet._

## In progress

_No tasks yet._

## In review

_No tasks yet._

## Done

_No tasks yet._
