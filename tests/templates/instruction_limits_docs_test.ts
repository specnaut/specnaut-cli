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

Deno.test("the row names the commands a skill, an agent or a slash command holds", () => {
  const row = instructionsRow();
  assert(row.includes("one a skill's, an agent's or a slash command's frontmatter declares"), row);
  assert(row.includes("a skill's or a slash command's `` !`…` `` span"), row);
});

Deno.test("the row names the programs on a judged PATH, and the PATH a shell builds as a limit", () => {
  const row = instructionsRow();
  assert(row.includes("each program a command names by name alone in each folder a judged"), row);
  const limits = notRead();
  assert(limits.includes("the folders a shell puts on `PATH` before the session starts"), limits);
  assert(limits.includes("`.envrc`'s `PATH_add`, mise's configuration"), limits);
});

Deno.test("the row states what a command's targets leave unread", () => {
  const limits = notRead();
  assert(limits.includes("a folder a command names (`node server/`)"), limits);
  assert(limits.includes("what a file a command runs itself sources or runs"), limits);
  assert(limits.includes("a path whose file name is a variable alone (`scripts/$NAME`)"), limits);
  assert(limits.includes("or that names no folder before a variable (`$NAME.sh`)"), limits);
});
