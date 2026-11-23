import { invisibleReason, sameEntry } from "./instruction_head.ts";
import { type BaseEntry, REASON, type Untrusted } from "./script_trust.ts";
import { win32Name } from "./tree_names.ts";
import { refinedReason } from "./trust_reason.ts";
import { holdsShortName, win32Reason } from "./win32_path.ts";

/**
 * The files above a project that lives in a subfolder (part of the instruction class,
 * `instruction_trust.ts`): a harness started in the project reads `AGENTS.md` and `CLAUDE.md` in
 * every folder up to the repository's top, and git reads `.gitattributes` there. They are judged
 * as HEAD commits them against the base's tip, named relative to the project's folder
 * (`../AGENTS.md`), with every file below a folder a disk may open as one on the way to the
 * project ({@link isChainAlias}). The work tree's copies are not walked: the walk stays inside the
 * project, and the landing refuses a tree that is not clean.
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

/**
 * Whether a folder `name`, in a folder on the way from the repository's top to the project, may be
 * opened as `chain`, the next folder on that way: another spelling of it that a disk folding names
 * or Win32 opens as it (`win32Name`), or a name shaped like an 8.3 short name, which a volume that
 * keeps them may open as any folder. A checkout writes what such a folder holds into `chain`, the
 * project's own folder included, so all of it is listed.
 */
export const isChainAlias = (name: string, chain: string): boolean =>
  name !== chain && (win32Name(name) === win32Name(chain) || holdsShortName(name));

/** What `listParents` lists in each folder above the project: files, and folders read whole. */
export type ParentFilter = {
  readonly file: (name: string) => boolean;
  readonly folder: (name: string, chain: string) => boolean;
};

export const PARENT_FILTER: ParentFilter = { file: isParentName, folder: isChainAlias };

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
  const spelled = atTip === undefined ? spellingReason(e.path) : null;
  if (spelled !== null) return spelled;
  const otherwise = atTip === undefined ? REASON.notOnBase : REASON.differs;
  if (e.kind !== "blob") return sameEntry(e, atOld) ? REASON.behind : otherwise;
  const tipBytes = atTip?.kind === "blob" ? atTip.bytes : undefined;
  const mergeBase = atOld?.kind === "blob" ? atOld.bytes : undefined;
  return invisibleReason(e.bytes) ??
    refinedReason(e.bytes, { copies: [tipBytes], mergeBase }, otherwise);
}

/**
 * Why a path the tip lacks is named for its spelling, `null` for a parent name as written: a
 * parent name in another spelling, or a file below a folder {@link isChainAlias} lists, is named
 * for how Win32 reads it, else for its letter case.
 */
function spellingReason(path: string): string | null {
  const below = path.replace(/^(\.\.\/)+/, "");
  if (PARENT_NAMES.includes(below)) return null;
  return win32Reason(below) ?? REASON.caseDiffers;
}

function byPath(entries: readonly BaseEntry[]): ReadonlyMap<string, BaseEntry> {
  return new Map(entries.map((e) => [e.path, e]));
}
