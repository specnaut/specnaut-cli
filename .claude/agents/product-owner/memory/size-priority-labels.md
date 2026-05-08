---
name: size-priority-labels
description: T-shirt size and priority labels for Backlog grooming — scheme confirmed by Kevin in #129
type: preference
---

When `/specflow groom` runs, the PO must assign:

**Size labels** (GitHub/GitLab labels, not in body):
`size:XS`, `size:S`, `size:M`, `size:L`, `size:XL`

**Priority labels** (GitHub/GitLab labels):
`priority:P0` — incident / blocker
`priority:P1` — next sprint must-have
`priority:P2` — important but deferrable
`priority:P3` — nice-to-have / long horizon

**Why:** Kevin confirmed T-shirt sizes via labels in Q1 of #129. Priority scheme P0–P3 is a PO-proposed default (Kevin did not specify one; if he overrides it, update this file).

**How to apply:** These labels do not exist in the repo by default. Before assigning, run `gh label create size:XS --repo mkrlabs/specflow` etc. (or `glab label create` for GitLab). The create-if-absent pattern is required — do not skip creation or the assignment will fail.

**Local markdown:** When the 5-column local backend ships (#130), size and priority go into front-matter or inline markers (convention TBD in that ticket).
