---
name: audit-phases-design
description: Design decisions for Epic #302 — three /specflow audit <axis> phases + two new agents
type: decision
---

**Rule: audit phases land as phase docs (`phases/audit-*.md`), not as top-level skills. Alias skills (`audit-{security,performance,accessibility}/SKILL.md`) are thin wrappers that invoke the router.**

**Why:** Phase docs compose with the router's `--manual/--once/--continue` chain flags. Top-level alias skills give the short-form slash command without duplicating logic.

**How to apply:**
- Phase docs: `templates/core/skills/specflow/phases/audit-security.md`, `audit-performance.md`, `audit-accessibility.md`
- Alias skill wrappers: `templates/core/skills/audit-security/SKILL.md`, `audit-performance/SKILL.md`, `audit-accessibility/SKILL.md` — body is just "invoke `/specflow audit <axis>`"
- Two new agents: `templates/core/agents/performance-auditor.md` + `a11y-auditor.md`
- All three audit phases are non-chainable one-shot phases (like `groom`, `checklist`)
- Severity flag (`--severity medium`) parses inline in each phase doc, not in the router
- PO consumption offer lives in the phase doc body as a "suggested next step" block
- FE detection for a11y: agent reads for presence of `.html`, `.jsx`, `.tsx`, `.vue`, `.svelte` files; no lock-based signal needed

**Pre-existing drift to fix in same PR:**
- `src/domain/plugin_coverage.ts` line 46: regex `[a-z]+` does NOT match hyphens; `tag-version.md`, `release-version.md`, `list-skills.md` are currently excluded from isPluginCoveredPath. Fix: change to `[a-z][a-z-]*[a-z]` or `[a-z]+(?:-[a-z]+)*`.
- `plugin_coverage_test.ts` has no tests for hyphenated phase names.
