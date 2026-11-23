import * as posix from "@std/path/posix";
import * as windows from "@std/path/windows";
import { attempt, spellingUnsafe } from "./git_path.ts";

type Os = typeof Deno.build.os;
type PathApi = Pick<typeof posix, "join" | "extname" | "dirname">;

/** Where a program is looked for: the platform, its PATHEXT, and what counts as a program there. */
export type LookupHost = {
  readonly os: Os;
  /** Windows' PATHEXT; ours when not given, Windows' own default when we have none. */
  readonly pathext?: string;
  readonly isProgram?: (file: string) => boolean;
};

/** What Windows appends to a bare name when PATHEXT is not set. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * The one shape of PATHEXT entry tried: an extension. PATHEXT is the caller's to set, and an entry
 * holding a separator or `..` would make the name a path that leaves the PATH entry searched, past
 * its filter; a trailing `..` is one Windows strips, opening another file than the one checked.
 */
const EXTENSION = /^\.[A-Za-z0-9]+$/;

/**
 * The absolute path of the program `name` names, found on `path`'s entries alone, in their order;
 * undefined when none holds it. A program started by its bare name is handed this path, so the
 * spawn looks nothing up itself: Windows would search the working folder first, which no PATH
 * filter covers. An entry the spelling rule refuses is never searched. On Windows a name is tried
 * with each PATHEXT extension unless it ends in one already. A file is taken only when its folder
 * is the entry searched. A name with a separator is a path already: given back as it is.
 */
export function programOnPath(
  name: string,
  path: string,
  host: LookupHost = { os: Deno.build.os },
): string | undefined {
  const win = host.os === "windows";
  if ((win ? /[\\/]/ : /\//).test(name)) return name;
  const api: PathApi = win ? windows : posix;
  const isProgram = host.isProgram ?? ((file: string) => isProgramFile(file, win));
  const names = win ? withExtensions(name, host, api) : [name];
  for (const entry of path.split(win ? ";" : ":")) {
    if (spellingUnsafe(entry, host.os) !== undefined) continue;
    const inEntry = (file: string) => api.dirname(file) === api.join(entry, ".");
    const found = names.map((n) => api.join(entry, n)).find((f) => inEntry(f) && isProgram(f));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** `name` alone when it ends in an extension PATHEXT lists, else `name` with each of them. */
function withExtensions(name: string, host: LookupHost, api: PathApi): string[] {
  const pathext = host.pathext ?? Deno.env.get("PATHEXT");
  const exts = (pathext ?? DEFAULT_PATHEXT).split(";").filter((e) => EXTENSION.test(e));
  const ext = api.extname(name).toUpperCase();
  if (ext !== "" && exts.some((e) => e.toUpperCase() === ext)) return [name];
  return exts.map((e) => name + e);
}

/** A file, followed through its links, that this process could execute (any x bit on POSIX). */
function isProgramFile(file: string, win: boolean): boolean {
  const info = attempt(() => Deno.statSync(file));
  return info?.isFile === true && (win || ((info.mode ?? 0) & 0o111) !== 0);
}
