import { join } from "@std/path";
import { exportBranchTree, type ExportDeps } from "../../src/application/untrusted_review.ts";
import type { BranchFetcher } from "../../src/application/untrusted_review_ports.ts";
import { type BranchSource, FETCHED_REF } from "../../src/domain/branch_source.ts";
import { DEFAULT_TREE_CAPS, type TreeCaps } from "../../src/domain/tree_plan.ts";
import { FsExportStore } from "../../src/infrastructure/fs_tree_export.ts";
import { GitTreeObjects } from "../../src/infrastructure/git_tree_objects.ts";
import { commit, git, initRepo, type RawEntry, tempDir, tree } from "./git_fixture.ts";

/**
 * The export end to end over real objects and the real store. Only the fetch is replaced: by a
 * bare repository that borrows the fixture's objects with its ref at the crafted commit, since fsck
 * on a real fetch refuses some bad names first, and these tests prove the export refuses each one.
 */

export type World = { readonly repo: string; readonly project: string; readonly cache: string };

export async function withWorld(fn: (w: World) => Promise<void>): Promise<void> {
  const base = await tempDir("export-");
  try {
    const [repo, project, cache] = ["repo", "project", "cache"].map((d) => join(base, d));
    for (const d of [repo, project]) await Deno.mkdir(d);
    await initRepo(repo);
    await fn({ repo, project, cache });
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

/** Leaves the staged repository as a real fetch would, its ref at `head`; records each call. */
export function fetcherOf(w: World, head: string, calls: BranchSource[] = []): BranchFetcher {
  return {
    remotes: () => Promise.resolve(["origin"]),
    async fetch(source, gitDir) {
      calls.push(source);
      await git(w.repo, ["init", "-q", "--bare", "--template=", gitDir]);
      const alternates = join(gitDir, "objects", "info", "alternates");
      await Deno.writeTextFile(alternates, `${join(w.repo, ".git", "objects")}\n`);
      if (/^[0-9a-f]{40}$/.test(head)) await git(gitDir, ["update-ref", FETCHED_REF, head]);
      return head;
    },
  };
}

export function depsOf(w: World, fetcher: BranchFetcher): ExportDeps {
  return {
    fetcher,
    objects: (gitDir) => new GitTreeObjects(gitDir),
    store: () => new FsExportStore(w.project, w.cache),
    windows: false,
  };
}

/** Commits `entries` as a crafted tree; `run` exports that commit. */
export async function exportOf(w: World, entries: readonly RawEntry[], caps?: Partial<TreeCaps>) {
  const head = await commit(w.repo, await tree(w.repo, entries));
  const request = { source: "origin/topic", caps: { ...DEFAULT_TREE_CAPS, ...caps } };
  return { head, run: () => exportBranchTree(depsOf(w, fetcherOf(w, head)), request) };
}

/** What the cache folder holds: nothing at all after a refused export. */
export async function cacheEntries(w: World): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(w.cache)) names.push(e.name);
  return names;
}
