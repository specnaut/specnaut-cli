import type { DiskEntry } from "./context_link.ts";

/**
 * Whether a project-owned file can move from one address to another so that
 * the new address holds exactly what the old one held.
 *
 *   - `no-source`        nothing at the old address: nothing to move, nothing to say.
 *   - `source-link`      the old address is a link. Copying through it would make
 *                        a tracked regular file of whatever it points at, an
 *                        ignored secret included (plan 037 § 11 M2).
 *   - `source-lossy`     its bytes are not UTF-8. A move writes the decoded text
 *                        and deletes the bytes, so a lossy decode loses them.
 *   - `target-occupied`  something is already at the new address. A move never
 *                        writes over it: which of the two wins is the project's
 *                        call (plan 037 § 11 M3).
 *   - `ok`               `content` is the old file's bytes, safe to write back.
 */
export type ExactMoveVerdict =
  | { readonly kind: "no-source" }
  | { readonly kind: "source-link" }
  | { readonly kind: "source-lossy" }
  | { readonly kind: "target-occupied" }
  | { readonly kind: "ok"; readonly content: string };

/**
 * The one judgement every mover shares (spec 038, A-M2): the addenda mover,
 * the renamed-docs mover, and the constitution move built on top of it. Both
 * entries are read with `lstat`, so a link is seen as a link.
 *
 * The source is judged before the target: a link or a lossy file is refused
 * whatever sits at the new address, and the refusal names the file that has
 * to change, not the one in the way.
 */
export function judgeExactMove(
  source: DiskEntry | null,
  target: DiskEntry | null,
): ExactMoveVerdict {
  if (source === null) return { kind: "no-source" };
  if (source.kind === "symlink") return { kind: "source-link" };
  if (source.lossy) return { kind: "source-lossy" };
  if (target !== null) return { kind: "target-occupied" };
  return { kind: "ok", content: source.content };
}
