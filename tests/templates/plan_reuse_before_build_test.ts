import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * #664 — a plan that introduces a script, helper or automation justifies it
 * against what already exists, in the decision table, before tasks exist.
 * These pin the rule's load-bearing clauses in the shipped `plan.md`.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const read = async (p: string) =>
  (await Deno.readTextFile(`${ROOT}${p}`)).replaceAll("\r\n", "\n").replace(/\s+/g, " ");

Deno.test("plan: a new helper gets a decision row with inventory, evidence and outcome", async () => {
  const plan = await read("templates/core/skills/task/phases/plan.md");
  assert(plan.includes("reuse before you build"), "the rule is present");
  assert(plan.includes("the existing helpers and commands you inventoried"), "(a) inventory");
  assert(plan.includes("the recurrence evidence"), "(b) evidence");
  for (
    const outcome of [
      "*reuse directly*",
      "*extend the existing helper at its owner*",
      "*add a new helper*",
    ]
  ) {
    assert(plan.includes(outcome), `(c) outcome ${outcome}`);
  }
});

Deno.test("plan: the evidence bar and the helper's safety clauses are written down", async () => {
  const plan = await read("templates/core/skills/task/phases/plan.md");
  assert(plan.includes("two separate prior occurrences"), "bar");
  assert(
    plan.includes("Several receipts from one repair count as one occurrence"),
    "one repair = one",
  );
  assert(plan.includes("Below the bar the outcome is *reuse directly*"), "below the bar");
  assert(
    plan.includes(
      "no arbitrary executable path, shell string, or caller-chosen argv or environment",
    ),
    "data, never code",
  );
  assert(
    plan.includes("never reports a missing, refused or skipped result as a pass"),
    "no false pass",
  );
});
