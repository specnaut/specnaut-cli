import { type BranchSource, parseBranchSource } from "../domain/branch_source.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import {
  DEFAULT_TREE_CAPS,
  type ExportPlan,
  type ListedEntry,
  type TreeCaps,
  TreePlanner,
  type TreeToRead,
} from "../domain/tree_plan.ts";
import {
  type BranchFetcher,
  type ExportHome,
  ExportRefused,
  type ExportStore,
  type TreeObjects,
} from "./untrusted_review_ports.ts";

/**
 * Exports a branch's tree as inert files: fetched as objects into a repository of its own, judged
 * whole, then written twice outside the project. Nothing is checked out, so no filter, hook or
 * harness setting the branch carries runs or is loaded; and one commit id is bound from the fetch
 * to the folder name to the re-hash of what was written.
 */

export type ExportDeps = {
  readonly fetcher: BranchFetcher;
  readonly objects: (gitDir: string) => TreeObjects;
  readonly store: () => ExportStore;
  /** Whether the copies land on Windows, whose names refuse more. */
  readonly windows: boolean;
};

export type ExportRequest = {
  /** A PR number or `<remote>/<branch>` on a configured remote. */
  readonly source: string;
  /** The head the caller was told to expect, from the forge; a different fetch is refused. */
  readonly expectedSha?: string;
  readonly caps?: TreeCaps;
};

export type BranchExport = ExportHome & {
  readonly sha: string;
  /** Links, submodules, instruction files and odd modes: listed with their id, never written. */
  readonly listed: readonly ListedEntry[];
  readonly remove: () => Promise<void>;
};

export async function exportBranchTree(
  deps: ExportDeps,
  request: ExportRequest,
): Promise<BranchExport> {
  const source = parseBranchSource(request.source, await deps.fetcher.remotes());
  if (source.kind === "refused") throw new ExportRefused(source.why);
  const store = deps.store();
  try {
    return await exportInto(store, deps, source, request);
  } catch (err) {
    await removeAfter(store, err);
    throw err;
  }
}

async function exportInto(
  store: ExportStore,
  deps: ExportDeps,
  source: BranchSource,
  request: ExportRequest,
): Promise<BranchExport> {
  const staged = await store.stage();
  const sha = checkedHead(await deps.fetcher.fetch(source, staged), request.expectedSha);
  const home = await store.claim(sha, staged);
  const objects = deps.objects(home.gitDir);
  const caps = request.caps ?? DEFAULT_TREE_CAPS;
  const plan = await planTree(objects, await objects.treeOf(sha), caps, deps.windows);
  await store.write(plan, objects);
  await store.verify(plan);
  return { ...home, sha, listed: plan.listed, remove: () => store.remove() };
}

/** Removes a failed export; a cleanup that fails too keeps the first failure as its cause. */
async function removeAfter(store: ExportStore, failure: unknown): Promise<void> {
  try {
    await store.remove();
  } catch (cleanup) {
    const why = cleanup instanceof Error ? cleanup.message : String(cleanup);
    throw new Error(`the export failed, and removing it failed too: ${why}`, { cause: failure });
  }
}

/** The fetched id, once it is a full commit id and the one expected: it names folders next. */
function checkedHead(sha: string, expected: string | undefined): string {
  if (!isFullSha(sha)) throw new ExportRefused("the fetched ref names no full commit id");
  if (expected !== undefined && sha !== expected) {
    throw new ExportRefused(`the fetched head is ${sha}, not ${expected}`);
  }
  return sha;
}

/**
 * Reads the tree one level at a time, each tree's size charged per occurrence before it is read,
 * so a tree that repeats one subtree a million times stops at a cap instead of in memory.
 */
async function planTree(
  objects: TreeObjects,
  root: string,
  caps: TreeCaps,
  windows: boolean,
): Promise<ExportPlan> {
  const planner = new TreePlanner(caps, windows);
  let level: TreeToRead[] = [{ names: [], sha: root }];
  while (level.length > 0) {
    const ids = unique(level.map((t) => t.sha));
    const sizes = await objects.sizes(ids, "tree");
    for (const t of level) planner.charge(sizes.get(t.sha)!);
    const trees = await objects.readTrees(ids);
    level = level.flatMap((t) => planner.admit(t, trees.get(t.sha)!));
  }
  const plan = planner.finish();
  const sizes = await objects.sizes(unique(plan.files.map((f) => f.sha)), "blob");
  for (const f of plan.files) planner.charge(sizes.get(f.sha)!);
  return plan;
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];
