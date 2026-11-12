import { assert, assertStringIncludes } from "@std/assert";
import { CONFIG_INPUTS } from "../../src/domain/config_trust.ts";
import { flat } from "./task_docs.ts";

/**
 * The helper-script gate outside review and merge: resume, groom, the backlog verbs and audit run
 * it before their first script of the tree, with the review's wording, and every config class the
 * verifier judges has a row saying what its untrusted line means, read where the input is read.
 */

const read = (rel: string) =>
  Deno.readTextFileSync(new URL(`../../templates/core/skills/task/${rel}`, import.meta.url));
const gate = () => read("phases/script-gate.md");

Deno.test("the gate block verifies first and words a refusal as the review does", () => {
  const g = gate();
  const block = g.split("<!-- script-gate: verify-scripts -->")[1];
  assert(block !== undefined, "script-gate.md lost its anchor");
  assert(block.indexOf("specnaut verify-scripts") < block.indexOf("SCRIPTS TRUSTED"));
  const review = read("phases/review.md");
  for (
    const line of [
      '[ "$last" = "VERDICT scripts trusted" ]',
      "SCRIPTS NOT RUN: verify-scripts exit $rc",
    ]
  ) {
    assertStringIncludes(block, line);
    assertStringIncludes(review, line);
  }
  assertStringIncludes(flat(g), "Never fall back to a script of the tree");
});

Deno.test("the router sends resume, groom, the backlog verbs and audit through the gate", () => {
  const routing = flat(read("SKILL.md"));
  assertStringIncludes(
    routing,
    "For `resume`, `groom`, `audit` and every verb of `backlog.md`, also read " +
      "`phases/script-gate.md` and run its gate before the verb's first script of the tree",
  );
  assertStringIncludes(
    routing,
    "| `phases/script-gate.md` | `resume`, `groom`, `audit` and the backlog verbs",
  );
});

Deno.test("resume runs the gate before its first script, and reads its link only under it", () => {
  const r = read("resume.md");
  const at = r.indexOf("phases/script-gate.md");
  assert(at >= 0 && at < r.indexOf("view.sh") && at < r.indexOf("wip-audit.sh"));
  assertStringIncludes(
    flat(r),
    "Read it only when the gate printed `VERDICT linked-issue trusted`",
  );
});

Deno.test("audit runs the gate before the map and the scope, and takes --diff's base from it", () => {
  const a = read("phases/audit.md");
  const at = a.indexOf("phases/script-gate.md");
  assert(
    at >= 0 && at < a.indexOf("specnaut scan --format") && at < a.indexOf("collect-audit-scope.sh"),
  );
  assert(!a.includes("git-read.sh base"), "audit.md still reads its base from the tree");
  assertStringIncludes(flat(a), "`VERDICT size-limits trusted` for the map below to run");
});

Deno.test("every config class has a row in the gate doc", () => {
  const g = gate();
  for (const input of CONFIG_INPUTS) assertStringIncludes(g, `| \`${input.class}\` |`);
});

Deno.test("each class is consulted where its input is read", () => {
  const where: Record<string, [string, string][]> = {
    "workflow": [["phases/auto-chain.md", "VERDICT workflow trusted"], [
      "phases/merge.md",
      "VERDICT workflow trusted",
    ]],
    "size-limits": [["phases/review-seats.md", "`size-limits` and `boundaries` lines trusted"]],
    "boundaries": [["phases/audit.md", "its `boundaries` line for the boundary check"]],
    "backlog-repo": [["phases/merge.md", "VERDICT backlog-repo trusted"], [
      "resume.md",
      "VERDICT backlog-repo trusted",
    ]],
    "linked-issue": [["phases/merge.md", "VERDICT linked-issue trusted"]],
    "gates": [["phases/merge.md", "VERDICT gates trusted"], [
      "phases/review-seats.md",
      "VERDICT gates trusted",
    ]],
  };
  for (const input of CONFIG_INPUTS) {
    assert(where[input.class], `no reader pinned for ${input.class}`);
    for (const [doc, text] of where[input.class]) assertStringIncludes(flat(read(doc)), text, doc);
  }
});
