import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { exportBranchTree } from "../../src/application/untrusted_review.ts";
import { FsExportStore } from "../../src/infrastructure/fs_tree_export.ts";
import { GitBranchFetcher } from "../../src/infrastructure/git_branch_fetch.ts";
import { GitTreeObjects } from "../../src/infrastructure/git_tree_objects.ts";
import { blob, commit, git, initRepo, tempDir, tree } from "../helpers/git_fixture.ts";

/**
 * The whole path with the real fetcher: a branch on a remote, fetched from a project that is a
 * linked worktree, whose objects live in the main repository's folder rather than its own.
 */

async function withLinkedWorktree(fn: (dirs: Record<string, string>) => Promise<void>) {
  const base = await tempDir("fetch-export-");
  try {
    const [remote, main, linked, cache] = ["remote", "main", "linked", "cache"].map((d) =>
      join(base, d)
    );
    for (const d of [remote, main]) await Deno.mkdir(d);
    await initRepo(remote);
    await initRepo(main);
    await commit(
      main,
      await tree(main, [["100644", "base", await blob(main, "base\n")]]),
      "refs/heads/main",
    );
    await git(main, ["remote", "add", "origin", remote]);
    await git(main, ["worktree", "add", "-q", "-b", "side", linked, "main"]);
    await fn({ remote, main, linked, cache });
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

Deno.test("a branch is fetched and exported from a project that is a linked worktree", () =>
  withLinkedWorktree(async ({ remote, main, linked, cache }) => {
    const [text, note] = [await blob(remote, "hello\n"), await blob(remote, "rules\n")];
    // In git's byte order: fsck on the fetch refuses a tree that is not sorted.
    const entries = [["100644", "CLAUDE.md", note], ["100644", "a.txt", text]] as const;
    const head = await commit(remote, await tree(remote, entries), "refs/heads/topic");
    const deps = {
      fetcher: new GitBranchFetcher(linked, { protocols: ["file"] }),
      objects: (gitDir: string) => new GitTreeObjects(gitDir),
      store: () => new FsExportStore(linked, cache),
      windows: false,
    };
    const out = await exportBranchTree(deps, { source: "origin/topic", expectedSha: head });
    assertEquals(await Deno.readTextFile(join(out.seats, "a.txt")), "hello\n");
    assertEquals(out.listed, [{ path: "CLAUDE.md", sha: note, kind: "instruction" }]);
    const alternates = await Deno.readTextFile(join(out.gitDir, "objects", "info", "alternates"));
    assertEquals(alternates.trim(), join(await Deno.realPath(main), ".git", "objects"));
    await out.remove();
  }));
