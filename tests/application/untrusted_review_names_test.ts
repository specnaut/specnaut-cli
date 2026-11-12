import { assertEquals, assertRejects } from "@std/assert";
import { TreeRefused } from "../../src/domain/tree_plan.ts";
import { blob } from "../helpers/git_fixture.ts";
import { cacheEntries, exportOf, withWorld } from "../helpers/export_world.ts";

/** Each name the path validator refuses, as a crafted tree: the export writes nothing at all. */

/** A name for a test title: every byte outside printable ASCII written as an escape. */
function escaped(name: string | Uint8Array): string {
  if (typeof name !== "string") return `bytes [${[...name].join(", ")}]`;
  const shown = [...name].map((c) =>
    /[ -~]/.test(c) ? c : `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`
  );
  const text = shown.join("");
  return text.length > 40 ? `"${text.slice(0, 8)}..." (${name.length} chars)` : `"${text}"`;
}

const BAD_NAMES: ReadonlyArray<readonly [string | Uint8Array, string]> = [
  [".git", "a spelling of .git"],
  [".GIT", "a spelling of .git"],
  [".git.", "a spelling of .git"],
  ["git~1", "a spelling of .git"],
  [".g\u200cit", "a spelling of .git"],
  ["..", "a '.' or '..' step"],
  [".", "a '.' or '..' step"],
  ["", "an empty name"],
  ["a/b", "a path separator"],
  ["..\\x", "a path separator"],
  [new Uint8Array([0x61, 0xff]), "a name that is not UTF-8"],
  ["a\x01b", "a control character"],
  ["a\nb", "a control character"],
  ["x".repeat(256), "a name over 255 bytes"],
];

for (const [name, reason] of BAD_NAMES) {
  Deno.test(`a tree naming ${escaped(name)} writes nothing`, () =>
    withWorld(async (w) => {
      const id = await blob(w.repo, "payload\n");
      const { run } = await exportOf(w, [["100644", "ok.txt", id], ["100644", name, id]]);
      const err = await assertRejects(run, TreeRefused);
      assertEquals(err.faults.length, 1);
      assertEquals(err.faults[0].endsWith(`: ${reason}`), true, err.faults[0]);
      assertEquals(await cacheEntries(w), []);
    }));
}
