import { canonical, climb } from "./project_path.ts";
import type { CommitEntry } from "./script_trust.ts";

/**
 * A commit's whole listing (`listPaths`) as the instruction walk looks a path up in it. A disk
 * that ignores letter case, and one that ignores Unicode normalisation (macOS), gives a session any
 * file whose name folds to the one it asked for; so every lookup is folded, and a link on the way
 * is followed to the file a session reads through it.
 */

/** One path of a commit, relative to the project's folder, with its kind and a link's target. */
export type IndexedPath = {
  readonly path: string;
  readonly kind: CommitEntry["kind"];
  readonly target?: string;
  /** A submodule's commit. */
  readonly commit?: string;
};

/** A commit's paths by their folded name. */
export type PathIndex = ReadonlyMap<string, readonly IndexedPath[]>;

/** A name as a case-blind, normalisation-blind disk compares it. */
export const fold = (path: string): string => path.normalize("NFC").toLowerCase();

export function pathIndex(paths: readonly IndexedPath[]): PathIndex {
  const index = new Map<string, IndexedPath[]>();
  for (const p of paths) {
    const key = fold(p.path);
    index.set(key, [...index.get(key) ?? [], p]);
  }
  return index;
}

/**
 * Every other spelling of `target` HEAD holds that a disk folding names may open instead: a path
 * under its folded name whatever its kind (a folder aside), and the target read through a link
 * under another spelling of one of its folders (`docs/rules.md` through a `Docs` link beside the
 * `docs/` folder). Whether or not HEAD also holds `target` as written.
 */
export function twinsAtHead(target: string, head: PathIndex): string[] {
  const parts = target.split("/");
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const step = parts.slice(0, i).join("/");
    const last = i === parts.length;
    for (const p of head.get(fold(step)) ?? []) {
      if (p.path === step || (last ? p.kind === "tree" : p.kind !== "link")) continue;
      out.push([p.path, ...parts.slice(i)].join("/"));
    }
  }
  return out;
}

/**
 * The first link on `path`'s way, `path` itself included: at each folder, the entry spelled as
 * written when the commit holds one, else one under another spelling (the one a disk folding
 * names opens). A link beside an entry spelled as written is not on the way: `twinsAtHead` names
 * the path through it as another file to judge.
 */
export const linkOnTheWay = (path: string, index: PathIndex) => onTheWay(path, index, "link");

/** The first submodule on `path`'s way, taken as {@link linkOnTheWay} takes a link. */
export const submoduleOnTheWay = (path: string, index: PathIndex) =>
  onTheWay(path, index, "submodule");

function onTheWay(path: string, index: PathIndex, kind: IndexedPath["kind"]) {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const step = parts.slice(0, i).join("/");
    const at = index.get(fold(step)) ?? [];
    const taken = at.find((p) => p.path === step) ?? at.find((p) => p.kind === kind);
    if (taken?.kind === kind) return taken;
  }
  return undefined;
}

/**
 * The submodule on `path`'s way at HEAD or the tip, when the two do not hold it at the same
 * commit: what a session reads inside it changes with no file of the repository changing.
 */
export function submoduleMoved(path: string, head: PathIndex, tip: PathIndex): string | undefined {
  const [atHead, atTip] = [submoduleOnTheWay(path, head), submoduleOnTheWay(path, tip)];
  if (atHead?.path === atTip?.path && atHead?.commit === atTip?.commit) return undefined;
  return (atHead ?? atTip)!.path;
}

/** Where a path leads through the links on its way: a path in the repository, or the link that leaves it. */
export type Through = { readonly end: string } | { readonly outside: string };

/** More links than this on one path is a loop: it leads nowhere a session can read. */
const MAX_LINKS = 16;

/**
 * Where `path` leads in the commit `index` lists, each link on its way replaced by its end: the
 * file a session reads there. A link whose end is absolute, empty, or above the repository's top
 * (the project's folder is `prefix`) is the `outside` it leads to.
 */
export function throughLinks(prefix: string, path: string, index: PathIndex): Through {
  let at = path;
  for (let hop = 0; hop < MAX_LINKS; hop++) {
    const link = linkOnTheWay(at, index);
    if (link === undefined) return { end: at };
    const end = linkEnd(prefix, link);
    if (end === null) return { outside: link.path };
    const rest = at.split("/").slice(link.path.split("/").length);
    at = canonical(prefix, [end, ...rest].join("/")) ?? end;
  }
  return { outside: path };
}

function linkEnd(prefix: string, link: IndexedPath): string | null {
  const target = link.target ?? "";
  if (target === "" || target.startsWith("/") || /^[A-Za-z]:/.test(target)) return null;
  return canonical(prefix, climb(link.path.split("/").slice(0, -1), target).join("/"));
}
