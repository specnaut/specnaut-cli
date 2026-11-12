import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { exportBranchTree } from "../../src/application/untrusted_review.ts";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import type { TreeObjects } from "../../src/application/untrusted_review_ports.ts";
import type { BranchSource } from "../../src/domain/branch_source.ts";
import { TreeRefused } from "../../src/domain/tree_plan.ts";
import { blob, commit, git, type RawEntry, tree } from "../helpers/git_fixture.ts";
import {
  cacheEntries,
  depsOf,
  exists,
  exportOf,
  fetcherOf,
  withWorld,
} from "../helpers/export_world.ts";

const mode = async (p: string) => (await Deno.lstat(p)).mode! & 0o777;
const posix = Deno.build.os !== "windows";

/** Any commit-shaped id: a submodule entry names a commit the tree does not hold. */
const head0 = () => "0123456789abcdef0123456789abcdef01234567";

Deno.test("a tree is written twice, inert, and what is not a plain file is only listed", () =>
  withWorld(async (w) => {
    const [text, script, note] = await Promise.all(
      ["text\n", "#!/bin/sh\necho hi\n", "agent rules\n"].map((c) => blob(w.repo, c)),
    );
    const claudeDir = await tree(w.repo, [["100644", "settings.json", note]]);
    const src = await tree(w.repo, [["100644", "a.ts", text], ["100644", "AGENTS.md", note]]);
    const { head, run } = await exportOf(w, [
      ["100644", "README.md", text],
      ["100755", "run.sh", script],
      ["40000", "src", src],
      ["100644", "CLAUDE.md", note],
      ["40000", ".claude", claudeDir],
      ["120000", "link", text],
      ["160000", "vendor", head0()],
    ]);
    const out = await run();
    assertEquals(out.sha, head);
    assertEquals(out.root, join(await Deno.realPath(w.cache), head));
    for (const copy of [out.seats, out.scratch]) {
      assertEquals(await Deno.readTextFile(join(copy, "src", "a.ts")), "text\n");
      assertEquals(await Deno.readTextFile(join(copy, "run.sh")), "#!/bin/sh\necho hi\n");
      for (const absent of ["CLAUDE.md", ".claude", "link", "vendor", "src/AGENTS.md"]) {
        assertEquals(await exists(join(copy, absent)), false, `${absent} was materialised`);
      }
    }
    if (posix) {
      assertEquals(
        await mode(join(out.seats, "run.sh")),
        0o644,
        "the reviewers' copy runs nothing",
      );
      assertEquals(await mode(join(out.scratch, "run.sh")), 0o755, "the scratch copy keeps +x");
      assertEquals(await mode(join(out.seats, "README.md")), 0o644);
    }
    assertEquals(out.listed.map((l) => [l.path, l.kind, l.sha]), [
      ["CLAUDE.md", "instruction", note],
      ["link", "link", text],
      ["vendor", "submodule", head0()],
      ["src/AGENTS.md", "instruction", note],
      [".claude/settings.json", "instruction", note],
    ]);
    await out.remove();
    assertEquals(await exists(out.root), false);
  }));

Deno.test("case-fold twins write nothing", () =>
  withWorld(async (w) => {
    const id = await blob(w.repo, "x\n");
    const { run } = await exportOf(w, [["100644", "Makefile", id], ["100644", "makefile", id]]);
    const err = await assertRejects(run, TreeRefused);
    assertEquals(err.faults[0].includes("twin"), true);
    assertEquals(await cacheEntries(w), []);
  }));

Deno.test("a tree that repeats one subtree stops at the entry cap before it is read whole", () =>
  withWorld(async (w) => {
    let level = await tree(w.repo, [["100644", "f", await blob(w.repo, "x")]]);
    for (let depth = 0; depth < 6; depth++) {
      const fan: RawEntry[] = Array.from({ length: 10 }, (_, i) => ["40000", `d${i}`, level]);
      level = await tree(w.repo, fan);
    }
    const { run } = await exportOf(w, [["40000", "bomb", level]], { entries: 5_000 });
    const err = await assertRejects(run, TreeRefused);
    assertEquals(err.faults, ["the tree holds more than 5000 entries"]);
    assertEquals(await cacheEntries(w), []);
  }));

Deno.test("the byte and depth caps refuse before any write", () =>
  withWorld(async (w) => {
    const id = await blob(w.repo, "0123456789");
    const wide = await exportOf(w, [["100644", "a", id], ["100644", "b", id]], { bytes: 70 });
    // 58 bytes of tree, then one 10-byte blob charged for each of its two names.
    const err = await assertRejects(wide.run, TreeRefused);
    assertEquals(err.faults, ["the tree holds more than 70 bytes"]);
    let nested = await tree(w.repo, [["100644", "f", id]]);
    for (const d of ["c", "b", "a"]) nested = await tree(w.repo, [["40000", d, nested]]);
    const deep = await exportOf(w, [["40000", "top", nested]], { depth: 4 });
    assertEquals((await assertRejects(deep.run, TreeRefused)).faults, [
      "top/a/b/c/f: deeper than 4 folders",
    ]);
    assertEquals(await cacheEntries(w), []);
  }));

Deno.test("a fetched id that is not a full commit id is refused before it names a path", () =>
  withWorld(async (w) => {
    const run = exportBranchTree(depsOf(w, fetcherOf(w, "../../escape")), { source: "origin/x" });
    await assertRejects(() => run, ExportRefused, "no full commit id");
    assertEquals(await cacheEntries(w), []);
    assertEquals(await exists(join(w.cache, "..", "..", "escape")), false);
  }));

Deno.test("a head other than the one expected is refused, and nothing is left", () =>
  withWorld(async (w) => {
    const { head } = await exportOf(w, [["100644", "a", await blob(w.repo, "x")]]);
    const request = { source: "origin/topic", expectedSha: "f".repeat(40) };
    const run = () => exportBranchTree(depsOf(w, fetcherOf(w, head)), request);
    await assertRejects(run, ExportRefused, `the fetched head is ${head}`);
    assertEquals(await cacheEntries(w), []);
  }));

Deno.test("a URL is refused before anything is fetched", () =>
  withWorld(async (w) => {
    const calls: BranchSource[] = [];
    const fetcher = fetcherOf(w, "a".repeat(40), calls);
    const run = () => exportBranchTree(depsOf(w, fetcher), { source: "https://example.com/x.git" });
    await assertRejects(run, ExportRefused, "URL or a path");
    assertEquals(calls, []);
  }));

Deno.test("a repeated subtree's bytes are charged each time it appears, not once", () =>
  withWorld(async (w) => {
    const sub = await tree(w.repo, [["100644", "f", await blob(w.repo, "x")]]);
    const entries: RawEntry[] = Array.from({ length: 10 }, (_, i) => ["40000", `d${i}`, sub]);
    const size = async (id: string) => Number(await git(w.repo, ["cat-file", "-s", id]));
    // Enough for the root, the subtree read once, and the ten one-byte files: not for ten reads.
    const once = await size(await tree(w.repo, entries)) + await size(sub) + 10;
    const { run } = await exportOf(w, entries, { bytes: once });
    const err = await assertRejects(run, TreeRefused);
    assertEquals(err.faults, [`the tree holds more than ${once} bytes`]);
  }));

Deno.test("bytes that differ from the commit are caught by the re-hash, and nothing is left", () =>
  withWorld(async (w) => {
    const head = await commit(
      w.repo,
      await tree(w.repo, [["100644", "a", await blob(w.repo, "x")]]),
    );
    const base = depsOf(w, fetcherOf(w, head));
    const objects = (gitDir: string): TreeObjects => {
      const real = base.objects(gitDir);
      return {
        treeOf: (c) => real.treeOf(c),
        sizes: (ids, type) => real.sizes(ids, type),
        readTrees: (ids) => real.readTrees(ids),
        readBlobs: async (ids) =>
          new Map([...(await real.readBlobs(ids)).keys()].map((id) => [id, new Uint8Array([1])])),
      };
    };
    const run = () => exportBranchTree({ ...base, objects }, { source: "origin/topic" });
    await assertRejects(run, ExportRefused, "differs from the commit");
    assertEquals(await cacheEntries(w), []);
  }));
