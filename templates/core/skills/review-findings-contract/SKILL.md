---
name: review-findings-contract
description: Defines the machine-readable REVIEW SUMMARY block every expert/reviewer emits once after its prose, with severity counts and a verdict. Preloaded, not user-invocable.
user-invocable: false
constitution-exempt: an output-format contract preloaded by reviewers that already read the constitution first
---

# review-findings-contract

This skill defines the **REVIEW SUMMARY** block. Agents that preload it
(`architect-expert`, `performance-expert`, `security-expert`,
`accessibility-expert`, `dependency-expert`, `code-reviewer`, `test-reviewer`, and the
`review-coordinator`) emit exactly one such block **after their prose** (and
before the WORKFLOW STATUS block when the agent also carries `workflow-contract`).
It normalizes the review's severity counts and verdict so a coordinator can
synthesize multiple seats' findings without re-reading each prose report. The
`review-coordinator` emits the same block with the **aggregated** counts summed
across every seat. The block is additive — it appends to the prose, never
replaces it.

## Format

```text
REVIEW SUMMARY
REVIEW_SCOPE: <reviewer name or gate scope>
REVIEW_VERDICT: pass | fail | needs_followup
SEATS_EXPECTED: <integer>
SEATS_REPORTED: <integer>
EVIDENCE: <what you actually inspected — paths, comma-separated | NONE>
CRITICAL_COUNT: <integer>
HIGH_COUNT: <integer>
MEDIUM_COUNT: <integer>
LOW_COUNT: <integer>
TOP_ISSUES: <one sentence, or up to 5 lines | none>
RECOMMENDATION: <one sentence — what the next actor should do>
```

## Rules

- `REVIEW_VERDICT: pass` only when `CRITICAL_COUNT == 0` **and** `HIGH_COUNT == 0`
  **and** `SEATS_REPORTED == SEATS_EXPECTED`.
- `REVIEW_VERDICT: fail` when `CRITICAL_COUNT > 0` **or** `HIGH_COUNT > 0`
  **or** `SEATS_REPORTED < SEATS_EXPECTED`.
- **A seat that could not review is not a seat that reported.** The two counts
  exist so that "nobody looked" has an arithmetic representation, instead of
  being a prose note beside an all-zero block that reads as clean. A single
  reviewer emits `1`/`1`, or `1`/`0` when it is declaring itself unable.
- `REVIEW_VERDICT: needs_followup` when only Medium/Low findings remain.
- Every count is an explicit integer, including `0`.
- **Every field in the format appears inside the block.** Mentioning a field in
  prose beside the block has not emitted it — the block is the whole
  machine-readable surface, and a parenthetical after it is invisible to
  whatever parses the run. Observed: a coordinator aggregating correctly, with
  `SEATS_EXPECTED` / `SEATS_REPORTED` / `EVIDENCE` in a sentence underneath.
- Verdict and counts must never contradict.

## `EVIDENCE` — what a clean verdict has to name

`SEATS_REPORTED` is a seat's own account of itself. Nothing in the arithmetic
above stops a seat from emitting `1`/`1` with all-zero counts and an empty
report; it aggregates as a clean pass and the coordinator, counting blocks,
cannot tell it from a real one.

- `EVIDENCE` names what the seat inspected. On a **clean** report — every
  severity count `0` — it MUST name at least one path from the diff under
  review. A clean verdict is a claim about specific files, so it names them.
- A clean report whose `EVIDENCE` is **absent, empty, or `NONE`** is `NOT RUN`.
  The coordinator counts that seat as `0` towards `SEATS_REPORTED` whatever the
  seat wrote, and the verdict comes out `fail` from the same arithmetic as a
  missing block. This is the one field a seat's own count does not override.
- A report **with findings** needs no `EVIDENCE` beyond the findings, which
  already name their locations. Emit the field anyway; it costs one line.

**The limit this leaves, stated so the next reader inherits it rather than
rediscovering it.** `EVIDENCE` is still written by the seat. What changes is
that the coordinator now holds a claim it can check — the paths either are in
the diff or they are not — instead of a number nobody can check. A seat that
copies real paths out of the diff and reviews none of them still passes. This
mechanism answers *did it look at all*, never *did it look well*, and no
amount of contract text will make it answer the second.
