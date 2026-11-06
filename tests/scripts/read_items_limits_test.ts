import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { project } from "./backlog_tracker_fixture.ts";
import { answer, ghIssue, gitProject, readItems, removeRead } from "./read_items_fixture.ts";

/**
 * `read-items.sh`'s limits: the fingerprint it records, the cap on each
 * field, and the arguments it refuses before any tracker is reached. Real
 * scripts, a stand-in `gh` that answers one GraphQL issue per number.
 */

Deno.test("read-items: the fingerprint follows the work tree", async () => {
  const p = await gitProject("github");
  const reads = [];
  try {
    await answer(p, 7, ghIssue({ body: "Plain." }));
    reads.push((await readItems(p, ["edit", "--id", "7"])).read);
    reads.push((await readItems(p, ["edit", "--id", "7"])).read);
    await p.write("new-file.txt", "x\n");
    reads.push((await readItems(p, ["edit", "--id", "7"])).read);
    assertEquals(reads[0]?.fingerprint, reads[1]?.fingerprint);
    assertNotEquals(reads[1]?.fingerprint, reads[2]?.fingerprint);
  } finally {
    for (const r of reads) await removeRead(r);
    await p.cleanup();
  }
});

Deno.test("read-items: a field past its cap is cut, and its tag says so", async () => {
  const p = await gitProject("github");
  await answer(p, 7, ghIssue({ body: "é".repeat(70000), title: "t".repeat(600) }));
  const { r, read } = await readItems(p, ["edit", "--id", "7"]);
  try {
    assertEquals(r.code, 0, r.stderr);
    const by = (f: string) => read!.blocks.find((b) => b.field === f)!;
    assertEquals([by("body").truncated, by("body").value.length], [true, 65536]);
    assertEquals([by("title").truncated, by("title").value.length], [true, 512]);
  } finally {
    await removeRead(read);
    await p.cleanup();
  }
});

Deno.test("read-items: a refused argument prints nothing and reaches no tracker", async () => {
  const p = await gitProject("github");
  try {
    await answer(p, 7, ghIssue({ body: "Plain." }));
    for (
      const args of [
        [],
        ["Groom", "7"],
        ["groom;id", "7"],
        ["edit", "--id", "@/etc/hosts"],
        ["edit", "https://github.com/acme/other/issues/7"],
        ["groom", "--status", "Ready", "7"],
        ["groom", "--status", "Re\x1bady"],
        ["groom", "--repo", "acme/other", "7"],
        ["groom"],
      ]
    ) {
      const r = await p.run("read-items.sh", args);
      assertEquals([r.code, r.stdout], [2, ""], `${JSON.stringify(args)}\n${r.stderr}`);
      assert(!r.calls.includes("graphql"), `${JSON.stringify(args)} reached gh:\n${r.calls}`);
    }
  } finally {
    await p.cleanup();
  }
});

Deno.test("read-items: outside a git work tree there is no fingerprint, and nothing is read", async () => {
  const p = await project("github");
  try {
    await answer(p, 7, ghIssue({ body: "Plain." }));
    const r = await p.run("read-items.sh", ["edit", "--id", "7"]);
    assertEquals([r.code, r.stdout], [2, ""], r.stderr);
    assertStringIncludes(r.stderr, "not a git work tree");
    assert(!r.calls.includes("graphql"), r.calls);
  } finally {
    await p.cleanup();
  }
});
