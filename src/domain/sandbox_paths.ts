/**
 * The shape a path must have before a sandbox backend is given it, and how two paths relate.
 *
 * A sandbox path ends up inside a quoted `sandbox-exec` rule, a comma-separated container mount
 * and a colon-separated tmpfs option. One character in the wrong place widens the sandbox rather
 * than failing, so every path is checked here, once, against all three syntaxes: absolute,
 * normalised, not the root, and free of quotes, backslashes, commas, colons and control
 * characters. Pure — no IO; POSIX paths only, the one form every backend reads.
 */

import { dirname, normalize } from "@std/path/posix";

/** A character one of the backends' syntaxes would read as structure, or a control character. */
// deno-lint-ignore no-control-regex
const UNQUOTABLE = /["\\,:\u0000-\u001f\u007f]/;

/** Why `path` cannot be given to a backend, or `null` when it can. */
export function pathProblem(path: string): string | null {
  if (!path.startsWith("/")) return "is not absolute";
  if (UNQUOTABLE.test(path)) return "holds a character a backend cannot quote";
  if (path === "/") return "is the root folder";
  if (normalize(path) !== path || path.endsWith("/")) return "is not in plain form";
  return null;
}

/** `path`, unchanged, or a thrown error naming what is wrong with it. */
export function safePath(path: string): string {
  const problem = pathProblem(path);
  if (problem !== null) throw new Error(`sandbox path ${JSON.stringify(path)} ${problem}`);
  return path;
}

/** Whether `inner` is `outer` or lies beneath it. */
export function within(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(`${outer}/`);
}

/** Whether either path is, or holds, the other. */
export function overlaps(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

/** Every folder above one of `paths`, the root included, sorted: what resolving them stats. */
export function ancestors(paths: readonly string[]): string[] {
  const above = new Set<string>();
  for (const path of paths) {
    for (let dir = dirname(path); !above.has(dir); dir = dirname(dir)) {
      above.add(dir);
      if (dir === "/") break;
    }
  }
  return [...above].sort();
}
