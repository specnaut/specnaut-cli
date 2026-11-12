import type { CheckoutEntry } from "./checkout_trust.ts";
import { inDeepRoot } from "./checkout_scope.ts";
import { type BaseEntry, REASON } from "./script_trust.ts";

/**
 * How the checkout precondition (`checkout_trust.ts`) judges a link among the checked files: its
 * own module, so the rule for files and commits and the rule for links each stay one screen.
 */

/**
 * Where a link leads, as the walk resolved it on disk: a path relative to the project's real root
 * with the file's identity (`dev:ino`, `null` where the platform has none), or why it leads nowhere
 * the check can follow.
 */
export type LinkEnd =
  | { readonly kind: "inside"; readonly path: string; readonly id: string | null }
  | { readonly kind: "outside" }
  | { readonly kind: "unresolved"; readonly why: string };

/** The reasons a link adds; `CHECKOUT_REASON` carries them too. */
export const LINK_REASON = {
  linkLeaves: "a link out of the checked files",
  linkForm: "a link target with a backslash or a drive",
  linkUnresolved: "a link that leads nowhere",
} as const;

/**
 * A link holds only as the tip's own link, written with forward slashes and no drive, and only when
 * it leads, on disk, to a file this check compared (the same `dev:ino`) or into a root it walks
 * whole. A link into the project's other files, a subfolder no root walks, or out of the project
 * leads where the check cannot vouch for.
 */
export function linkReason(
  entry: Extract<CheckoutEntry, { kind: "link" }>,
  base: BaseEntry,
  ids: ReadonlySet<string>,
): string | null {
  if (base.kind !== "link" || entry.target === undefined || entry.target !== base.target) {
    return REASON.differs;
  }
  if (/\\|^[A-Za-z]:/.test(entry.target)) return LINK_REASON.linkForm;
  const end = entry.end;
  if (end === undefined || end.kind === "outside") return LINK_REASON.linkLeaves;
  if (end.kind === "unresolved") return `${LINK_REASON.linkUnresolved}: ${end.why}`;
  if (end.id !== null && ids.has(end.id)) return null;
  return inDeepRoot(end.path) ? null : LINK_REASON.linkLeaves;
}
