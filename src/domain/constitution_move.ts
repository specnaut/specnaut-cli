import type { DiskEntry } from "./context_link.ts";
import { judgeExactMove } from "./exact_move.ts";
import { CONSTITUTION_PATH, LEGACY_CONSTITUTION_PATH } from "./constitution_paths.ts";

/**
 * An address the reader could not get past for a reason other than absence —
 * a permission, an I/O fault. Never the same as `null`: a file that cannot be
 * read is still there, and judging it absent writes the default beside it.
 */
export type UnreadableEntry = { readonly kind: "unreadable"; readonly reason: string };

/**
 * What happens to a constitution left at the legacy address (spec 038, FR-006).
 *
 *   - `none`             nothing at the old address. `bootstrap` says whether the
 *                        default may be written: only where the new address is
 *                        empty too.
 *   - `move`             the old file moves, byte for byte (`content`).
 *   - `dedupe`           both addresses hold the same text: the old one goes.
 *   - `refuse-conflict`  both hold different text, or the new address is not a
 *                        plain file: neither is touched — which wins is the team's call.
 *   - `refuse-link`      the old address is a link: never copied through.
 *   - `refuse-lossy`     its bytes are not UTF-8: a move would lose them.
 *   - `refuse-unreadable` an address that holds something could not be read
 *                        (`path`, `reason`): nothing can be judged, so nothing moves.
 *
 * Every verdict but `none` has `bootstrap: false`: the default must never
 * shadow a constitution the project already has, moved or refused.
 */
export type ConstitutionMove =
  | { readonly kind: "none"; readonly bootstrap: boolean }
  | { readonly kind: "move"; readonly bootstrap: false; readonly content: string }
  | {
    readonly kind: "dedupe" | "refuse-conflict" | "refuse-link" | "refuse-lossy";
    readonly bootstrap: false;
  }
  | {
    readonly kind: "refuse-unreadable";
    readonly bootstrap: false;
    readonly path: string;
    readonly reason: string;
  };

/**
 * Decides the move from what `lstat` sees at both addresses. Builds on
 * `judgeExactMove` (A-M2) and adds the one judgement only this move needs:
 * an occupied target holding the same document is a dedupe, not a conflict.
 * An unreadable address refuses whenever the old one is not plainly absent.
 */
export function planConstitutionMove(
  old: DiskEntry | UnreadableEntry | null,
  cur: DiskEntry | UnreadableEntry | null,
): ConstitutionMove {
  if (old?.kind === "unreadable") return unreadable(LEGACY_CONSTITUTION_PATH, old);
  if (old === null) return { kind: "none", bootstrap: cur === null };
  if (cur?.kind === "unreadable") return unreadable(CONSTITUTION_PATH, cur);
  const exact = judgeExactMove(old, cur);
  switch (exact.kind) {
    case "no-source":
      return { kind: "none", bootstrap: cur === null };
    case "source-link":
      return { kind: "refuse-link", bootstrap: false };
    case "source-lossy":
      return { kind: "refuse-lossy", bootstrap: false };
    case "ok":
      return { kind: "move", bootstrap: false, content: exact.content };
    case "target-occupied":
      return old?.kind === "file" && cur?.kind === "file" && cur.lossy !== true &&
          sameDocument(old.content, cur.content)
        ? { kind: "dedupe", bootstrap: false }
        : { kind: "refuse-conflict", bootstrap: false };
  }
}

const unreadable = (path: string, e: UnreadableEntry): ConstitutionMove => ({
  kind: "refuse-unreadable",
  bootstrap: false,
  path,
  reason: e.reason,
});

/**
 * "Identical" for a dedupe: equal once line endings are LF and trailing
 * newlines are dropped. A Windows checkout converts LF to CRLF, and an editor
 * adds or strips the final newline; neither is a second version of the rules,
 * and refusing on it would leave two copies for no reason.
 */
export function sameDocument(a: string, b: string): boolean {
  const norm = (s: string) => s.replaceAll("\r\n", "\n").replace(/\n+$/, "");
  return norm(a) === norm(b);
}
