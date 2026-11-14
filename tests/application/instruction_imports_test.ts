import { assertEquals } from "@std/assert";
import { readImports } from "../../src/application/instruction_imports.ts";
import type { BaseFile, GitObjectReader } from "../../src/application/script_trust_ports.ts";
import { IMPORT_REASON } from "../../src/domain/claude_imports.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";

/**
 * The import walk's start: a judged file that is a link is followed to its end at that commit, the
 * end's folder is where its imports are read from, and an end HEAD cannot read is named.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const BASE = { head: "H", tip: "T", mergeBase: "M" };

/** A reader of `files` by commit and path; nothing else is asked of it. */
function reader(files: Record<string, Record<string, string | "link">>): GitObjectReader {
  const readFile = (commit: string, path: string): Promise<BaseFile> => {
    const at = files[commit]?.[path];
    if (at === undefined) return Promise.resolve({ kind: "absent" });
    if (at === "link") return Promise.resolve({ kind: "not_regular" });
    return Promise.resolve({ kind: "blob", bytes: enc(at) });
  };
  return { readFile } as unknown as GitObjectReader;
}

const link = (path: string, target: string): BaseEntry => ({ kind: "link", path, target });

Deno.test("a linked CLAUDE.md imports from its end's folder", async () => {
  const git = reader({ H: { "docs/main.md": "@notes.md", "docs/notes.md": "x" } });
  const read = await readImports(git, BASE, { head: [link("CLAUDE.md", "docs/main.md")], tip: [] });
  assertEquals([...read.files.keys()], ["docs/notes.md"]);
  assertEquals(read.reasons, []);
});

Deno.test("a linked CLAUDE.md whose end HEAD cannot read is named, never skipped", async () => {
  const git = reader({ H: { "chain.md": "link" } });
  for (const target of ["gone.md", "chain.md", "../../outside.md", "/etc/rules.md"]) {
    const read = await readImports(git, BASE, { head: [link("CLAUDE.md", target)], tip: [] });
    assertEquals(read.reasons, [{ path: "CLAUDE.md", reason: IMPORT_REASON.linkEnd }], target);
  }
});

Deno.test("the tip's link to an end it cannot read is only nothing to follow", async () => {
  const read = await readImports(reader({}), BASE, {
    head: [],
    tip: [link("CLAUDE.md", "gone.md")],
  });
  assertEquals(read.reasons, []);
});
