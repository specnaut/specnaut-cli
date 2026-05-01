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

_(currently empty — all six original QA-finding tickets #15, #17, #18, #19, #20, #16 have shipped. Next QA dispatch will re-verify each from a fresh-eyes perspective. Re-add sections here when new tickets get opened for newly-found symptoms.)_
