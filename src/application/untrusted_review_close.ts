import { DEFAULT_TREE_CAPS } from "../domain/tree_plan.ts";
import { planTree } from "./untrusted_review.ts";
import type { KeptExport, TreeObjects } from "./untrusted_review_ports.ts";

/**
 * Closes a review's kept export: the reviewers' copy is checked against the commit once more, then
 * the export is removed whatever the check found. The copy was sealed read-only once checked at the
 * start, so a copy that differs now was changed while the review read it: the review read text
 * that is not the commit's, and the close says so instead of reporting a clean removal. The plan is
 * read again from the export's own repository, with the caps and names the start used.
 */

export type CloseDeps = {
  /** The kept export of `sha`, or `null` when none is there. */
  readonly kept: (sha: string) => Promise<KeptExport | null>;
  readonly objects: (gitDir: string) => TreeObjects;
  /** Whether the copies are on Windows, whose names refuse more and whose modes say nothing. */
  readonly windows: boolean;
};

export type CloseOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "removed" }
  | { readonly kind: "changed"; readonly why: string };

export async function closeExport(deps: CloseDeps, sha: string): Promise<CloseOutcome> {
  const kept = await deps.kept(sha);
  if (kept === null) return { kind: "none" };
  const why = await changeIn(deps, kept, sha);
  await kept.remove();
  return why === null ? { kind: "removed" } : { kind: "changed", why };
}

/** Why the reviewers' copy is not the commit's now, or `null` when it still is. */
async function changeIn(deps: CloseDeps, kept: KeptExport, sha: string): Promise<string | null> {
  try {
    const objects = deps.objects(kept.gitDir);
    await kept.verify(
      await planTree(objects, await objects.treeOf(sha), DEFAULT_TREE_CAPS, deps.windows),
    );
    return null;
  } catch (err) {
    // Not swallowed: a copy that cannot be checked is reported as not the commit's.
    return err instanceof Error ? err.message : String(err);
  }
}
