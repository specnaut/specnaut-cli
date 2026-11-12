import { assert, assertEquals } from "@std/assert";
import { GH_WRITES, ghIssue, ghProject, jsonl, readThenApply } from "./apply_plan_fixture.ts";

/**
 * Who a plan's text may @-mention: the target item's author only, as the items
 * file records it, and nobody in a new item's text. The executor reads that
 * author off the title block's tag, whatever order its attributes come in.
 */

const issues = { 7: ghIssue("Export times out", "owner"), 8: ghIssue("Another", "Mixed-Case") };
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

// GitHub mentions a login after any non-word character; GitLab logins also hold `.` and `_`, and
// `@group/team` notifies a team. Each of these pings someone other than the author.
const PINGS_SOMEONE_ELSE = [
  "see x.@victim",
  "@@victim",
  "a-@victim",
  "path /@victim",
  "`@victim",
  "@owner.@victim",
  "@owner_x on GitLab",
  "@owner.name on GitLab",
  "cc @owner/team",
];

Deno.test("apply-plan: a mention in any form GitHub or GitLab reads is someone's, and only the author passes", async () => {
  const p = await ghProject(issues);
  try {
    for (const body of PINGS_SOMEONE_ELSE) {
      const out = await readThenApply(p, ["edit", "--id", "7"], comment(body));
      assertEquals([out.code, out.lines], [3, ["REFUSED mention 1.body", "RECEIPT: none"]], body);
      assert(!GH_WRITES.test(out.calls), `${body}\n${out.calls}`);
    }
    for (const body of ["Thanks @owner.", "@Owner, which tenant?", "mail a@example.com"]) {
      const out = await readThenApply(p, ["edit", "--id", "7"], comment(body));
      assertEquals([out.code, out.lines], [0, ["APPLIED comment 7", "RECEIPT: none"]], body);
    }
    // A login is case-blind on both trackers, whichever case the record carries it in.
    const mixed = jsonl({ op: "comment", target: 8, body: "Thanks @Mixed-Case." });
    const out = await readThenApply(p, ["edit", "--id", "8"], mixed);
    assertEquals([out.code, out.lines], [0, ["APPLIED comment 8", "RECEIPT: none"]], out.stderr);
  } finally {
    await p.cleanup();
  }
});
