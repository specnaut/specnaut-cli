import { assert } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * #565 — the verdict rule has one home, and seats may not spell a second.
 *
 * `review-findings-contract` defines `REVIEW_VERDICT: pass` as requiring
 * `CRITICAL_COUNT == 0` AND `HIGH_COUNT == 0` AND
 * `SEATS_REPORTED == SEATS_EXPECTED`. Two seats restated that rule and dropped
 * the third clause — so a seat that could not review, emitting all-zero counts,
 * read as clean against its own file. The gate verdict comes from the review
 * aggregation, whose arithmetic still counted correctly, so the weakening was
 * contained; it was one edit away from not being.
 *
 * This is a SWEEP, not two cases. The population is derived from the bundle's
 * own `skills:` frontmatter, so a ninth seat added tomorrow is covered the day
 * it lands — the fix that holds is never the one that names the files that were
 * wrong today.
 *
 * The aggregation doc `phases/review-seats.md` is the single deliberate
 * exception, and it has to earn it in writing: its block annotates every field
 * with aggregation semantics the contract does not carry. It used to live in
 * the `review-coordinator` agent; since #678 the review fans out from the main
 * session and the exception moved with the rule. It is not an agent, so the
 * sweep below cannot reach it — it gets its own case.
 */

function frontmatter(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

const SEATS = CORE_BUNDLE
  .filter((e) => e.category === "agent")
  .filter((e) => /^skills:.*review-findings-contract/m.test(frontmatter(e.content)))
  .map((e) => ({ name: e.name, content: e.content }));

const AGGREGATION = CORE_BUNDLE.find(
  (e) => e.category === "phase" && e.name === "task" && e.suffix === "review-seats.md",
);

Deno.test("the seat population is derived, and is not empty", () => {
  // Without this the sweep below passes over nothing — the failure mode every
  // guard in this repository keeps rediscovering. Six since #678: five experts
  // and code-reviewer. A population count, not a weaker guard.
  assert(SEATS.length >= 6, `only ${SEATS.length} seats preload the contract`);
});

Deno.test("the aggregation's restated pass rule keeps the seats clause, and says why it restates", () => {
  assert(AGGREGATION, "phases/review-seats.md missing from CORE_BUNDLE");
  assertExemptRestatement("phases/review-seats.md", AGGREGATION.content);
});

/**
 * The exemption is not "this file may drift". It must still carry the
 * clause IN ITS PASS RULE, and it must say why it restates at all.
 *
 * Scoping to the rule is load-bearing, and was found the hard way: the
 * first version searched the whole file, so the justification paragraph
 * — which names the clause in prose — satisfied the assertion on its
 * own. Deleting the clause from the actual rule left the guard green.
 * An assertion answering a question adjacent to the one asked is the
 * same defect this whole ticket removes.
 */
function assertExemptRestatement(name: string, content: string): void {
  const flat = content.replace(/\s+/g, " ");
  const rule = flat.match(/`?REVIEW_VERDICT: ?`?pass`? only when[\s\S]{0,320}/)?.[0] ?? "";
  assert(rule.length > 0, `${name} is exempt but states no pass rule at all`);
  assert(
    rule.includes("SEATS_REPORTED < SEATS_EXPECTED") ||
      rule.includes("SEATS_REPORTED == SEATS_EXPECTED") ||
      rule.includes("every required seat reported"),
    `${name} is exempt from the no-restatement rule but its PASS RULE dropped ` +
      `the seats clause. Naming the clause elsewhere in the file does not count — ` +
      `the rule is what a reader follows.`,
  );
  assert(
    flat.includes("restated here on purpose"),
    `${name} restates the block without the written justification #565 requires`,
  );
}

for (const seat of SEATS) {
  Deno.test(`seat "${seat.name}" does not spell its own pass rule`, () => {
    const flat = seat.content.replace(/\s+/g, " ");
    const states = /`?REVIEW_VERDICT: ?`?pass`? only when/.test(flat);
    assert(
      !states,
      `${seat.name} states its own pass rule. The rule's home is ` +
        `review-findings-contract; a second spelling drifts from it one clause ` +
        `at a time, which is exactly how the SEATS_REPORTED clause was lost.`,
    );
  });
}
