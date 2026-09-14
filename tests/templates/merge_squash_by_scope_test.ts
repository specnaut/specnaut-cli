import { assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * #459 — squash BY SCOPE at merge, not one commit per branch.
 *
 * A branch usually carries more than one kind of change, and collapsing them
 * into a single commit destroys the thing squashing exists to produce: a
 * history a human can read. The locks below pin the parts that a later edit
 * would plausibly "simplify" away, each of which is load-bearing:
 *
 *   - staging BY NAME rather than `git add -A` — the sweep is how a squash
 *     silently becomes a rewrite;
 *   - the byte-identical diff check — the only thing that catches it;
 *   - not stopping to have the grouping approved — asking for the merge IS
 *     asking for the squash, and a confirmation there splits one instruction
 *     into two prompts at the end of a chain;
 *   - a pre-existing fix keeping ITS OWN backlog id — inheriting the feature's
 *     attributes work to an item that never asked for it.
 */

/**
 * #558 moved this section out of `merge.md` into a companion doc, because
 * `merge.md` emitted at 11,960 characters against a 12,000 cap and three
 * siblings under #552 needed room to write. The rules did not change — only
 * where they live — so every assertion below is re-anchored verbatim rather
 * than relaxed. An extraction that quietly loosens its own guard is how a
 * "no behaviour change" refactor stops being one.
 */
function squashDoc(): CoreEntry {
  const e = CORE_BUNDLE.find((x) => x.category === "phase" && skillDocName(x) === "merge-squash");
  if (!e) throw new Error("missing merge-squash phase entry");
  return e;
}

function mergePhase(): CoreEntry {
  const e = CORE_BUNDLE.find((x) => x.category === "phase" && skillDocName(x) === "merge");
  if (!e) throw new Error("missing merge phase entry");
  return e;
}

Deno.test("merge.md still routes to the close step it no longer contains", () => {
  const { content } = mergePhase();
  assertStringIncludes(content, "phases/merge-close.md");
});

Deno.test("merge.md still routes to the squash rules it no longer contains", () => {
  // The load-bearing half of the extraction. A companion doc nobody loads is
  // a deletion, and the pointer is the only thing that makes the move a move.
  const { content } = mergePhase();
  assertStringIncludes(content, "phases/merge-squash.md");
  assertStringIncludes(content, "Squash by scope");
});

Deno.test("merge squashes by scope, and says it is not one commit per branch", () => {
  const { content } = squashDoc();
  assertStringIncludes(content, "one commit per scope");
  assertStringIncludes(content, 'never "exactly one commit"');
  assertStringIncludes(content, "a history a human can read");
  // Every scope in the routing table.
  for (const scope of ["chore(codegen)", "ci(", "docs(", "pre-existing"]) {
    assertStringIncludes(content, scope, `the scope table must route ${scope}`);
  }
});

Deno.test("the backlog id sits in the scope position, and a pre-existing fix keeps its own", () => {
  const { content } = squashDoc();
  assertStringIncludes(content, "scope position");
  assertStringIncludes(content, "never the feature's");
  assertStringIncludes(content, "never asked for it");
});

Deno.test("the squash stages by name and verifies the tree did not move", () => {
  const { content } = squashDoc();
  assertStringIncludes(content, "reset --soft");
  assertStringIncludes(content, "by name");
  assertStringIncludes(content, "Never `git add -A`");
  // The check that distinguishes a squash from a rewrite.
  assertStringIncludes(content, "byte-identical");
  assertStringIncludes(content, "not a squash, it is a rewrite");
  // Untracked output is classified, never reported over.
  assertStringIncludes(content, "never report success over it");
});

Deno.test("merge does not stop to have the grouping approved", () => {
  const { content } = squashDoc();
  assertStringIncludes(content, "Do not stop between steps 2 and 3");
  assertStringIncludes(content, "Asking for the merge *is* asking for the squash");
  // The one legitimate halt, scoped to the files that caused it.
  assertStringIncludes(content, "those files only");
});

Deno.test("merge documents the protected-branch limit and refuses the forge squash button", () => {
  const { content } = squashDoc();
  assertStringIncludes(content, "protected");
  assertStringIncludes(content, '"Squash and merge"');
});

Deno.test("a merge ends on the base branch, verified rather than assumed", () => {
  const { content } = mergePhase();
  assertStringIncludes(content, "End on the base branch");
  assertStringIncludes(content, "rev-parse --abbrev-ref HEAD");
  // -D would paper over a merge that did not actually land.
  assertStringIncludes(content, "never `-D`");
  assertStringIncludes(content, "a finding, not an obstacle");
});

function closeDoc(): CoreEntry {
  const e = CORE_BUNDLE.find((x) => x.category === "phase" && skillDocName(x) === "merge-close");
  if (!e) throw new Error("missing merge-close phase entry");
  return e;
}

// #560 moved the close + reconcile block into a companion, for the same reason
// #558 moved squash-by-scope: `merge.md` had 945 characters of headroom and the
// epic path needed more than that. Re-anchored verbatim, not relaxed.
Deno.test("merge keeps the backlog close step intact", () => {
  const { content } = closeDoc();
  assertStringIncludes(content, "Close the linked backlog issue");
  assertStringIncludes(content, "cascade-check.sh");
  assertStringIncludes(content, "linked_issue");
});
