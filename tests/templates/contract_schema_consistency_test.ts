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
  "backlog-reference-contract": [
    "[#<number> — <title>](<url>)",
    "**Never a number alone** when the title is available.",
    "**Never fabricate a URL.**",
    "Never construct a browser URL from the API host.",
  ],
  "workflow-contract": [
    "WORKFLOW STATUS",
    "STATE: in_progress | blocked | awaiting_review | awaiting_user | done | failed",
    "DONE_CRITERIA_MET: yes | no",
    "BLOCKERS: <one sentence | none>",
    "HANDOFF_TARGET: developer | product-owner | user | none",
    "Never `done` with `DONE_CRITERIA_MET: no`.",
    "`HANDOFF_TARGET: none` when work terminates here.",
  ],
  "review-findings-contract": [
    "REVIEW SUMMARY",
    "REVIEW_VERDICT: pass | fail | needs_followup",
    "SEATS_EXPECTED",
    "SEATS_REPORTED",
    "**and** `SEATS_REPORTED == SEATS_EXPECTED`.",
    "**or** `SEATS_REPORTED < SEATS_EXPECTED`.",
    "Verdict and counts must never contradict.",
    "EVIDENCE",
    "A clean report whose `EVIDENCE` is **absent, empty, or `NONE`** is `NOT RUN`.",
  ],
};

/**
 * #678: the WORKFLOW STATUS fields nothing parsed. The log hook reads `STATE`,
 * `DONE_CRITERIA_MET` and `HANDOFF_TARGET`; the developer reads `BLOCKERS`. A
 * field returning here is one more line every seat writes and no tool reads.
 */
const WORKFLOW_DROPPED_FIELDS = [
  "SUMMARY:",
  "ARTIFACTS:",
  "FILES_CHANGED:",
  "VALIDATION:",
  "NEXT_ACTION:",
  "awaiting_qa",
] as const;

Deno.test("workflow-contract carries only the fields something parses", () => {
  const body = skillContent("workflow-contract");
  for (const field of WORKFLOW_DROPPED_FIELDS) {
    assert(!body.includes(field), `workflow-contract still carries ${field} (dropped under #678)`);
  }
});

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
