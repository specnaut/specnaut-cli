import { assert } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Schema-self-consistency guard (FR-002): each contract SKILL.md body must
 * contain its fenced block header AND the verdict/state rule lines that define
 * the block's invariants. This keeps the bundled schema text from silently
 * drifting away from the canonical contracts in
 * `.specnaut/specs/012-agent-output-contracts/contracts/*.md` — if a header or
 * a load-bearing rule line is dropped from a SKILL.md, the matching assertion
 * goes red.
 */

function skillContent(name: string): string {
  const entry: CoreEntry | undefined = CORE_BUNDLE.find(
    (e) => e.category === "skill" && e.name === name,
  );
  assert(entry, `contract skill "${name}" missing from CORE_BUNDLE`);
  return entry.content;
}

/**
 * For each contract: the fenced block header that downstream parsers key on,
 * plus a sample of the verdict/state rule lines that encode the block's
 * invariants. Substrings are matched verbatim against the canonical contract.
 */
const SCHEMA_MARKERS: Record<string, string[]> = {
  "workflow-contract": [
    "WORKFLOW STATUS",
    "STATE: in_progress | blocked | awaiting_review | awaiting_qa | awaiting_user | done | failed",
    "Never `done` with `DONE_CRITERIA_MET: no`.",
    "`HANDOFF_TARGET: none` when work terminates here.",
  ],
  "handoff-protocol": [
    "HANDOFF",
    "Block exists **iff** `HANDOFF_TARGET ≠ none`",
    "`TARGET` must equal the WORKFLOW STATUS `HANDOFF_TARGET`.",
  ],
  "review-findings-contract": [
    "REVIEW SUMMARY",
    "REVIEW_VERDICT: pass | fail | needs_followup",
    "`REVIEW_VERDICT: pass` only when `CRITICAL_COUNT == 0` **and** `HIGH_COUNT == 0`.",
    "`REVIEW_VERDICT: fail` when `CRITICAL_COUNT > 0` **or** `HIGH_COUNT > 0`.",
    "Verdict and counts must never contradict.",
  ],
  "qa-report-contract": [
    "QA SUMMARY",
    "QA_VERDICT: pass | fail | blocked",
    "`QA_VERDICT: pass` only when the requested QA scope is complete **and** `TOTAL_FAIL_COUNT == 0`.",
    "`QA_VERDICT: blocked` when QA could not run (missing environment/prereqs) — distinct from `fail`.",
  ],
};

for (const [name, markers] of Object.entries(SCHEMA_MARKERS)) {
  Deno.test(`contract "${name}" body carries its block header + rule lines`, () => {
    const body = skillContent(name);
    for (const marker of markers) {
      assert(
        body.includes(marker),
        `contract "${name}" is missing required schema text: ${JSON.stringify(marker)}`,
      );
    }
  });
}
