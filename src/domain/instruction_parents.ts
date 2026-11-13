import { invisibleReason, sameEntry } from "./instruction_head.ts";
import { type BaseEntry, REASON, type Untrusted } from "./script_trust.ts";
import { refinedReason } from "./trust_reason.ts";

/**
 * The instruction files above a project that lives in a subfolder (part of the instruction class,
 * `instruction_trust.ts`): a harness started in the project reads `AGENTS.md` and `CLAUDE.md` in
 * every folder up to the repository's top. They are judged as HEAD commits them against the base's
 * tip, named relative to the project's folder (`../AGENTS.md`). The work tree's copies are not
 * walked: the walk stays inside the project, and the landing refuses a tree that is not clean.
 */

/** The names a harness reads in each folder above the project. */
export const PARENT_INSTRUCTIONS: readonly string[] = ["AGENTS.md", "CLAUDE.md"];

/** The parent files at HEAD, the base's tip and the merge base, as `listParents` lists them. */
export type ParentSides = {
  readonly head: readonly BaseEntry[];
  readonly tip: readonly BaseEntry[];
  readonly mergeBase: readonly BaseEntry[];
};

/** One reason per parent path HEAD does not hold as the tip does, in path order. */
export function parentReasons(sides: ParentSides): Untrusted[] {
  const tip = byPath(sides.tip);
  const old = byPath(sides.mergeBase);
  const head = byPath(sides.head);
  const out: Untrusted[] = [];
  for (const e of sides.head) {
    const reason = headReason(e, tip.get(e.path), old.get(e.path));
    if (reason !== null) out.push({ path: e.path, reason });
  }
  for (const t of sides.tip) {
    // A tip file the merge base lacks was added by the base since the branch left it.
    if (!head.has(t.path)) out.push({ path: t.path, reason: lostReason(old.has(t.path)) });
  }
  return out.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

const lostReason = (hadIt: boolean) => hadIt ? REASON.missing : REASON.behind;

/** Why HEAD's entry is not the tip's, or `null` when it is. */
function headReason(e: BaseEntry, atTip?: BaseEntry, atOld?: BaseEntry): string | null {
  if (sameEntry(e, atTip)) return null;
  const name = e.path.slice(e.path.lastIndexOf("/") + 1);
  if (atTip === undefined && !PARENT_INSTRUCTIONS.includes(name)) return REASON.caseDiffers;
  const otherwise = atTip === undefined ? REASON.notOnBase : REASON.differs;
  if (e.kind !== "blob") return sameEntry(e, atOld) ? REASON.behind : otherwise;
  const tipBytes = atTip?.kind === "blob" ? atTip.bytes : undefined;
  const mergeBase = atOld?.kind === "blob" ? atOld.bytes : undefined;
  return invisibleReason(e.bytes) ??
    refinedReason(e.bytes, { copies: [tipBytes], mergeBase }, otherwise);
}

function byPath(entries: readonly BaseEntry[]): ReadonlyMap<string, BaseEntry> {
  return new Map(entries.map((e) => [e.path, e]));
}
