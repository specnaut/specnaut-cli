import type { FsWriter } from "./ports.ts";
import type { ExactMoveVerdict } from "../domain/exact_move.ts";

/** What a byte move needs: the writer, the project, and where its outcome is said. */
export type ExactMoveIo = {
  readonly writer: FsWriter;
  readonly projectDir: string;
  /** Every failure and every writer note is said here — see `RenameContext.notes`. */
  readonly notes: string[];
};

/**
 * Why a file whose bytes are not UTF-8 stays where it is. One sentence for
 * every mover, so the refusal reads the same wherever it is printed.
 */
export const NOT_EXACT = "its bytes are not valid UTF-8, and upgrade moves a file only " +
  "when it can write back exactly what it read — move it yourself";

/**
 * The sentence a refused `judgeExactMove` verdict prints, or `null` when the
 * move may go ahead or there is nothing to move. One wording for every mover
 * (spec 038, A-M2): the addenda and the renamed docs used to refuse the same
 * thing in two different sentences. `what` names the file as the caller
 * reports it (`addendum <path>`, or the bare path).
 */
export function exactMoveRefusal(verdict: ExactMoveVerdict, what: string, to: string) {
  switch (verdict.kind) {
    case "target-occupied":
      return `${what} is not moved to ${to}: a file is already there, and it is kept as it is — ` +
        `merge the two by hand`;
    case "source-link":
      return `${what} is a link, so it is not moved to ${to} — upgrade never copies through a ` +
        `link; point it at the new address yourself`;
    case "source-lossy":
      return `${what} is not moved to ${to}: ${NOT_EXACT}`;
    case "ok":
    case "no-source":
      return null;
  }
}

/**
 * Moves `content` — the bytes `judgeExactMove` cleared — from `from` to `to`.
 *
 * - `moved`   written at `to`, and `from` deleted.
 * - `copied`  written at `to`, but `from` is still there: under a linked
 *             folder it resolves elsewhere and is left in place rather than
 *             deleted where it lands (`within`), or the delete failed. Both
 *             copies hold the bytes, so the caller treats the move as landed.
 * - `failed`  the write failed; nothing changed.
 *
 * No backup: the bytes were moved, not discarded — a `.specnaut.bak` beside
 * every moved file would be noise on an upgrade that lost nothing. Every
 * outcome but `moved` is said in `io.notes`; the success line is the caller's,
 * which alone knows why the file moved.
 */
export async function moveExact(
  io: ExactMoveIo,
  what: string,
  from: string,
  to: string,
  content: string,
): Promise<"moved" | "copied" | "failed"> {
  try {
    await io.writer.writeBundle({ [to]: { content, executable: false } }, io.projectDir, {
      overwrite: false,
    });
  } catch (err) {
    io.notes.push(`${what} is not moved to ${to}: ${why(err)}`);
    return "failed";
  }
  const deleted = await deleteExact(io, from);
  if (deleted.kind === "deleted") return "moved";
  io.notes.push(
    deleted.kind === "elsewhere"
      ? `${what} was copied to ${to} but not deleted: it resolves to another path — ` +
        `delete the old copy yourself once you have checked it`
      : `${what} was copied to ${to} but not deleted: ${deleted.reason}`,
  );
  return "copied";
}

/** How a bounded delete ended; see `deleteExact`. */
export type ExactDelete =
  | { readonly kind: "deleted" }
  | { readonly kind: "elsewhere" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Deletes `from` only where it is: under a linked folder it resolves
 * elsewhere, and is left (`elsewhere`) rather than deleted where it lands. No
 * backup — every caller has the same bytes at another address. The one home of
 * the bounded delete (spec 038, decision table): the move and the dedupe of the
 * constitution both end here. Writer notes are said in `io.notes`; what the
 * outcome means is the caller's to say.
 */
export async function deleteExact(io: ExactMoveIo, from: string): Promise<ExactDelete> {
  try {
    const r = await io.writer.deletePaths([from], io.projectDir, {
      backupExisting: false,
      within: (resolved) => resolved === from,
    });
    io.notes.push(...(r.notes ?? []));
    return (r.refused ?? []).length === 0 ? { kind: "deleted" } : { kind: "elsewhere" };
  } catch (err) {
    return { kind: "failed", reason: why(err) };
  }
}

const why = (err: unknown) => err instanceof Error ? err.message : String(err);
