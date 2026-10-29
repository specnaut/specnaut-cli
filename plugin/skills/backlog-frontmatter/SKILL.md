---
name: backlog-frontmatter
description: The canonical task-file frontmatter schema for the local Markdown backlog backend — every field, its allowed values, and which are mandatory. Preloaded, not user-invocable.
user-invocable: false
constitution-exempt: a backlog schema preloaded by product-owner, which already reads the constitution first
---

# backlog-frontmatter

Preloaded by `product-owner`, which owns this schema. Split out of that agent
under #562: the seat had 76 characters of room and no duplication left to
reclaim, and a field schema is a reference worth reading on its own rather than
a passage inside a role description.

**Nothing was cut in the move.**

```yaml
---
number: NNN            # zero-padded 3 digits, globally unique within this project
title: string
status: Backlog | Ready | In progress | In review | Done
size: XS | S | M | L | XL       # empty at creation; set when groomed
priority: P0 | P1 | P2 | P3     # empty at creation; set when groomed
parent: "#NNN"         # only on a sub-task: the local number of its parent epic
created: YYYY-MM-DDTHH:MM:SSZ   # UTC, written by add.sh
---
```

This is what `scripts/local/add.sh` writes and `scripts/local/move.sh` accepts. `size` and
`priority` start empty: an item is not groomed until both hold exactly one value.

`parent: "#NNN"` is the local-Markdown sub-task convention (grep-friendly); absent means a
top-level task or an epic. Older task files may carry `id`, `complexity`, `category`, `tags` or a
lowercase `status`: read them, never write them.
