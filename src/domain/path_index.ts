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
 * Every other path HEAD holds under `target`'s folded name, whatever its kind but a folder: on a
 * disk that folds names, any of them may be the file a session opens, whether or not HEAD also
 * holds `target` as written.
 */
export function twinsAtHead(target: string, head: PathIndex): IndexedPath[] {
  return (head.get(fold(target)) ?? []).filter((p) => p.path !== target && p.kind !== "tree");
}

/** The first link among `path`'s folders, or `path` itself, folded. */
export function linkOnTheWay(path: string, index: PathIndex): IndexedPath | undefined {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const at = index.get(fold(parts.slice(0, i).join("/")));
    const link = at?.find((p) => p.kind === "link");
    if (link !== undefined) return link;
  }
  return undefined;
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
