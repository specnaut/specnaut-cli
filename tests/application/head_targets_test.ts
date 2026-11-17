import { assertEquals } from "@std/assert";
import { targetWalk, visit } from "../../src/application/head_targets.ts";
import type { BaseFile, GitObjectReader } from "../../src/application/script_trust_ports.ts";

/** The walk's visit of one target: its twins visited, each path once, however they name each other. */

const enc = (s: string) => new TextEncoder().encode(s);
const BASE = { head: "H", tip: "T", mergeBase: "M" };

/** HEAD holds `paths`; past `limit` reads the walk is not ending, and the reader says so. */
function reader(paths: string[], limit = 200): GitObjectReader {
  let reads = 0;
  const readFile = (commit: string, path: string): Promise<BaseFile> => {
    if (++reads > limit) return Promise.reject(new Error("the walk does not end"));
    const held = commit === "H" && paths.includes(path);
    return Promise.resolve(held ? { kind: "blob", bytes: enc(path) } : { kind: "absent" });
  };
  const listPaths = (commit: string) =>
    Promise.resolve(commit === "H" ? paths.map((path) => ({ path, kind: "blob" })) : []);
  return { projectPrefix: "", readFile, listPaths } as unknown as GitObjectReader;
}

Deno.test("two twins naming each other are each visited once", async () => {
  const walk = targetWalk(reader(["docs/A.md", "docs/a.md"]), BASE);
  assertEquals(await visit(walk, "docs/A.md"), ["docs/A.md", "docs/a.md"]);
  assertEquals(await visit(walk, "docs/a.md"), []);
  assertEquals([...walk.files.keys()], ["docs/A.md", "docs/a.md"]);
});
