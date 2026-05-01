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

## Issue #15 — `self-update --check` indistinguishable from bare self-update in up-to-date path

**Symptom to suppress:** running `specflow self-update --check` and
`specflow self-update` (no flag) on a freshly-init'd or up-to-date project
both print `✓ already up to date (templates X.Y.Z)` and exit 0. The two
forms produce identical output in the up-to-date path.

**Why suppressed:** tracked in https://github.com/mkrlabs/specflow/issues/15.

**How to apply:** if T8 (or any other test that probes self-update) sees
this exact behaviour, count it as expected, do not file a finding. If
the bare form starts behaving differently from `--check` (e.g. starts
trying to download in the up-to-date path), that's a regression — flag
it as a BLOCKER.

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

---

## Issue #17 — init "Next steps" steers users to a different command than the docs quickstart

**Symptom to suppress:** in T3 the init output's "Next steps" section
ends with `Run /backlog add "<first task title>"`. The docs at
`specflow.makerlabs.dev/llms.txt` say a fresh user should run
`/specflow.specify` first. The `/specflow.specify` command IS scaffolded
at `.claude/commands/specflow.specify.md` — only the init message
diverges.

**Why suppressed:** tracked in https://github.com/mkrlabs/specflow/issues/17.

**How to apply:** if the init output recommends `/backlog add` as the
first user-facing action, do not flag. If the init output starts
recommending `/specflow.specify`, the ticket is fixed — flag a
"unexpected fix detected, please re-verify by reading docs" reminder
in the report and stop suppressing.

---

## Issue #19 — `specflow --help` footer points at the GitHub repo instead of the canonical docs site

**Symptom to suppress:** `specflow --help` prints
`Docs:  https://github.com/mkrlabs/specflow` in its footer. The
canonical docs site is `https://specflow.makerlabs.dev`.

**Why suppressed:** tracked in https://github.com/mkrlabs/specflow/issues/19.

**How to apply:** if the Docs URL line still mentions `github.com`, do
not flag. If it mentions `specflow.makerlabs.dev`, the ticket is
fixed — stop suppressing.

---

## Issue #20 — `check --project` template-version phrasing reads as if binary is the templates version

**Symptom to suppress:** `specflow check --project` prints a line of the
form `templates version  ✓ matches binary (X.Y.Z)`, where `X.Y.Z` is the
templates version. `--version` shows the binary version separately as
`specflow A.B.C (templates X.Y.Z)`. The two surfaces look like they
contradict each other.

**Why suppressed:** tracked in https://github.com/mkrlabs/specflow/issues/20.

**How to apply:** if the wording is `matches binary (...)`, do not flag.
If the wording changes (e.g. `matches bundled (...)`, `lock matches bundled`,
or split into two lines), the ticket is fixed — stop suppressing.
