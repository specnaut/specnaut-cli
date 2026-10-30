import { assert } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * monorepo#28 — a review seat's own `SEATS_REPORTED` count is taken on trust.
 *
 * `review-findings-contract` now requires `EVIDENCE` on a clean report, and the
 * review aggregation (`phases/review-seats.md`) counts a clean seat that names
 * none as `NOT RUN`. That check only works if EVERY seat knows to emit the
 * field: an aggregation enforcing it against seats that never learned about it
 * fails every honest review.
 *
 * monorepo#23 shipped exactly that mistake — two contract fields added and
 * ported to two of eight seats. It was caught by writing a SWEEP over every
 * seat rather than a case for the seat under discussion, which is why this file
 * derives its subjects from the bundle's own `skills:` frontmatter instead of
 * listing them. A ninth seat added tomorrow is covered on the day it lands.
 */

function frontmatter(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  assert(m, "expected a leading YAML frontmatter block");
  return m[1];
}

/** Every bundled agent that preloads `review-findings-contract`. */
const SEATS = CORE_BUNDLE
  .filter((e) => e.category === "agent")
  .filter((e) => {
    const line = frontmatter(e.content)
      .split("\n")
      .find((l) => /^skills:\s/.test(l));
    if (!line) return false;
    return line
      .replace(/^skills:\s*/, "")
      .split(",")
      .map((s) => s.trim())
      .includes("review-findings-contract");
  });

Deno.test("the seat sweep found seats at all", () => {
  // Without this the whole file is vacuous: a frontmatter rename would empty
  // SEATS and every assertion below would pass by iterating nothing.
  // Six since #678 (five experts + code-reviewer): a population count, not a
  // weaker guard.
  assert(
    SEATS.length >= 6,
    `expected at least 6 agents preloading review-findings-contract, found ${SEATS.length}: ` +
      SEATS.map((e) => e.name).join(", "),
  );
});

for (const seat of SEATS) {
  Deno.test(`review seat "${seat.name}" tells its agent to emit EVIDENCE`, () => {
    assert(
      seat.content.includes("EVIDENCE"),
      `${seat.name} preloads review-findings-contract but never names EVIDENCE. ` +
        `The review counts a clean report with no evidence as NOT RUN, so a ` +
        `seat that does not know about the field fails every honest review it runs.`,
    );
  });
}

Deno.test("the contract states the limit the evidence check leaves behind", () => {
  const contract = CORE_BUNDLE.find(
    (e) => e.category === "skill" && e.name === "review-findings-contract",
  );
  assert(contract, "review-findings-contract missing from CORE_BUNDLE");
  // The point of #28 is that the fix MOVES the trust boundary rather than
  // removing it. A contract that ships the check without the limit invites the
  // next reader to rediscover it — which is the habit the ticket names.
  assert(
    contract.content.includes("still written by the seat"),
    "the contract must state that EVIDENCE is still self-reported",
  );
  assert(
    contract.content.includes("did it look at all"),
    "the contract must state what the check does NOT answer",
  );
});

Deno.test("the aggregation checks a clean seat's EVIDENCE against the diff and counts it NOT RUN", () => {
  // The rule's home since #678. Without it every seat above emits EVIDENCE and
  // nothing reads it.
  const doc = CORE_BUNDLE.find(
    (e) => e.category === "phase" && e.name === "task" && e.suffix === "review-seats.md",
  );
  assert(doc, "phases/review-seats.md missing from CORE_BUNDLE");
  const flat = doc.content.replace(/\s+/g, " ");
  assert(flat.includes("git diff --name-only <base>..HEAD"), "checked against the diff");
  assert(flat.includes("NOT RUN: clean verdict, no evidence"), "named NOT RUN in TOP_ISSUES");
  assert(flat.includes("Count it as **zero** towards `SEATS_REPORTED`"), "counted as zero");
});
