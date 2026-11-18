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

/** `path`'s entries that cannot supply a program from the tree `cwd` is in, in their order. */
export function gitPath(path: string, cwd: string, os: Os = Deno.build.os): string {
  const top = treeTop(cwd, os);
  return keptEntries(path, os, (entry) => entryUnsafe(entry, top, os));
}

/** `path` split on the platform's separator, joined back without the entries `unsafe` names. */
export function keptEntries(
  path: string,
  os: Os,
  unsafe: (entry: string) => string | undefined,
): string {
  const separator = os === "windows" ? ";" : ":";
  return path.split(separator).filter((entry) => unsafe(entry) === undefined).join(separator);
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
 * resolved, that holds a `.git`, found without git, which is the program being looked up. With none
 * (a bare repository, or no repository at all) `cwd` itself, so its own folders still count in.
 */
export function treeTop(cwd: string, os: Os = Deno.build.os): string {
  const path = pathApi(os);
  const real = attempt(() => Deno.realPathSync(cwd)) ?? cwd;
  const holdsGit = (dir: string) => attempt(() => Deno.statSync(path.join(dir, ".git")));
  return upFrom(real, path).find((dir) => holdsGit(dir) !== undefined) ?? real;
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

/** `read()`, or undefined when no file is there for this process; any other failure throws. */
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (err) {
    if (UNREACHABLE.some((c) => err instanceof c)) return undefined;
    throw err;
  }
}

const pathApi = (os: Os): PathApi => os === "windows" ? windows : posix;
