---
name: docs-upkeep-pattern
description: PO owns docs upkeep on four user-visible surfaces, driven by a Stop-event hook in the Specflow repo — pattern established in issue #100
type: pattern
---

The product-owner agent (not a separate doc-writer agent) owns docs upkeep on
four surfaces, in priority order:

1. `docs/llms.md` — canonical website + `/llms.txt`
2. `README.md` — repo root
3. `templates/core/commands/specflow.*.md` — slash-command sources (specify, plan, tasks, implement, analyze, review, merge, constitution, checklist, clarify)
4. `templates/core/skills/*/SKILL.md` — auto-chain, backlog, specflow-groom skills

**Rule:** When clarifying any ticket that touches user-visible surfaces (CLI
flags, command branches, `--help` output, handler stdout / error messages, prompt
UX), include an AC bullet requiring docs-upkeep verification before merge.

**Why:** Kevin chose Option B (extend PO scope) over a standalone doc-writer
agent in issue #100. The trigger is hook-driven — a Stop-event hook at
`.claude/hooks/check-docs-drift.sh` (in the Specflow repo itself, NOT in the
bundled templates) fires after every turn and emits
`hookSpecificOutput.additionalContext` recommending PO dispatch when CLI source
changed but no doc surface did.

**How to apply:** For future tickets that change user-visible surfaces, add to
the AC: "The docs-upkeep hook fires and the PO confirms all four surfaces are
in sync (or proposes patches for any drift) before the PR is merged." The PO is
read-only in this mode — it audits and proposes patches; the main session
writes the actual edits.
