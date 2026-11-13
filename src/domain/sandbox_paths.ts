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
  /**
   * The user's real home: neither it, a folder holding it, nor a folder in it outside its
   * toolchains (`HOME_TOOLCHAINS`) is ever visible.
   */
  readonly home: string;
  /** The user's checkout: no visible folder lies inside it or holds it. */
  readonly checkout: string;
  /**
   * The toolchain receipts the host found in the home (`HOME_RECEIPTS`), as real paths: never
   * read, though a folder the sandbox reads holds them.
   */
  readonly receipts: readonly string[];
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

/**
 * The folders in a home a sandbox may read: where toolchains keep the tools a gate runs, not where
 * logins are kept. A visible folder in the home must be one of these or lie inside one, and every
 * other is refused: the credential folders (`~/.ssh`, `~/.aws`, `~/.config`, `~/.cargo` itself)
 * and any folder no one has looked at alike. A list of the places to refuse would expose each one
 * it left out. `*` is one folder name, a version. Paths under the home, `/`-separated.
 *
 * Two of them hold more than tools. `~/.local/bin` is the user's own space too: a script they put
 * there is read like any tool, whatever it holds. And a pipx or uv venv keeps, beside the
 * `pyvenv.cfg` Python needs, a receipt naming the index or git URL it came from, which can carry a
 * login: those files are never read (`HOME_RECEIPTS`).
 */
export const HOME_TOOLCHAINS: readonly string[] = [
  ".cargo/bin", // what cargo installs, and rustup's proxies
  ".rustup/toolchains", // the Rust toolchains themselves
  ".deno/bin",
  ".bun/bin",
  "go/bin", // what `go install` builds
  ".local/bin", // pip --user, pipx and uv tool commands: links into the next three
  ".local/share/pipx/venvs",
  ".local/share/uv/tools", // not `uv` whole: it keeps its logins in `credentials`
  ".local/share/uv/python",
  ".nvm/versions/node/*/bin",
  ".nvm/versions/node/*/lib", // npm and global packages, which `bin` links into; not `etc/npmrc`
];

/**
 * The receipts a venv in a listed toolchain folder keeps: where it was installed from, an index or
 * git URL that can carry a login. The host finds the ones there are; the sandbox never reads them,
 * though it reads the venv. `*` is one venv. Paths under the home, `/`-separated.
 */
export const HOME_RECEIPTS: readonly string[] = [
  ".local/share/pipx/venvs/*/pipx_metadata.json",
  ".local/share/uv/tools/*/uv-receipt.toml",
];

/**
 * The first reason a layout would expose the home, a folder in it outside its toolchains, the
 * checkout or a read-only folder: `readOnly` is every folder the sandbox only reads, `path` the
 * PATH entries searched before the system's. Every path is a real path: the caller resolves links
 * first.
 */
export function layoutProblem(
  paths: SandboxPaths,
  readOnly: readonly string[],
  path: readonly string[],
): string | null {
  const given = [paths.tree, paths.scratch, paths.home, paths.checkout, ...readOnly, ...path];
  given.push(...paths.receipts);
  for (const p of given) {
    const problem = pathProblem(p);
    if (problem !== null) return `${JSON.stringify(p)} ${problem}`;
  }
  for (const p of [...readOnly, paths.scratch]) {
    const exposed = exposureOf(p, paths);
    if (exposed !== null) return exposed;
  }
  const shared = readOnly.find((p) => overlaps(p, paths.scratch));
  if (shared) return `the scratch folder overlaps ${shared}, which is only read`;
  const stray = path.find((p) => !readOnly.some((r) => within(p, r)));
  return stray ? `PATH entry ${stray} is in no folder the sandbox reads` : null;
}

/**
 * What the visible folder `p` would expose: the home, the checkout, a folder in the home outside
 * its toolchains. The tree and the scratch folder are the caller's own, made in its cache, which
 * may lie in the home: they are not judged by the list.
 */
function exposureOf(p: string, paths: SandboxPaths): string | null {
  if (within(paths.home, p)) return `${p} is or holds the home folder`;
  if (overlaps(p, paths.checkout)) return `${p} overlaps the checkout`;
  const own = p === paths.tree || p === paths.scratch;
  if (own || !within(p, paths.home) || inHomeToolchain(p, paths.home)) return null;
  const listed = HOME_TOOLCHAINS.map((t) => `~/${t}`).join(", ");
  return `${p} is in the home folder, outside every toolchain folder a sandbox reads there: ${listed}`;
}

/** Whether `p`, in `home`, is one of `HOME_TOOLCHAINS` or lies inside one. */
function inHomeToolchain(p: string, home: string): boolean {
  const names = p.slice(home.length + 1).split("/");
  return HOME_TOOLCHAINS.some((entry) => {
    const wanted = entry.split("/");
    return wanted.length <= names.length && wanted.every((w, i) => w === "*" || w === names[i]);
  });
}
