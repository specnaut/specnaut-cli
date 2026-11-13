import { assertEquals, assertRejects } from "@std/assert";
import { exportBranchTree } from "../../src/application/untrusted_review.ts";
import { DEFAULT_TREE_CAPS, TreeRefused } from "../../src/domain/tree_plan.ts";
import { FsExportStore } from "../../src/infrastructure/fs_tree_export.ts";
import { cacheEntries, depsOf, fetcherOf, withWorld, type World } from "../helpers/export_world.ts";
import { blob, commit, mktree, type RawEntry } from "../helpers/git_fixture.ts";

/**
 * Trees made of few objects that expand past the shipped caps (`DEFAULT_TREE_CAPS`), on every OS:
 * one step over a cap exports nothing; the same shape at the cap is admitted. The one at the cap
 * is planned and not written, as writing a hundred thousand files or a quarter gigabyte twice
 * would prove nothing more about the caps.
 */

const MIB = 2 ** 20;

/** Exactly `n` entries: folders sharing one folder of 1000 files, the rest files at the root. */
async function entries(repo: string, n: number): Promise<string> {
  const id = await blob(repo, "x\n");
  const files: RawEntry[] = Array.from({ length: 1000 }, (_, i) => ["100644", `f${i}`, id]);
  const folder = await mktree(repo, files);
  const dirs = Math.floor(n / 1001);
  const rest = Array.from(
    { length: n - dirs * 1001 },
    (_, i) => ["100644", `r${i}`, id] as RawEntry,
  );
  return await mktree(repo, [
    ...Array.from({ length: dirs }, (_, i) => ["40000", `d${i}`, folder] as RawEntry),
    ...rest,
  ]);
}

/**
 * Exactly `n` bytes read: one 1 MiB file named many times and a remainder file, plus the root
 * tree itself, whose entries are 32 bytes each (`100644 `, a four-character name, NUL, the id).
 */
async function bytes(repo: string, n: number): Promise<string> {
  const copies = Math.floor(n / MIB) - 1;
  const tree = (copies + 1) * 32;
  const id = await blob(repo, new Uint8Array(MIB));
  const names: RawEntry[] = Array.from(
    { length: copies },
    (_, i) => ["100644", `f${String(i).padStart(3, "0")}`, id],
  );
  const rest = await blob(repo, new Uint8Array(n - copies * MIB - tree));
  return await mktree(repo, [...names, ["100644", "rest", rest]]);
}

/** A file whose path is `n` names long: `n - 1` nested folders, then the file. */
async function depth(repo: string, n: number): Promise<string> {
  let tree = await mktree(repo, [["100644", "leaf", await blob(repo, "x\n")]]);
  for (let i = 1; i < n; i++) tree = await mktree(repo, [["40000", "d", tree]]);
  return tree;
}

const CAPS = DEFAULT_TREE_CAPS;
const BOMBS = [
  {
    what: "entries",
    build: entries,
    cap: CAPS.entries,
    fault: `more than ${CAPS.entries} entries`,
  },
  { what: "bytes", build: bytes, cap: CAPS.bytes, fault: `more than ${CAPS.bytes} bytes` },
  { what: "depth", build: depth, cap: CAPS.depth, fault: `deeper than ${CAPS.depth} folders` },
] as const;

/** The export of `head` through the real planner and caps, its copies left unwritten. */
function planned(w: World, head: string) {
  const deps = depsOf(w, fetcherOf(w, head));
  const store = () =>
    Object.assign(new FsExportStore(w.project, w.cache), {
      write: () => Promise.resolve(),
      verify: () => Promise.resolve(),
    });
  return exportBranchTree({ ...deps, store }, { source: "origin/topic" });
}

for (const bomb of BOMBS) {
  Deno.test(`isolation: one step past the ${bomb.what} cap exports nothing; at it, it is admitted`, () =>
    withWorld(async (w) => {
      const at = await planned(w, await commit(w.repo, await bomb.build(w.repo, bomb.cap)));
      await at.remove();
      const over = await commit(w.repo, await bomb.build(w.repo, bomb.cap + 1));
      const run = () => exportBranchTree(depsOf(w, fetcherOf(w, over)), { source: "origin/topic" });
      const err = await assertRejects(run, TreeRefused);
      assertEquals(err.faults.length, 1);
      assertEquals(err.faults[0].endsWith(bomb.fault), true, err.faults[0]);
      assertEquals(await cacheEntries(w), []);
    }));
}
