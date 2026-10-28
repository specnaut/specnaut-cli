import type { FsReader, FsWriter, Harness } from "./ports.ts";
import type { BundleOptions } from "./bundle_options.ts";
import type { Bundle } from "../domain/template.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { renameEndpointEntry, SKILL_DOC_RENAMES } from "../domain/skill_doc_renames.ts";

/**
 * Renamed documents carry their lock identity across the move.
 *
 * A sub-document that changed address is otherwise TWO unrelated events: an
 * orphan at the old path and an add-new at the new one. The user's bytes
 * survive — a customised orphan is removed only under `--force`, with a
 * backup — but they stop being READ. The agent loads the vanilla document
 * at the new address while the edit sits at the old one, behind a success
 * message. A release guardrail that stops firing silently is worse than one
 * that is deleted loudly.
 *
 * Moving the lock entry makes it ONE event, so the ordinary customized /
 * vanilla logic applies at the new address with no special case: a vanilla
 * file updates, a customised one lands in the `customized` bucket where the
 * summary names it.
 */
export type RenameContext = {
  readonly reader: FsReader;
  readonly writer: FsWriter;
  readonly harness: Harness;
  readonly bundleOpts: BundleOptions;
  readonly projectDir: string;
  readonly dryRun: boolean;
  readonly isDeclaredPreserved?: (dest: string) => boolean;
};

/**
 * Returns the lock with every applicable rename's entry moved to its new
 * address, and moves the matching `diskShas` entry in place. On a real run the
 * bytes move too; `--dry-run` moves only the maps, which is enough to report
 * the move faithfully.
 */
export async function carryRenamedDocs(
  ctx: RenameContext,
  bundle: Bundle,
  lock: InstalledLock,
  diskShas: Map<string, string>,
): Promise<InstalledLock> {
  const { harness, bundleOpts } = ctx;
  /** Destinations this harness emits regardless of the bundle. */
  const harnessOnlyDests = harness.mapBundle([], bundleOpts);
  const destFor = (owner: string, doc: string): string | null => {
    // Ask the HARNESS where it puts this document. Composing the path here
    // would be a second statement of the adapter's rule (spec 033 §5) — and
    // it is harness-specific, so any literal would be wrong on six of seven.
    const mapped = harness.mapBundle([renameEndpointEntry(owner, doc)], bundleOpts);
    return Object.keys(mapped).find((d) => !(d in harnessOnlyDests)) ?? null;
  };

  const applicable: Array<{ oldDest: string; newDest: string; reason: string }> = [];
  for (const r of SKILL_DOC_RENAMES) {
    const oldDest = destFor(r.from.owner, r.from.doc);
    const newDest = destFor(r.to.owner, r.to.doc);
    if (oldDest === null || newDest === null) continue;
    // Only when the project is actually mid-migration: the old path is
    // tracked AND present and not declared preserved (cli#668: it stays put,
    // an orphan the bundle dropped), the new document ships now, and nothing
    // has already claimed the new path.
    if (!lock.entries.has(oldDest) || ctx.isDeclaredPreserved?.(oldDest)) continue;
    if (!diskShas.has(oldDest)) continue;
    if (!(newDest in bundle)) continue;
    if (lock.entries.has(newDest)) continue;
    applicable.push({ oldDest, newDest, reason: r.reason });
  }
  if (applicable.length === 0) return lock;

  const entries = new Map(lock.entries);
  for (const { oldDest, newDest } of applicable) {
    entries.set(newDest, entries.get(oldDest)!);
    entries.delete(oldDest);
    diskShas.set(newDest, diskShas.get(oldDest)!);
    diskShas.delete(oldDest);
  }

  // The maps above are enough for `--dry-run` to report the move
  // faithfully; the bytes only travel on a real run.
  if (!ctx.dryRun) {
    const moved: Bundle = {};
    for (const { oldDest, newDest } of applicable) {
      const content = await ctx.reader.readText(ctx.projectDir, oldDest);
      if (content === null) continue;
      moved[newDest] = { content, executable: false };
    }
    if (Object.keys(moved).length > 0) {
      await ctx.writer.writeBundle(moved, ctx.projectDir, { overwrite: true });
      await ctx.writer.deletePaths(
        applicable.map((a) => a.oldDest),
        ctx.projectDir,
        // No backup: the bytes were moved, not discarded. A backup here
        // would leave a `.specnaut.bak` beside every renamed file on an
        // upgrade that lost nothing.
        { backupExisting: false },
      );
    }
  }
  return { ...lock, entries };
}
