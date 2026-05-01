---
name: tracked-findings
description: QA findings already tracked in backlog tickets — do not re-flag in reports. One section per ticket. Remove a section when its ticket closes; the next run will then re-verify (and re-flag if regressed).
type: feedback
---

When you observe one of the symptoms below during a QA run, **do not record
it as a finding** and **do not bump the findings counter**. Instead, log it
under "Suppressed by memory" in the final report with the ticket number and
section slug shown here.

When a ticket below is closed (the corresponding fix shipped), the matching
section gets deleted from this file by the dispatching session. The next
QA run will then have no suppression for that symptom — it'll either confirm
the fix (no finding) or re-flag a regression.

---

## Issue #16 — init reports "wrote 39 files" but collision guard says "38 specflow-managed file(s)"

**Symptom to suppress:** in T3 the `specflow init --here --ai claude`
output prints `✓ wrote 39 files`. In T5 the re-init refusal prints
`target already contains 38 specflow-managed file(s)`. The discrepancy
of 1 corresponds to `.gitignore` (treated as a `mergeable-project-root`
entry, written but excluded from the collision count).

**Why suppressed:** tracked in https://github.com/mkrlabs/specflow/issues/16.

**How to apply:** when the difference between T3's "wrote N" and T5's
"contains N-1 specflow-managed" is exactly 1, treat it as expected. If
the gap grows beyond 1 (e.g. wrote 40 / contains 38), that's a new
discrepancy — flag it.

