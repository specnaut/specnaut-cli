---
name: size-priority-labels
description: T-shirt size and priority labels for Backlog grooming — scheme confirmed by Kevin in #129; field-first contract tracked in #194
type: preference
---

## Current contract (pending #194)

When `/specflow groom` runs on a project WITH native Priority/Size fields (e.g. Project #4), write values
via `set-field.sh` — NEVER write `priority:*` / `size:*` labels alongside native fields. Labels are a
fallback ONLY when the project has no native fields configured.

When `/specflow groom` runs on a project WITHOUT native fields, use GitHub/GitLab labels:

**Size labels:** `size:XS`, `size:S`, `size:M`, `size:L`, `size:XL`

**Priority labels:**
`priority:P0` — incident / blocker
`priority:P1` — next sprint must-have
`priority:P2` — important but deferrable
`priority:P3` — nice-to-have / long horizon

**Why:** Kevin confirmed T-shirt sizes via labels in #129. The field-first rule is being formalised in #194 — once that ships, the label path is officially a fallback only.

**How to apply:** Check `_config.sh` cache for Priority/Size field IDs. If present → `set-field.sh`. If absent → `gh api repos/.../labels --method POST` create-if-absent, then assign. Labels confirmed to exist as of 2026-05-10: `size:XS`, `size:S`, `size:M`, `size:L`, `priority:P2`, `priority:P3`. `size:XL`, `priority:P0`, `priority:P1` do not yet exist — create-if-absent pattern required.

**Local markdown:** When the 5-column local backend ships (#130), size and priority go into front-matter or inline markers (convention TBD in that ticket).
