import { isAbsolute, normalize, relative, SEPARATOR } from "@std/path";
import { hasControl, terminalText } from "./terminal_text.ts";

/**
 * The string half of containment: which destination a project-relative path may
 * name, and whether one path lies inside another. Pure — no IO; the filesystem
 * half, which resolves links, is `fs_containment.ts`.
 */

/**
 * True when `target` is `root` itself or lies beneath it. Pure — no IO, and
 * that is the whole point: this is the half of containment that can be decided
 * from two strings, so it can live here beside the string rule below instead of
 * inside the adapter that happens to need it first.
 *
 * **Both arguments must already be resolved the same way.** Comparing a
 * `realPath`'d root against a lexical candidate returns a `../..` chain for
 * every path on macOS, where a temp directory sits under the `/var` →
 * `/private/var` link — so the caller either resolves both sides or neither.
 * Reproduced in both directions before this function existed.
 *
 * `relative()`, never a string prefix. A prefix test hardcodes the POSIX
 * separator, so it silently never fires on Windows — `pruneEmptyParents` (`fs_prune.ts`)
 * shipped exactly that bug once — and it is wrong on POSIX too: `/a/bc` starts
 * with `/a/b` while being nowhere inside it.
 *
 * Equality counts as inside: `relative(root, root)` is `""`, and a root is not
 * outside itself.
 */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel);
}

/**
 * Throws if the destination path is unsafe: absolute, an attempt to escape the
 * target directory via "..", the target directory itself, or a name the
 * filesystem may read as something else. Pure — no IO.
 *
 * The last two because a destination names a file (cli#669). `.` (or `a/..`,
 * `""`, `./`) names the project: `deletePaths` with `backupExisting` renamed
 * the whole project folder aside on one. A trailing separator makes the kernel
 * follow a leaf link the containment check took as is, and Windows drops a
 * segment's trailing dots and spaces, so `...` names the project there too.
 *
 * A control character first (cli#776): no file Specnaut ships has one, and a
 * lock key is repository-supplied, so its refusal would put the bytes on the
 * user's terminal. Every refusal shows `dest` through `terminalText` for the
 * characters that are no control but still act on a terminal (bidi, zero-width).
 */
export function assertSafeDestination(dest: string): void {
  if (hasControl(dest)) {
    throw new Error(`Unsafe destination (a control character): ${terminalText(dest)}`);
  }
  const normalized = normalize(dest);
  if (isAbsolute(normalized)) {
    throw new Error(`Unsafe destination (absolute path): ${terminalText(dest)}`);
  }
  if (normalized.replace(/[\\/]+$/, "") === ".") {
    throw new Error(`Unsafe destination (the target directory itself): ${terminalText(dest)}`);
  }
  if (
    normalized === ".." ||
    normalized.startsWith(`..${SEPARATOR}`) ||
    normalized.includes(`${SEPARATOR}..${SEPARATOR}`) ||
    normalized.endsWith(`${SEPARATOR}..`)
  ) {
    throw new Error(`Unsafe destination (escape attempt): ${terminalText(dest)}`);
  }
  if (/[\\/]$/.test(normalized) || normalized.split(/[\\/]/).some((s) => /[. ]$/.test(s))) {
    throw new Error(
      `Unsafe destination (a name the filesystem may read differently): ${terminalText(dest)}`,
    );
  }
}
