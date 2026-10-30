import type { FsReader, FsWriter } from "./ports.ts";
import { addendumPath, addendumRenames } from "../domain/addendum_audit.ts";
import { judgeExactMove } from "../domain/exact_move.ts";
import { exactMoveRefusal, moveExact } from "./upgrade_exact_move.ts";

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
 * `--dry-run` judges every move and writes nothing — so it cannot read a
 * destination an earlier move would have filled. Several moves end at one
 * address (`task/implement` takes the `implement` move and both `tasks` folds),
 * so the run keeps the addresses already taken (`claimed`) and refuses a later
 * move into one exactly as the real run's disk would (cli#709).
 */
export async function carryAddenda(ctx: AddendaMoveContext): Promise<void> {
  const claimed = new Set<string>();
  for (const move of addendumRenames()) {
    const from = addendumPath(move.from);
    const to = addendumPath(move.to);
    try {
      if (await carryOne(ctx, from, to, move.reason, claimed.has(to))) claimed.add(to);
    } catch (err) {
      ctx.notes.push(`addendum ${from} is not moved to ${to}: ${why(err)}`);
    }
  }
}

/** One move; `true` when `to` now holds (or, dry, would hold) the addendum. */
async function carryOne(
  ctx: AddendaMoveContext,
  from: string,
  to: string,
  reason: string,
  taken: boolean,
): Promise<boolean> {
  const judged = judgeExactMove(
    await ctx.reader.readEntry(ctx.projectDir, from),
    await ctx.reader.readEntry(ctx.projectDir, to),
  );
  // The source is still judged first: a link or lossy file is named as such.
  const verdict = judged.kind === "ok" && taken ? { kind: "target-occupied" as const } : judged;
  const what = `addendum ${from}`;
  if (verdict.kind !== "ok") {
    const refusal = exactMoveRefusal(verdict, what, to);
    if (refusal !== null) ctx.notes.push(refusal);
    return false;
  }
  if (ctx.dryRun) {
    ctx.notes.push(`${what} would move to ${to} (${reason})`);
    return true;
  }
  const outcome = await moveExact(ctx, what, from, to, verdict.content);
  if (outcome === "moved") ctx.notes.push(`${what} moved to ${to} (${reason})`);
  return outcome !== "failed";
}

const why = (err: unknown) => err instanceof Error ? err.message : String(err);
