/**
 * The host layout a sandbox is built over, the shape a path must have before a backend is given
 * it, and how two paths relate.
 *
 * A sandbox path ends up inside a quoted `sandbox-exec` rule, a comma-separated container mount
 * and a colon-separated tmpfs option. One character in the wrong place widens the sandbox rather
 * than failing, so every path is checked here, once, against all three syntaxes: absolute,
 * normalised, not the root, and free of quotes, backslashes, commas, colons and control
 * characters. Pure — no IO; POSIX paths only, the one form every backend reads.
 */

import { dirname, normalize } from "@std/path/posix";

/** The host's layout, as the caller resolved it: real paths, no link on the way. */
export type SandboxPaths = {
  /** The exported copy of the branch's tree: read-only, the working folder. */
  readonly tree: string;
  /** An empty private folder; the sandbox's home and temporary folders are made in it. */
  readonly scratch: string;
  /** Read-only folders holding the gates' tools; a container uses its image's instead. */
  readonly toolchain: readonly string[];
  /** Folders searched before the system's, each inside a folder that is read. */
  readonly path: readonly string[];
  /** The user's real home: neither it nor a folder holding it is ever visible. */
  readonly home: string;
  /** The user's checkout: no visible folder lies inside it or holds it. */
  readonly checkout: string;
};

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
