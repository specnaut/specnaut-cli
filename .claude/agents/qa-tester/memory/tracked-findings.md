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

## #135 — file-count-divergence

**Symptom:** The count printed by `specflow init` ("wrote N files") diverges
from the count printed by the re-init guard ("target already contains N
specflow-managed file(s)") in T5.

**Do not flag** any T5 finding where the two counts differ. This is a known
issue being tracked and framed in #135.

**When to remove:** when #135 closes and its fix ships; the next QA run will
re-verify alignment from a fresh-eyes perspective.
