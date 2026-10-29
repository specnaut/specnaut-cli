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
  const { reader } = io;
  const bundle: Bundle = { ...planned };
  const move = await executeConstitutionMove({ ...io, projectDir });
  const carried = await carryLegacySettings(
    { ...io, projectDir },
    await constitutionAfterRun(reader, projectDir, move.verdict),
  );
  const notices = await constitutionNotices(
    reader,
    projectDir,
    planned[CONSTITUTION_PATH]?.content,
    move.verdict,
  );
  const retired = await retiredConfigNotices(reader, projectDir);
  const refusals: string[] = [...move.notes, ...carried, ...notices, ...retired];
  const refusedDests = new Set<string>(move.exclude);
  for (const dest of move.exclude) delete bundle[dest];
  for (const [dest, file] of Object.entries(bundle)) {
    if (file.mergeRefuseIf === undefined) continue;
    const refusal = mergeRefusal(await reader.readText(projectDir, dest), file);
    if (refusal === null) continue;
    refusals.push(refusal);
    delete bundle[dest];
    refusedDests.add(dest);
  }

  // Context links are classified by what `lstat` sees (cli#680).
  const links = await surveyContextLinks(reader, projectDir, bundle, lock, isDeclaredPreserved);
  for (const { dest, message } of links.refused) {
    refusals.push(message);
    delete bundle[dest];
    refusedDests.add(dest);
  }

  const diskShas = await readDiskShas(reader, projectDir, bundle, lock, links, refusedDests);
  return { bundle, refusals, links, diskShas, lockForPlan: withoutRefused(lock, refusedDests) };
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
