import { sameBytes } from "./bytes.ts";
import type { CheckoutEntry, HoldsTip } from "./checkout_trust.ts";
import { type BaseEntry, REASON } from "./script_trust.ts";
import { refinedReason } from "./trust_reason.ts";

/**
 * The instruction class judged at HEAD (`instruction_trust.ts`): what lands is HEAD's commit, and
 * the tip check reads the work tree, which need not be HEAD's. A change committed and then
 * restored in the tree, or hidden from git by `skip-worktree` or `assume-unchanged`, leaves a tree
 * that holds the tip's bytes over a HEAD that does not: each such path is named here.
 */

/** The reasons this class adds to `REASON`. */
export const INSTRUCTION_REASON = { notHead: "work tree differs from HEAD" } as const;

/** One path's entry in the tree, at HEAD and at the tip. */
export type Sides = {
  readonly tree: ReadonlyMap<string, CheckoutEntry>;
  readonly head: ReadonlyMap<string, BaseEntry>;
  readonly tip: ReadonlyMap<string, BaseEntry>;
};

/**
 * Adds to `reasons`, the tip check's by path, each path where the tree is not HEAD's, then each
 * where HEAD is not the tip's though the tree holds both.
 */
export function headReasons(reasons: Map<string, string>, sides: Sides, holds: HoldsTip): void {
  for (const path of new Set([...sides.tree.keys(), ...sides.head.keys()])) {
    const off = notHeadReason(sides.tree.get(path), sides.head.get(path), holds);
    const had = reasons.get(path);
    if (off === null || (had !== undefined && !CONTENT.has(had))) continue;
    if (had === undefined || off === INSTRUCTION_REASON.notHead) reasons.set(path, off);
  }
  landReasons(reasons, sides);
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
 * Why the tree's entry is not HEAD's, or `null` when it is. The reason replaces one about the
 * tree's bytes alone, `behind` included: a tree at the merge base's bytes over a HEAD that changed
 * them is no lag a rebase settles. A tree that is HEAD's but for line endings says so only where
 * the tip check said nothing: what HEAD changed against the tip is the better reason.
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

function sameEntry(a: BaseEntry, b: BaseEntry): boolean {
  if (a.kind === "blob") return b.kind === "blob" && sameBytes(a.bytes, b.bytes);
  if (a.kind === "link") return b.kind === "link" && a.target === b.target;
  return b.kind === "submodule";
}
