import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import { GitTreeObjects, parseTree } from "../../src/infrastructure/git_tree_objects.ts";
import { blob, commit, initRepo, tempDir, tree } from "../helpers/git_fixture.ts";

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("a tree object's names arrive as the raw bytes git stores", () => {
  const id = new Uint8Array(20).fill(0xab);
  const bytes = new Uint8Array([...enc("100644 a b"), 0xff, 0, ...id, ...enc("40000 d"), 0, ...id]);
  const entries = parseTree(bytes, 20);
  assertEquals(entries.map((e) => [e.mode, [...e.name], e.sha]), [
    ["100644", [...enc("a b"), 0xff], "ab".repeat(20)],
    ["40000", [...enc("d")], "ab".repeat(20)],
  ]);
});

Deno.test("a truncated tree object is refused whole", () => {
  const bytes = new Uint8Array([...enc("100644 a"), 0, ...new Uint8Array(19)]);
  assertThrows(() => parseTree(bytes, 20), ExportRefused, "does not parse");
  assertThrows(() => parseTree(enc("100644 a"), 20), ExportRefused, "does not parse");
});

Deno.test("an object of the wrong type or a missing one is refused", async () => {
  const dir = await tempDir("objects-");
  try {
    const repo = await initRepo(dir);
    const id = await blob(repo, "x");
    const root = await tree(repo, [["100644", "a", id]]);
    const objects = new GitTreeObjects(join(repo, ".git"));
    assertEquals(await objects.treeOf(await commit(repo, root)), root);
    assertEquals(await objects.sizes([id], "blob"), new Map([[id, 1]]));
    await assertRejects(() => objects.sizes([id], "tree"), ExportRefused, "not a tree");
    await assertRejects(() => objects.readTrees([id]), ExportRefused, "not a tree");
    await assertRejects(() => objects.sizes(["0".repeat(40)], "blob"), ExportRefused, "missing");
    await assertRejects(() => objects.treeOf("HEAD"), ExportRefused, "full commit id");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
