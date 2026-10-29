import type { FsReader, FsWriter, Harness } from "./ports.ts";
import type { BundleOptions } from "./bundle_options.ts";
import type { Bundle } from "../domain/template.ts";
import type { CoreEntry } from "../domain/core_bundle.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import {
  PHASES_LEFT_ROUTER,
  predatesPhaseMove,
  renameEndpointEntry,
  routerEndpointEntry,
  SKILL_DOC_RENAMES,
  staleRouterAdvice,
} from "../domain/skill_doc_renames.ts";
import { carryAddenda, NOT_EXACT } from "./upgrade_addenda_moves.ts";

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
  /**
   * Where every move, skip and refusal is said. The upgrade passes its
   * `refusals`, which every result carries — the dry run's included, so a
   * preview names the moves it would make.
   */
  readonly notes: string[];
};

/** One rename this project is actually mid-way through, its bytes already read. */
type ApplicableRename = {
  oldDest: string;
  newDest: string;
  reason: string;
  /**
   * Read with `lstat` from a regular file — never through a link (plan 037 § 11
   * M2) — and only when this text IS its bytes (`DiskEntry.lossy`).
   */
  content: string;
  customised: boolean;
};

/**
 * Everything an upgrade carries across an address change, in order: the
 * renamed documents, then the addenda of the phases that moved, then a word
 * about a customised router that still routes to the old addresses.
 *
 * One call so `upgrade_project.ts` wires all three with the line it already
 * spent on the first (plan 037 § 10).
 */
export async function carryRenames(
  ctx: RenameContext,
  bundle: Bundle,
  lock: InstalledLock,
  diskShas: Map<string, string>,
): Promise<InstalledLock> {
  const carried = await carryRenamedDocs(ctx, bundle, lock, diskShas);
  await carryAddenda(ctx);
  noteStaleRouter(ctx, lock, diskShas);
  return carried;
}

/**
 * Returns the lock with every applicable rename's entry moved to its new
 * address, and moves the matching `diskShas` entry in place. On a real run the
 * bytes move first and only a move that landed re-keys the maps — a refused
 * write leaves the old entry where its bytes still are. `--dry-run` moves only
 * the maps, which is enough to report the move faithfully.
 */
async function carryRenamedDocs(
  ctx: RenameContext,
  bundle: Bundle,
  lock: InstalledLock,
  diskShas: Map<string, string>,
): Promise<InstalledLock> {
  const applicable = await applicableRenames(ctx, bundle, lock, diskShas);
  const landed = ctx.dryRun ? applicable : await moveRenamedBytes(ctx, applicable);
  if (landed.length === 0) return lock;

  const entries = new Map(lock.entries);
  for (const { oldDest, newDest, reason, customised } of landed) {
    entries.set(newDest, entries.get(oldDest)!);
    entries.delete(oldDest);
    diskShas.set(newDest, diskShas.get(oldDest)!);
    diskShas.delete(oldDest);
    // Only a customisation is worth a line: a vanilla move is just the update
    // the summary already lists at the new address.
    if (customised) {
      ctx.notes.push(
        `your edits to ${oldDest} ${ctx.dryRun ? "would move" : "moved"} to ${newDest} (${reason})`,
      );
    }
  }
  return { ...lock, entries };
}

/**
 * Where THIS harness puts a stand-in entry, or `null` when it emits none.
 *
 * Asking the harness rather than composing the path: a literal would be a
 * second statement of the adapter's rule (spec 033 §5), and wrong on six of
 * seven harnesses. The harness's own fixed files are subtracted once.
 */
export function destResolver(
  harness: Harness,
  bundleOpts: BundleOptions,
): (entry: CoreEntry) => string | null {
  const harnessOnlyDests = harness.mapBundle([], bundleOpts);
  return (entry) =>
    Object.keys(harness.mapBundle([entry], bundleOpts)).find((d) => !(d in harnessOnlyDests)) ??
      null;
}

/**
 * The renames that apply to this project, each endpoint placed where THIS
 * harness puts the document, and each source read as a regular file.
 */
async function applicableRenames(
  ctx: RenameContext,
  bundle: Bundle,
  lock: InstalledLock,
  diskShas: Map<string, string>,
): Promise<ApplicableRename[]> {
  const destFor = destResolver(ctx.harness, ctx.bundleOpts);
  const applicable: ApplicableRename[] = [];
  for (const r of SKILL_DOC_RENAMES) {
    const oldDest = destFor(renameEndpointEntry(r.from.owner, r.from.doc, r.kind));
    const newDest = destFor(renameEndpointEntry(r.to.owner, r.to.doc, r.kind));
    if (oldDest === null || newDest === null) continue;
    // Only when the project is actually mid-migration: the old path is
    // tracked AND present and not declared preserved (cli#668: it stays put,
    // an orphan the bundle dropped), the new document ships now, and nothing
    // Specnaut tracks has already claimed the new path.
    const entry = lock.entries.get(oldDest);
    if (entry === undefined || ctx.isDeclaredPreserved?.(oldDest)) continue;
    if (!diskShas.has(oldDest)) continue;
    if (!(newDest in bundle)) continue;
    if (lock.entries.has(newDest)) continue;
    const content = await movableContent(ctx, oldDest, newDest);
    if (content === null) continue;
    const customised = diskShas.get(oldDest) !== entry.sha256;
    applicable.push({ oldDest, newDest, reason: r.reason, content, customised });
  }
  return applicable;
}

/**
 * The bytes at `oldDest` when the move is safe, else `null` with the reason
 * said. Both ends are judged with `lstat` (plan 037 § 11):
 *
 * - anything at `newDest` is a file Specnaut does not track — the lock check
 *   ran first — and a rename never writes over it (M3);
 * - a link at `oldDest` is left where it is: copying through it would turn
 *   whatever it points at, an ignored secret included, into a tracked
 *   regular file (M2);
 * - a file whose bytes are not UTF-8 stays too: the move writes the decoded
 *   text and deletes the bytes, so a lossy decode would lose them for good.
 *
 * A read that throws is said and skipped: one odd path never aborts the run.
 */
async function movableContent(
  ctx: RenameContext,
  oldDest: string,
  newDest: string,
): Promise<string | null> {
  try {
    if (await ctx.reader.readEntry(ctx.projectDir, newDest) !== null) {
      ctx.notes.push(
        `${oldDest} is not moved to ${newDest}: a file Specnaut does not track is already ` +
          `there, and it is kept as it is`,
      );
      return null;
    }
    const source = await ctx.reader.readEntry(ctx.projectDir, oldDest);
    if (source?.kind === "file") {
      if (!source.lossy) return source.content;
      ctx.notes.push(`${oldDest} is not moved to ${newDest}: ${NOT_EXACT}`);
    }
    if (source?.kind === "symlink") {
      ctx.notes.push(
        `${oldDest} is a link, so it is not moved to ${newDest} — upgrade never copies ` +
          `through a link; point it at the new address yourself if it should follow`,
      );
    }
    return null;
  } catch (err) {
    ctx.notes.push(`${oldDest} is not moved to ${newDest}: ${why(err)}`);
    return null;
  }
}

/**
 * Moves each renamed document's bytes, one at a time, and returns the moves
 * that landed. The delete is bounded to the old address itself (`within`):
 * a path under a linked folder resolves elsewhere, and is left in place rather
 * than deleted at whatever it reaches. No backup: the bytes were moved, not
 * discarded — a backup would leave a `.specnaut.bak` beside every renamed file
 * on an upgrade that lost nothing.
 */
async function moveRenamedBytes(
  ctx: RenameContext,
  applicable: ReadonlyArray<ApplicableRename>,
): Promise<ApplicableRename[]> {
  const landed: ApplicableRename[] = [];
  for (const a of applicable) {
    try {
      await ctx.writer.writeBundle(
        { [a.newDest]: { content: a.content, executable: false } },
        ctx.projectDir,
        { overwrite: false },
      );
    } catch (err) {
      ctx.notes.push(`${a.oldDest} is not moved to ${a.newDest}: ${why(err)}`);
      continue;
    }
    landed.push(a);
    try {
      const r = await ctx.writer.deletePaths([a.oldDest], ctx.projectDir, {
        backupExisting: false,
        within: (resolved) => resolved === a.oldDest,
      });
      if ((r.refused ?? []).length > 0) {
        ctx.notes.push(
          `${a.oldDest} was copied to ${a.newDest} but not deleted: it resolves to another ` +
            `path — delete the old copy yourself once you have checked it`,
        );
      }
      ctx.notes.push(...(r.notes ?? []));
    } catch (err) {
      ctx.notes.push(`${a.oldDest} was copied to ${a.newDest} but not deleted: ${why(err)}`);
    }
  }
  return landed;
}

/**
 * Where this harness installs the router the phases left — `specnaut/SKILL.md`
 * on Claude. Shared with `check --project`, so both judge the same file.
 */
export function phaseRouterDest(harness: Harness, bundleOpts: BundleOptions): string | null {
  return destResolver(harness, bundleOpts)(routerEndpointEntry(PHASES_LEFT_ROUTER.owner));
}

/**
 * Names a customised router that predates the phase move: kept like every
 * customisation, it still routes to addresses that are gone (plan 037 § 10).
 */
function noteStaleRouter(
  ctx: RenameContext,
  lock: InstalledLock,
  diskShas: ReadonlyMap<string, string>,
): void {
  const dest = phaseRouterDest(ctx.harness, ctx.bundleOpts);
  const entry = dest === null ? undefined : lock.entries.get(dest);
  if (dest === null || entry === undefined || !diskShas.has(dest)) return;
  if (diskShas.get(dest) === entry.sha256 || !predatesPhaseMove(entry.templatesVersion)) return;
  ctx.notes.push(`${dest} ${staleRouterAdvice(dest)}`);
}

const why = (err: unknown) => err instanceof Error ? err.message : String(err);
