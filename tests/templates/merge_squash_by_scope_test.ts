import { assert, assertStringIncludes } from "@std/assert";
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

Deno.test("a merge ends on the base branch, verified rather than assumed", async () => {
  // Spec 042 moved the mechanics into land-feature.sh; the rule moved with them.
  const script = await Deno.readTextFile(
    new URL("../../templates/core/specnaut/scripts/bash/land-feature.sh", import.meta.url),
  );
  assertStringIncludes(script, "git branch --quiet -d");
  // -D would paper over a merge that did not actually land.
  // Commands only: the refusal message itself says "never --force".
  const commands = script.split("\n").filter((l) => !/^\s*(#|echo )/.test(l)).join("\n");
  assert(!/branch[^\n]* -D\b|--force\b|push[^\n]* -f\b/.test(commands), "land-feature.sh forces");
  assertStringIncludes(script, 'if [ "$now" != "$base" ]');
  const { content } = mergePhase();
  assertStringIncludes(content, "bash .specnaut/scripts/bash/land-feature.sh");
  assertStringIncludes(content, "the person who asked must be back where they work");
  assertStringIncludes(content, "the merge did not land as expected: a finding");
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
  assertStringIncludes(content, "Close each one");
  assertStringIncludes(content, "cascade-check.sh");
  assertStringIncludes(content, "linked_issue");
  // Spec 042: the board half runs in close-shipped.sh, after the product-owner's close.
  assertStringIncludes(content, "bash .specnaut/scripts/backlog/close-shipped.sh");
  assertStringIncludes(content, "**only exit 0 authorises the close**");
});

// #677 — epic-status.sh reads <base>..HEAD. After land-feature.sh fast-forwards
// the base that range is empty (exit 14: "not an epic"), so the children to
// close are read before the landing and kept, never re-read after it.
Deno.test("the epic is read in a step before the landing, and the close never re-reads it", () => {
  const { content } = mergePhase();
  const stepOf = (needle: string) => {
    const at = content.indexOf(needle);
    assert(at >= 0, `merge.md no longer calls ${needle}`);
    const steps = [...content.slice(0, at).matchAll(/^(\d+)\. \*\*/gm)];
    return Number(steps.at(-1)?.[1]);
  };
  const read = stepOf("bash .specnaut/scripts/bash/epic-status.sh");
  const land = stepOf("bash .specnaut/scripts/bash/land-feature.sh");
  // Step 1: the step merge-close.md cites as where the CHILD and EPIC lines come from.
  assert(read === 1 && read < land, `epic-status.sh at step ${read}, land-feature.sh at ${land}`);
  const close = closeDoc().content;
  assert(
    !close.includes("bash .specnaut/scripts/bash/epic-status.sh"),
    "merge-close.md re-runs it",
  );
  assertStringIncludes(close, "printed at `phases/merge.md` step 1, before the landing");
});
