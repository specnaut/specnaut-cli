import type { FsReader, FsWriter } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import { mergeRefusal } from "../domain/merge_block.ts";
import { executeConstitutionMove } from "./upgrade_constitution_move.ts";

/** The ports init's filter reads through; `writer` and `dryRun` serve the constitution move. */
export type InitFilterIo = {
  readonly reader: FsReader | undefined;
  readonly writer: FsWriter;
  readonly dryRun: boolean;
};

/** What `init` writes, and what it held back and why. */
export type InitBundleFilter = {
  /** The entries this run writes: the bundle minus preserved and refused dests. */
  readonly bundleToWrite: Bundle;
  /** Declared-preserve dests skipped from the write; they stay lock-tracked (FR-012). */
  readonly preserved: string[];
  /** One sentence per refused merge or constitution move outcome, for the result's warnings. */
  readonly refusals: string[];
  /** Dests held back from the write AND the lock: the constitution move's (spec 038). */
  readonly excluded: ReadonlySet<string>;
};

/**
 * Splits the init bundle into what is written and what is held back. The one
 * home of init's write filter, so a later reason to hold a dest back (spec
 * 038) joins this loop instead of `InitProjectUseCase.execute`.
 *
 * Preserve filter (spec 011 / issue #367): declared paths are removed from the
 * WRITE set so a forced refresh never clobbers them, but they stay in the
 * caller's bundle for lock-entry construction — preserved files MUST remain
 * lock-tracked (FR-012). Only dests that are actually in the bundle count as
 * preserved (a declared path outside the bundle is a handler-side warn).
 *
 * Called before the dry-run short-circuit, so a preview's "would write N
 * files" count excludes preserved paths and reports refusals too.
 *
 * The legacy constitution moves whenever its old address holds something —
 * with a lock or without, forced or not (spec 038, A-H2): `init --force` on
 * an upgraded-from project must not write the default beside it. When the
 * move runs is `executeConstitutionMove`'s to decide; this only drops what it
 * excludes and says what it says.
 */
export async function filterInitBundle(
  io: InitFilterIo,
  targetDir: string,
  bundle: Bundle,
  preservedPaths: ReadonlySet<string>,
): Promise<InitBundleFilter> {
  const { reader } = io;
  const preserved: string[] = [];
  const bundleToWrite: Bundle = {};
  const move = reader === undefined
    ? null
    : await executeConstitutionMove({ ...io, reader, projectDir: targetDir });
  const refusals: string[] = [...(move?.notes ?? [])];
  const excluded = new Set(move?.exclude ?? []);
  for (const [dest, file] of Object.entries(bundle)) {
    if (excluded.has(dest)) continue;
    if (preservedPaths.has(dest)) {
      preserved.push(dest);
      continue;
    }
    const refusal = await hostRefusal(reader, targetDir, dest, file);
    if (refusal !== null) {
      refusals.push(refusal);
      continue;
    }
    bundleToWrite[dest] = file;
  }
  return { bundleToWrite, preserved, refusals, excluded };
}

/**
 * Why the host file at `dest` cannot take its merge block, or `null` — also
 * for a file that is no merge, or no reader. A merge block is non-destructive,
 * but that is not the same as always safe to add: `.codex/config.toml` already
 * carrying an `[agents]` table cannot take a second one without ceasing to
 * parse. Refuse, and say which keys to add by hand — a silent skip would leave
 * the user with the defect and no idea the fix had been withheld (cli#599).
 *
 * The reader says "nothing there" itself — even for a target directory that
 * does not exist yet — so a throw is a host that is there and cannot be read:
 * it is refused, never merged blind, and never the thing that makes init fail.
 */
async function hostRefusal(
  reader: FsReader | undefined,
  targetDir: string,
  dest: string,
  file: Bundle[string],
): Promise<string | null> {
  if (reader === undefined || file.mergeRefuseIf === undefined) return null;
  try {
    return mergeRefusal(await reader.readText(targetDir, dest), file);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return `${dest} cannot be read (${why}), so its block is not merged — make it readable and run again`;
  }
}
