import * as posix from "@std/path/posix";
import * as windows from "@std/path/windows";
import { UNREACHABLE } from "./fs_containment.ts";

/**
 * The PATH the binary starts git with: only the entries no checkout can supply a program from. git
 * is started by its bare name, so it is looked up on that PATH; an empty or a relative entry is
 * searched from the working folder, and an entry in the tree finds what a branch put there, so
 * either one could supply the `git` that reads an unvetted repository. The rule is the scripts'
 * (`entry_unsafe` in `_verifier.sh`); where the landing refuses such a PATH, the binary drops the
 * entries, as the hooks do, and git is looked up on what is left. One table holds the two equal:
 * `tests/scripts/resolve_verifier_test.ts`.
 */

type Os = typeof Deno.build.os;
type PathApi = Pick<typeof posix, "dirname" | "join">;

const INSIDE = "is inside the repository";
const UNENTERABLE = "names a folder that cannot be entered";
/**
 * Absolute on Windows: a drive and its root (`C:\`), or a share (`\\host\share`). `\bin` hangs off
 * the current drive and `C:bin` off that drive's current folder, so neither is.
 */
const WINDOWS_ABSOLUTE = /^([A-Za-z]:[\\/]|[\\/]{2}[^\\/])/;

/** A PATH entry left out of git's, and why. */
export type Dropped = { readonly entry: string; readonly why: string };

/** git's PATH, and the first entry left out of it: a git not found names it (`gitMissing`). */
export type FilteredPath = { readonly kept: string; readonly dropped: Dropped | undefined };

/**
 * `path`'s entries that cannot supply a program from the tree `cwd` is in, in their order, split
 * and joined on `os`'s separator, and the first entry left out.
 */
export function filterGitPath(path: string, cwd: string, os: Os = Deno.build.os): FilteredPath {
  const top = treeTop(cwd, os);
  return sortEntries(path, os, (entry) => entryUnsafe(entry, top, os));
}

function sortEntries(
  path: string,
  os: Os,
  unsafe: (entry: string) => string | undefined,
): FilteredPath {
  const separator = os === "windows" ? ";" : ":";
  const kept: string[] = [];
  let dropped: Dropped | undefined;
  for (const entry of path.split(separator)) {
    const why: string | undefined = unsafe(entry) === "" ? "" : undefined;
    if (why === undefined) kept.push(entry);
    else dropped ??= { entry, why };
  }
  return { kept: kept.join(separator), dropped };
}

/**
 * What a git that cannot be started is refused with: `missing`, then the first entry left out and
 * why. The git the user expects may sit on that entry, and "not on the PATH" alone would send them
 * looking for it where it is.
 */
export function gitMissing(missing: string, dropped: Dropped | undefined): string {
  if (dropped === undefined) return missing;
  return `${missing}; the entry "${dropped.entry}" was left out because it ${dropped.why}`;
}

/** Why `entry` can supply a program from the tree whose top is `top`; undefined when it cannot. */
export function entryUnsafe(
  entry: string,
  top: string,
  os: Os = Deno.build.os,
): string | undefined {
  return spellingUnsafe(entry, os) ?? entryInTree(entry, top, pathApi(os));
}

/** What the spelling alone says: empty, not absolute, or with a `.` or `..` component. */
export function spellingUnsafe(entry: string, os: Os = Deno.build.os): string | undefined {
  if (entry === "") return "is empty";
  const win = os === "windows";
  if (!(win ? WINDOWS_ABSOLUTE.test(entry) : entry.startsWith("/"))) {
    return "is not an absolute path";
  }
  const parts = entry.split(win ? /[\\/]/ : "/");
  return parts.some((p) => p === "." || p === "..") ? "has a . or .. component" : undefined;
}

/**
 * The top of the tree `cwd` is in, `tree_top` in the scripts: the nearest folder at or above it,
 * resolved, that holds a `.git` folder, found without git, which is the program being looked up.
 * A `.git` file (a submodule's, a linked work tree's) is walked through: the superproject's own
 * folders are the same checkout's, so its PATH entries are in too. With no `.git` folder above
 * one, the outermost folder holding a `.git` file. A bare repository holds none, so one nested
 * in a work tree has that tree's top, the wider of the two. With no `.git` at or above (a bare
 * repository outside any work tree, or no repository) `cwd` itself, so its own folders count in.
 */
export function treeTop(cwd: string, os: Os = Deno.build.os): string {
  const path = pathApi(os);
  const real = attempt(() => Deno.realPathSync(cwd)) ?? cwd;
  let top: string | undefined;
  for (const dir of upFrom(real, path)) {
    const git = attempt(() => Deno.statSync(path.join(dir, ".git")));
    if (git === undefined) continue;
    top = dir;
    if (!git.isFile) break;
  }
  return top ?? real;
}

/**
 * `entry_in_tree`: spelled in the tree, an entry is in it, since a link there points where the
 * branch says. Else the longest part of it that is there is resolved, every link followed, and
 * walked up the same way. A part that is there and is not a folder this process can enter (a file,
 * a dangling link) could be made one: it counts in.
 */
function entryInTree(entry: string, top: string, path: PathApi): string | undefined {
  const isTop = sameAs(top);
  if (upFrom(entry, path).some(isTop)) return INSIDE;
  const there = upFrom(entry, path).find((p) => attempt(() => Deno.lstatSync(p)) !== undefined);
  const real = there === undefined ? undefined : attempt(() => Deno.realPathSync(there));
  if (real === undefined || !attempt(() => Deno.statSync(real))?.isDirectory) return UNENTERABLE;
  return upFrom(real, path).some(isTop) ? INSIDE : undefined;
}

/** `p`, then every folder above it as it is spelled, up to its root. */
function upFrom(p: string, path: PathApi): string[] {
  const all = [p];
  for (let up = path.dirname(p); up !== all.at(-1); up = path.dirname(up)) all.push(up);
  return all;
}

/**
 * Whether a path names the folder `top` names, compared as `-ef` compares, by device and file id,
 * so neither case nor a spelling hides it; by resolved path where the platform gives no id.
 */
function sameAs(top: string): (p: string) => boolean {
  const want = identity(top);
  return (p) => want !== undefined && identity(p) === want;
}

function identity(p: string): string | undefined {
  const info = attempt(() => Deno.statSync(p));
  if (info === undefined) return undefined;
  return info.ino === null ? attempt(() => Deno.realPathSync(p)) : `${info.dev}:${info.ino}`;
}

/**
 * `read()`, or undefined when no file is there for this process; any other failure throws. The one
 * guarded stat of both lookups, git's PATH and a program's (`programOnPath`), so the two never
 * differ on which entry is unreadable and which failure is a fault.
 */
export function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (err) {
    if (UNREACHABLE.some((c) => err instanceof c)) return undefined;
    throw err;
  }
}

const pathApi = (os: Os): PathApi => os === "windows" ? windows : posix;
