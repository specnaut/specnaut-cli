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

/**
 * The runners the row names: each code span of its runner limit, up to the `;` that ends it, the
 * manifests in parentheses aside.
 */
function runnersNamed(limits: string): string[] {
  const lead = "the manifest of a runner other than ";
  const start = limits.indexOf(lead);
  assert(start >= 0, limits);
  const clause = limits.slice(start + lead.length, limits.indexOf(";", start));
  return [...clause.replace(/\([^)]*\)/g, "").matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
}

Deno.test("the row names exactly the runners whose manifest is read, and says no other's is", () => {
  assertEquals(runnersNamed(notRead()), [...RUNNERS.keys()].sort());
});

Deno.test("the row names the commands a skill, an agent or a slash command holds", () => {
  const row = instructionsRow();
  assert(row.includes("one a skill's, an agent's or a slash command's frontmatter declares"), row);
  assert(row.includes("a skill's or a slash command's `` !`…` `` span"), row);
  assert(row.includes("span or ```` ```! ```` block (an agent's file runs neither)"), row);
  assert(row.includes("or a skill's or a slash command's `allowed-tools` grants"), row);
  assert(
    row.includes("nested in one read as one of its own (a `$(…)`, a backquote, `bash -c"),
    row,
  );
});

Deno.test("the row names the programs on a judged PATH, and the PATH a shell builds as a limit", () => {
  const row = instructionsRow();
  assert(row.includes("each program a command names by name alone in each folder a judged"), row);
  assert(row.includes("so the one a wrapper runs too (`timeout 30 lint`, `bash -c 'lint'`)"), row);
  assert(row.includes("bare or with a Windows extension (`lint.cmd`)"), row);
  assert(
    row.includes("`PATH` folder that holds a variable past its start (`./tools/$OS/bin`)"),
    row,
  );
  assert(row.includes("(`./tools/$OS/bin`) under a key or a word spelled `PATH`"), row);
  assert(row.includes("a variable alone other than `$PATH`, such as `$CLAUDE_PROJECT_DIR`"), row);
  assert(row.includes("a path with `..` after a variable (`tools/$OS/../run.sh`)"), row);
  const limits = notRead();
  assert(limits.includes("such a folder under another spelling (a key `path`"), limits);
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
