import type { FsReader, FsWriter } from "./ports.ts";
import { CONSTITUTION_PATH, LEGACY_CONSTITUTION_PATH } from "../domain/constitution_paths.ts";
import {
  type ConstitutionMove,
  planConstitutionMove,
  type UnreadableEntry,
} from "../domain/constitution_move.ts";
import type { DiskEntry } from "../domain/context_link.ts";
import { deleteExact, exactMoveRefusal, moveExact } from "./upgrade_exact_move.ts";
import { ReadFault } from "./read_fault.ts";

/** What the move needs: the two existing ports, no new one. */
export type ConstitutionMoveContext = {
  readonly reader: FsReader;
  readonly writer: FsWriter;
  readonly projectDir: string;
  readonly dryRun: boolean;
};

/** What the move did, and the dests the caller's own filter must drop. */
export type ConstitutionMoveOutcome = {
  readonly verdict: ConstitutionMove;
  /** Every move, dedupe and refusal, said — or what a dry run would do. */
  readonly notes: string[];
  /**
   * Both addresses, for every verdict but `none`: they leave the plan and the
   * lock (init: the write set), so the default never shadows the old file and
   * a lock entry for the old file never makes it an orphan to delete (A-M1, A-H3).
   */
  readonly exclude: readonly string[];
};

const FROM = LEGACY_CONSTITUTION_PATH;
const TO = CONSTITUTION_PATH;
const WHY = "the constitution is the project's own document now";

/**
 * Moves `.specnaut/memory/constitution.md` to `docs/constitution.md` (FR-006).
 *
 * The one home of WHEN the move runs: whenever the old address holds
 * something, in `init` and in `upgrade` alike, forced or not, locked or not
 * (A-H2). A caller adds no condition of its own — not even "does the old
 * file exist": nothing there, or no project directory yet, is verdict `none`.
 * An address that cannot be read is a refusal, never an abort and never
 * absence (cli#684 review); one that leaves the project aborts (cli#704). Runs before the caller reads
 * disk state for its plan, so the defaults are judged against the moved file
 * (FR-007). Under `dryRun` it judges and writes nothing; its note says
 * "would move".
 */
export async function executeConstitutionMove(
  ctx: ConstitutionMoveContext,
): Promise<ConstitutionMoveOutcome> {
  const verdict = planConstitutionMove(await entryAt(ctx, FROM), await entryAt(ctx, TO));
  const notes: string[] = [];
  if (verdict.kind === "none") return { verdict, notes, exclude: [] };
  const exclude = [FROM, TO];
  switch (verdict.kind) {
    case "move":
      if (ctx.dryRun) notes.push(`${FROM} would move to ${TO} (${WHY})`);
      else if (await moveExact({ ...ctx, notes }, FROM, FROM, TO, verdict.content) === "moved") {
        notes.push(`${FROM} moved to ${TO} (${WHY})`);
      }
      break;
    case "dedupe":
      await dedupe(ctx, notes);
      break;
    case "refuse-conflict":
      notes.push(exactMoveRefusal({ kind: "target-occupied" }, FROM, TO)!);
      break;
    case "refuse-link":
      notes.push(exactMoveRefusal({ kind: "source-link" }, FROM, TO)!);
      break;
    case "refuse-lossy":
      notes.push(exactMoveRefusal({ kind: "source-lossy" }, FROM, TO)!);
      break;
    case "refuse-unreadable":
      notes.push(
        `${verdict.path} cannot be read (${verdict.reason}), so ${FROM} is not moved and ` +
          `no default is written at ${TO} — make it readable and run again`,
      );
      break;
  }
  return { verdict, notes, exclude };
}

/** The old copy goes; the new one, the same text, is never touched. */
async function dedupe(ctx: ConstitutionMoveContext, notes: string[]): Promise<void> {
  const same = `it holds the same text as ${TO}`;
  if (ctx.dryRun) {
    notes.push(`${FROM} would be removed: ${same}`);
    return;
  }
  const deleted = await deleteExact({ ...ctx, notes }, FROM);
  notes.push(
    deleted.kind === "deleted"
      ? `${FROM} removed: ${same}`
      : deleted.kind === "elsewhere"
      ? `${FROM} is not removed: it resolves to another path — delete it yourself`
      : `${FROM} is not removed: ${deleted.reason}`,
  );
}

/**
 * What is at `rel`, told apart from what cannot be said: the reader returns
 * `null` for absence (no file, or no project directory yet), and a `ReadFault`
 * for a file that is there and cannot be read — judged absent, the default
 * would be written beside it. Only that throw is caught (cli#704): a
 * containment refusal propagates in its own words, as it does for every other
 * read `upgrade` makes, because "make it readable" is wrong advice for a link
 * that leaves the project.
 */
async function entryAt(
  ctx: ConstitutionMoveContext,
  rel: string,
): Promise<DiskEntry | UnreadableEntry | null> {
  try {
    return await ctx.reader.readEntry(ctx.projectDir, rel);
  } catch (err) {
    if (!(err instanceof ReadFault)) throw err;
    return { kind: "unreadable", reason: err.message };
  }
}
