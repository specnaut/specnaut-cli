import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import { GitBranchFetcher } from "../../src/infrastructure/git_branch_fetch.ts";
import { GitTreeObjects } from "../../src/infrastructure/git_tree_objects.ts";
import { blob, commit, git, initRepo, tempDir, tree } from "../helpers/git_fixture.ts";
import { callerPath, plantGit, ran, withPath } from "../helpers/planted_git.ts";

/**
 * A fetch starts git in the project and in the repository it fills, a cache outside the project,
 * and reads that cache's objects later: in every one, the PATH is kept outside the project's tree,
 * which is where a branch could have put a `git`.
 */

type Planted = { base: string; project: string; bin: string; head: string; fired: string };

/** A remote with a `topic` branch, and a project whose `bin` holds a git that leaves a mark. */
async function planted(base: string): Promise<Planted> {
  const [remote, project] = ["remote", "project"].map((d) => join(base, d));
  for (const d of [remote, project]) await Deno.mkdir(d);
  await initRepo(remote);
  const head = await commit(remote, await tree(remote, [["100644", "a", await blob(remote, "a")]]));
  await git(remote, ["update-ref", "refs/heads/topic", head]);
  await initRepo(project);
  await git(project, ["remote", "add", "origin", remote]);
  const [bin, fired] = [join(project, "bin"), join(base, "fired")];
  await plantGit(bin, fired);
  return { base, project, bin, head, fired };
}

/** `fn` given a planted world, removed after; Windows cannot run the planted script. */
function inPlanted(name: string, fn: (p: Planted) => Promise<void>) {
  Deno.test({
    name,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      const base = await tempDir("fetch-path-");
      try {
        await fn(await planted(base));
      } finally {
        await Deno.remove(base, { recursive: true });
      }
    },
  });
}

const TOPIC = { kind: "ref", remote: "origin", branch: "topic" } as const;

inPlanted("a fetch, and the cache it fills, never start a git the project supplies", async (p) => {
  const out = join(p.base, "out.git");
  await withPath([p.bin, ...callerPath()], async () => {
    const fetcher = new GitBranchFetcher(p.project, { protocols: ["file"] });
    assertEquals(await fetcher.fetch(TOPIC, out), p.head);
    const objects = new GitTreeObjects(out, p.project);
    assertEquals((await objects.treeOf(p.head)).length, 40);
  });
  assertEquals(await ran(p.fired), false, "the planted git ran");
});

inPlanted(
  "a fetch with no PATH entry outside the project is refused in its own terms",
  async (p) => {
    const env = (name: string) => name === "PATH" ? p.bin : Deno.env.get(name);
    const fetcher = new GitBranchFetcher(p.project, { protocols: ["file"], env });
    await assertRejects(
      () => fetcher.fetch(TOPIC, join(p.base, "out.git")),
      ExportRefused,
      "no PATH entry outside the repository",
    );
    assertEquals(await ran(p.fired), false, "the planted git ran");
  },
);
