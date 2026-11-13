import { sameBytes } from "./bytes.ts";
import type { CheckoutEntry, HoldsTip } from "./checkout_trust.ts";
import { invisibleIn } from "./invisible_text.ts";
import { type BaseEntry, REASON, type Untrusted } from "./script_trust.ts";
import { refinedReason } from "./trust_reason.ts";

/**
 * The instruction class judged at HEAD (`instruction_trust.ts`): what lands is HEAD's commit, and
 * the tip check reads the work tree, which need not be HEAD's. A change committed and then
 * restored in the tree, or hidden from git by `skip-worktree` or `assume-unchanged`, leaves a tree
 * that holds the tip's bytes over a HEAD that does not: each such path is named here.
 */

/** The reasons this class adds to `REASON`. */
export const INSTRUCTION_REASON = {
  notHead: "work tree differs from HEAD",
  invisible: "holds invisible characters",
} as const;

/**
 * Why HEAD's `bytes` at a path the branch changed cannot be read in a diff: the invisible code
 * points they hold (`invisible_text.ts`), escaped, or `null`. A file the tip holds as it is asks
 * nothing, so it is never judged here.
 */
export function invisibleReason(bytes: Uint8Array): string | null {
  const found = invisibleIn(bytes);
  return found === null ? null : `${INSTRUCTION_REASON.invisible}: ${found}`;
}

/** Each blob among HEAD's `entries` whose bytes are not the tip's and hold invisible characters. */
export function invisibleReasons(
  entries: readonly BaseEntry[],
  tip: ReadonlyMap<string, BaseEntry>,
): Untrusted[] {
  return entries.flatMap((e) => {
    if (e.kind !== "blob" || sameEntry(e, tip.get(e.path))) return [];
    const reason = invisibleReason(e.bytes);
    return reason === null ? [] : [{ path: e.path, reason }];
  });
}

/** One path's entry in the tree, at HEAD and at the tip. */
export type Sides = {
  readonly tree: ReadonlyMap<string, CheckoutEntry>;
  /** The folders whose walk stopped: the tree's side of a path below one is not known. */
  readonly blocked: readonly string[];
  readonly head: ReadonlyMap<string, BaseEntry>;
  readonly tip: ReadonlyMap<string, BaseEntry>;
};

/**
 * Adds to `reasons`, the tip check's by path, each path where the tree is not HEAD's, then each
 * where HEAD is not the tip's though the tree holds both. A path below a folder the walk could not
 * enter is not judged here: the folder's own line already names it.
 */
export function headReasons(reasons: Map<string, string>, sides: Sides, holds: HoldsTip): void {
  for (const path of new Set([...sides.tree.keys(), ...sides.head.keys()])) {
    if (sides.blocked.some((b) => path.startsWith(`${b}/`))) continue;
    const off = notHeadReason(sides.tree.get(path), sides.head.get(path), holds);
    const had = reasons.get(path);
    if (off !== null && replaces(off, had)) reasons.set(path, off);
  }
  landReasons(reasons, sides);
}

/**
 * Whether HEAD's reason takes the place of the tip check's: always where there is none, or where
 * it says `behind` (no rebase settles a tree that is not HEAD's), else only over a reason about
 * the tree's bytes, and then only `work tree differs from HEAD`: a tree that is HEAD's but for line
 * endings keeps what HEAD changed against the tip.
 */
function replaces(off: string, had: string | undefined): boolean {
  if (had === undefined || had === REASON.behind) return true;
  return CONTENT.has(had) && off === INSTRUCTION_REASON.notHead;
}

/** The reasons that judge only the tree's bytes, which do not land when the tree is not HEAD's. */
const CONTENT: ReadonlySet<string> = new Set([
  REASON.differs,
  REASON.notOnBase,
  REASON.missing,
  REASON.behind,
  REASON.lineEndings,
]);

/**
 * Why the tree's entry is not HEAD's, or `null` when it is; {@link replaces} says which reason
 * stands.
 */
function notHeadReason(
  mine: CheckoutEntry | undefined,
  atHead: BaseEntry | undefined,
  holds: HoldsTip,
): string | null {
  if (mine === undefined || atHead === undefined) {
    return mine === atHead ? null : INSTRUCTION_REASON.notHead;
  }
  if (mine.kind === "link") {
    return atHead.kind === "link" && atHead.target === mine.target
      ? null
      : INSTRUCTION_REASON.notHead;
  }
  if (mine.kind !== "file" || holds(mine, atHead)) return null;
  const copies = [atHead.kind === "blob" ? atHead.bytes : undefined];
  return refinedReason(mine.bytes, { copies }, INSTRUCTION_REASON.notHead);
}

/**
 * Each path where HEAD's entry is not the tip's though the tree holds both: where links are off,
 * git writes a link and a file of its target alike, and a link committed as that file lands.
 */
function landReasons(reasons: Map<string, string>, sides: Sides): void {
  for (const [path, atHead] of sides.head) {
    const atTip = sides.tip.get(path);
    if (atTip !== undefined && !reasons.has(path) && !sameEntry(atHead, atTip)) {
      reasons.set(path, REASON.differs);
    }
  }
}

function sameEntry(a: BaseEntry, b: BaseEntry | undefined): boolean {
  if (b === undefined) return false;
  if (a.kind === "blob") return b.kind === "blob" && sameBytes(a.bytes, b.bytes);
  if (a.kind === "link") return b.kind === "link" && a.target === b.target;
  return b.kind === "submodule";
}
