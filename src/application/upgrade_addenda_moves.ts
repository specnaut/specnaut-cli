import type { FsReader, FsWriter } from "./ports.ts";
import { addendumPath, addendumRenames } from "../domain/addendum_audit.ts";

/** What moving the addenda needs: the two existing ports, no new one (plan 037 § 5). */
export type AddendaMoveContext = {
  readonly reader: FsReader;
  readonly writer: FsWriter;
  readonly projectDir: string;
  readonly dryRun: boolean;
  /** Every move, skip and refusal is said here — see `RenameContext.notes`. */
  readonly notes: string[];
};

/**
 * Moves each addendum whose phase moved to the phase's new address (FR-005).
 *
 * **Why this exists.** An addendum is project-owned and outside the lock, so
 * the lock-carrying rename never sees it. Left behind, it sits at an address no
 * router reads: the phase runs without the project's step, and only
 * `check --project` would ever say so. The spec 033 `/ship` rename stranded
 * `specnaut/tag-version.md` exactly that way.
 *
 * Every refusal is the conservative one, and each is said:
 *
 * - **both addresses hold a file** — neither moves; merging two guardrails is
 *   the project's call, not the upgrade's;
 * - **the old address is a link** — it stays: copying through it would make a
 *   tracked regular file of whatever it points at (plan 037 § 11 M2);
 * - **its bytes are not UTF-8** — it stays: the move writes the decoded text
 *   and deletes the bytes, so a lossy decode would lose them for good;
 * - **a write or delete fails** — that one move is reported, the rest proceed.
 *
 * `--dry-run` judges every move and writes nothing.
 */
export async function carryAddenda(ctx: AddendaMoveContext): Promise<void> {
  for (const move of addendumRenames()) {
    const from = addendumPath(move.from);
    const to = addendumPath(move.to);
    try {
      await carryOne(ctx, from, to, move.reason);
    } catch (err) {
      ctx.notes.push(`addendum ${from} is not moved to ${to}: ${why(err)}`);
    }
  }
}

async function carryOne(
  ctx: AddendaMoveContext,
  from: string,
  to: string,
  reason: string,
): Promise<void> {
  const source = await ctx.reader.readEntry(ctx.projectDir, from);
  if (source === null) return;
  if (source.kind === "symlink") {
    ctx.notes.push(
      `addendum ${from} is a link, so it is not moved to ${to} — no router reads it ` +
        `there; point a file at the new address yourself`,
    );
    return;
  }
  if (source.lossy) {
    ctx.notes.push(`addendum ${from} is not moved to ${to}: ${NOT_EXACT}`);
    return;
  }
  if (await ctx.reader.readEntry(ctx.projectDir, to) !== null) {
    ctx.notes.push(
      `addendum ${from} is not moved: ${to} already exists, and only that one is read — ` +
        `merge the two by hand`,
    );
    return;
  }
  if (ctx.dryRun) {
    ctx.notes.push(`addendum ${from} would move to ${to} (${reason})`);
    return;
  }
  await ctx.writer.writeBundle(
    { [to]: { content: source.content, executable: false } },
    ctx.projectDir,
    { overwrite: false },
  );
  // Bounded to the old address itself: under a linked folder it resolves
  // elsewhere, and is then left in place rather than deleted where it lands.
  const r = await ctx.writer.deletePaths([from], ctx.projectDir, {
    backupExisting: false,
    within: (resolved) => resolved === from,
  });
  ctx.notes.push(...(r.notes ?? []));
  ctx.notes.push(
    (r.refused ?? []).length > 0
      ? `addendum ${from} was copied to ${to} but not deleted: it resolves to another path — ` +
        `delete the old copy yourself`
      : `addendum ${from} moved to ${to} (${reason})`,
  );
}

/**
 * Why a file whose bytes are not UTF-8 stays where it is. One sentence for both
 * movers — this one and `upgrade_renames.ts` — so the refusal reads the same.
 */
export const NOT_EXACT = "its bytes are not valid UTF-8, and upgrade moves a file only " +
  "when it can write back exactly what it read — move it yourself";

const why = (err: unknown) => err instanceof Error ? err.message : String(err);
