import { assert, assertEquals } from "@std/assert";
import { flat, phase } from "./task_docs.ts";
import { RUNNERS } from "../../src/domain/command_runners.ts";

/**
 * What the instruction class does not read is stated in its row of `phases/script-gate.md`'s class
 * table, so a user knows which change a trusted verdict does not cover. Each limit is pinned on the
 * row as the bundle ships it, against the code that sets it where the code holds a list.
 */

function instructionsRow(): string {
  const row = phase("script-gate").content.split("\n").find((l) =>
    l.startsWith("| `instructions` |")
  );
  assert(row !== undefined, "script-gate.md has no `instructions` row");
  return flat(row);
}

/** The row's stated limits: what follows `Not read:`, up to the cell's end. */
function notRead(): string {
  const row = instructionsRow();
  const start = row.indexOf("Not read: ");
  assert(start >= 0, "the `instructions` row states no limit");
  return row.slice(start, row.indexOf(" | ", start));
}

Deno.test("the row names every runner whose manifest is read, and says no other's is", () => {
  const limits = notRead();
  assert(limits.includes("the manifest of a runner other than"), limits);
  const missing = [...RUNNERS.keys()].filter((name) => !limits.includes(`\`${name}\``));
  assertEquals(missing, [], "a runner the judge reads is not named in the stated limit");
});
