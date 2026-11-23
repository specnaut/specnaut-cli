import { invisibleReason, sameEntry } from "./instruction_head.ts";
import { type BaseEntry, REASON, type Untrusted } from "./script_trust.ts";
import { win32Name } from "./tree_names.ts";
import { refinedReason } from "./trust_reason.ts";
import { holdsShortName, win32Reason } from "./win32_path.ts";

/**
 * The files above a project that lives in a subfolder (part of the instruction class,
 * `instruction_trust.ts`): a harness started in the project reads `AGENTS.md` and `CLAUDE.md` in
 * every folder up to the repository's top, and git reads `.gitattributes` there. They are judged as HEAD commits them against the base's
 * tip, named relative to the project's folder (`../AGENTS.md`). The work tree's copies are not
 * walked: the walk stays inside the project, and the landing refuses a tree that is not clean.
 */

/**
 * The names read in each folder above the project: the instruction files a harness reads, the
 * `.gitattributes` git applies to every file below it, and `.lfsconfig`. git-lfs reads that one
 * only at the repository's top, so reading it in a folder between is reading too much: it only
 * names a file the branch changed.
 */
export const PARENT_NAMES: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  ".gitattributes",
  ".lfsconfig",
];

const FOLDED_NAMES = PARENT_NAMES.map(win32Name);

/**
 * Whether a name in a folder above the project is listed: one of {@link PARENT_NAMES} as Win32
 * opens it (any case, a trailing dot or space, a stream suffix), or a name shaped like an 8.3
 * short name, which a volume that keeps them may open as any of them (`win32_path.ts`).
 */
export const isParentName = (name: string): boolean =>
  FOLDED_NAMES.includes(win32Name(name)) || holdsShortName(name);

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

/**
 * Why HEAD's entry is not the tip's, or `null` when it is. A name the tip lacks that is not a
 * parent name as written is named for how Win32 reads it, else for its letter case.
 */
function headReason(e: BaseEntry, atTip?: BaseEntry, atOld?: BaseEntry): string | null {
  if (sameEntry(e, atTip)) return null;
  const name = e.path.slice(e.path.lastIndexOf("/") + 1);
  if (atTip === undefined && !PARENT_NAMES.includes(name)) {
    return win32Reason(name) ?? REASON.caseDiffers;
  }
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
