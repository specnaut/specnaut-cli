import type { FsReader, FsWriter } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { sha256Hex } from "../domain/sha256.ts";
import { extractBlock, mergeRefusal } from "../domain/merge_block.ts";
import { type ContextLinkSurvey, surveyContextLinks } from "./upgrade_context_links.ts";
import { executeConstitutionMove } from "./upgrade_constitution_move.ts";
import { constitutionAfterRun, constitutionNotices } from "./upgrade_constitution_notices.ts";
import { retiredConfigNotices } from "./upgrade_retired_notices.ts";
import { carryLegacySettings } from "./upgrade_legacy_settings.ts";
import { CONSTITUTION_PATH } from "../domain/constitution_paths.ts";

/** The ports the inputs are read through, and whether this run may write (the move). */
export type PlanInputsIo = {
  readonly reader: FsReader;
  readonly writer: FsWriter;
  readonly dryRun: boolean;
};

/**
 * What the upgrade plan is computed from, once every refused dest is gone: the
 * bundle to plan, what is on disk, the lock to plan against, and what was
 * refused on the way. One home for the steps that must run BEFORE the plan
 * reads disk state, so a later step that has to run there (spec 038) lands in
 * one place rather than in the middle of `UpgradeProjectUseCase.execute`.
 */
export type PlanInputs = {
  /** The planned bundle, minus every refused dest. A copy: the caller's is untouched. */
  readonly bundle: Bundle;
  /** Every merge or context link this run declined, and the constitution move, said on every result. */
  readonly refusals: string[];
  readonly links: ContextLinkSurvey;
  /** dest → sha of what is on disk; for a merge block, of the block only. */
  readonly diskShas: Map<string, string>;
  /** The lock without the refused dests — see `withoutRefused`. */
  readonly lockForPlan: InstalledLock;
};

/**
 * Reads the disk state the plan needs, refusing on the way what cannot safely
 * be written.
 *
 * A merge whose host file cannot take the block (cli#599), and an inverted
 * context-link consolidation (cli#680), are dropped from the bundle BEFORE the
 * plan is computed, so a refused path is never planned, written, or
 * lock-tracked — an entry for a file we deliberately did not write would
 * report as drift on every later run.
 *
 * The legacy constitution moves first (spec 038, FR-007): both its addresses
 * leave the bundle and the lock whatever the verdict, so the default never
 * overwrites the moved file and a refused one is never an orphan to delete.
 * A size table or target-surface declaration it still carries is copied to
 * its config (FR-010) before the notices read that config; what the
 * constitution lacks, or how far over its ceiling it is, is said beside it.
 */
export async function gatherPlanInputs(
  io: PlanInputsIo,
  projectDir: string,
  planned: Bundle,
  lock: InstalledLock,
  isDeclaredPreserved: (dest: string) => boolean,
): Promise<PlanInputs> {
  const held = await constitutionStep(io, projectDir, planned, lock);
  const refused = await refuseUnsafe(
    io.reader,
    projectDir,
    planned,
    lock,
    held,
    isDeclaredPreserved,
  );
  const { bundle, links, refusedDests } = refused;
  const diskShas = await readDiskShas(io.reader, projectDir, bundle, lock, links, refusedDests);
  return { bundle, refusals: refused.refusals, links, diskShas, lockForPlan: refused.lockForPlan };
}

/** The one refusal step's outputs, produced together so no caller patches them apart. */
type Refused = {
  readonly bundle: Bundle;
  readonly lockForPlan: InstalledLock;
  readonly refusedDests: ReadonlySet<string>;
  readonly refusals: string[];
  readonly links: ContextLinkSurvey;
};

/**
 * Every refusal source, folded in order: the dests the constitution move holds
 * back, the merges whose host file cannot take the block (`mergeRefusal`), then
 * the context links whose target links back to them (`surveyContextLinks`).
 * Links are surveyed over the bundle the merges left, as they always were.
 */
async function refuseUnsafe(
  reader: FsReader,
  projectDir: string,
  planned: Bundle,
  lock: InstalledLock,
  held: { readonly notes: ReadonlyArray<string>; readonly exclude: ReadonlyArray<string> },
  isDeclaredPreserved: (dest: string) => boolean,
): Promise<Refused> {
  const refusals: string[] = [...held.notes];
  const refusedDests = new Set<string>(held.exclude);
  const remaining = (): Bundle =>
    Object.fromEntries(Object.entries(planned).filter(([dest]) => !refusedDests.has(dest)));
  for (const [dest, file] of Object.entries(remaining())) {
    if (file.mergeRefuseIf === undefined) continue;
    const refusal = mergeRefusal(await reader.readText(projectDir, dest), file);
    if (refusal === null) continue;
    refusals.push(refusal);
    refusedDests.add(dest);
  }
  // Context links are classified by what `lstat` sees (cli#680).
  const links = await surveyContextLinks(
    reader,
    projectDir,
    remaining(),
    lock,
    isDeclaredPreserved,
  );
  for (const { dest, message } of links.refused) {
    refusals.push(message);
    refusedDests.add(dest);
  }
  const lockForPlan = withoutRefused(lock, refusedDests);
  return { bundle: remaining(), lockForPlan, refusedDests, refusals, links };
}

/**
 * The constitution's steps, in the order the doc above gives (spec 038): the
 * move, the settings it carried, the notices that read them, and the retired
 * configs. Its notes, and the dests the move holds back from plan and lock.
 */
async function constitutionStep(
  io: PlanInputsIo,
  projectDir: string,
  planned: Bundle,
  lock: InstalledLock,
): Promise<{ notes: string[]; exclude: readonly string[] }> {
  const { reader } = io;
  const move = await executeConstitutionMove({ ...io, projectDir });
  const after = await constitutionAfterRun(reader, projectDir, move.verdict);
  const carried = await carryLegacySettings({ ...io, projectDir }, after);
  const shipped = planned[CONSTITUTION_PATH]?.content;
  const notices = await constitutionNotices(reader, projectDir, shipped, move.verdict);
  const retired = await retiredConfigNotices(reader, projectDir, new Set(lock.entries.keys()));
  return { notes: [...move.notes, ...carried, ...notices, ...retired], exclude: move.exclude };
}

/** The sha of every bundle or lock dest present on disk, never read through a link. */
async function readDiskShas(
  reader: FsReader,
  projectDir: string,
  bundle: Bundle,
  lock: InstalledLock,
  links: ContextLinkSurvey,
  refusedDests: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const destPaths = new Set<string>([...Object.keys(bundle), ...lock.entries.keys()]);
  const diskShas = new Map<string, string>(links.diskShas);
  for (const dest of destPaths) {
    // Never read through a link: that is `AGENTS.md`, or outside the project.
    if (bundle[dest]?.symlinkTo !== undefined || refusedDests.has(dest)) continue;
    const content = await reader.readText(projectDir, dest);
    if (content === null) continue;
    // For mergeable files we hash the *block content only* (not the whole
    // user-owned file) so the SHA is comparable against the lock entry,
    // which also stores only the block content.
    const file = bundle[dest];
    if (file?.mergeBlock !== undefined) {
      const block = extractBlock(content, file.mergeBlock) ?? "";
      diskShas.set(dest, await sha256Hex(block));
    } else {
      diskShas.set(dest, await sha256Hex(content));
    }
  }
  return diskShas;
}

/**
 * A refused dest must leave the LOCK as well as the bundle.
 *
 * Dropping it from the bundle alone leaves its lock entry behind, and a dest
 * that is in the lock but not in the bundle is an ORPHAN — so the very next
 * plan removed the user's `.codex/config.toml` instead of leaving it alone.
 * Refusing to write a file must never be a route to deleting it. Caught by the
 * end-to-end test; the merge-level unit tests could not see it, because the
 * deletion happens nowhere near the merge.
 */
function withoutRefused(lock: InstalledLock, refusedDests: ReadonlySet<string>): InstalledLock {
  if (refusedDests.size === 0) return lock;
  return {
    ...lock,
    entries: new Map([...lock.entries].filter(([dest]) => !refusedDests.has(dest))),
  };
}
