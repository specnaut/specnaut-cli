import { assert, assertEquals } from "@std/assert";
import { ghIssue, ghProject, jsonl, readThenApply } from "./apply_plan_fixture.ts";

/**
 * Who a plan's text may @-mention: the target item's author only, as the items
 * file records it, and nobody in a new item's text. The executor reads that
 * author off the title block's tag, whatever order its attributes come in.
 */

const issues = { 7: ghIssue("Export times out", "owner") };
const comment = (body: string) => jsonl({ op: "comment", target: 7, body });

/** The title tag's attributes, author first: same facts, another order. */
async function reorderTitleTag(items: string) {
  const text = await Deno.readTextFile(items);
  const moved = text.replace(
    /^<untrusted-issue-text (nonce="[0-9a-f]+") (item="7") (field="title") (author="[^"]*")/m,
    "<untrusted-issue-text $4 $3 $1 $2",
  );
  assert(moved !== text, "the title tag was not found to reorder");
  await Deno.writeTextFile(items, moved);
}

Deno.test("apply-plan: the item's author is read whatever the order of the tag's attributes", async () => {
  const p = await ghProject(issues);
  try {
    const out = await readThenApply(p, ["edit", "--id", "7"], comment("Which tenant, @owner?"), {
      between: reorderTitleTag,
    });
    assertEquals([out.code, out.lines], [0, ["APPLIED comment 7", "RECEIPT: none"]], out.stderr);
  } finally {
    await p.cleanup();
  }
});
