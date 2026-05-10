---
name: size-priority-labels
description: Priority/Size are native Project fields (source of truth) — labels are a fallback only for projects without native fields; shipped in #194 (PR #196)
type: preference
---

## Shipped contract (as of #194 / PR #196, 2026-05-10)

**Priority and Size are native Project fields** — they are the canonical source of truth for
Project #4. Labels (`priority:*` / `size:*`) are explicitly **not** used alongside native fields.

Rules:

- When `/specflow groom` runs on a project WITH native Priority/Size fields (Project #4 and any
  project configured similarly), write values via `set-field.sh` — NEVER also write
  `priority:*` / `size:*` labels.
- When `/specflow groom` runs on a project WITHOUT native fields, fall back to labels:
  - **Size labels:** `size:XS`, `size:S`, `size:M`, `size:L`, `size:XL`
  - **Priority labels:** `priority:P0` / `priority:P1` / `priority:P2` / `priority:P3`
- The PO doc (`product-owner.md`) and `SKILL.md` both encode this field-first contract. Any new
  "import skill" or harness ticket should follow suit.

## Project #4 native Priority field — current option IDs (post PR #196)

The P3 (GREEN) option was added via `updateProjectV2Field`. **Warning:** that mutation rotates ALL
option IDs even when names are unchanged. IDs after PR #196:

| Option | Colour | ID |
|--------|--------|----|
| P0 | RED | `093323d6` |
| P1 | ORANGE | `7b8ac56e` |
| P2 | YELLOW | `eae399b4` |
| P3 | GREEN  | `59c235b3` |

**Always re-fetch option IDs** (`gh api graphql ...`) after any future `updateProjectV2Field` call
before re-pinning them in `set-field.sh`.

## ensure-labels.sh — canonical set (as of #194)

Seeds exactly 7 semantic labels: `security`, `refactor`, `docs`, `tech-debt`, `dx`,
`performance`, `dependency`. Zero `priority:*` / `size:*` labels seeded or expected.
