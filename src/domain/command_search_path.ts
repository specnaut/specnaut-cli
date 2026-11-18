import { climb } from "./project_path.ts";

/**
 * Which program a bare command name runs is decided by the folders on PATH, so a folder a judged
 * config puts there makes each file in it named like a command's program a file that command may
 * run: `"env": {"PATH": "./bin:$PATH"}` and a hook `lint` run `bin/lint`. A command source names
 * such folders by a key `PATH` (a settings file's `env`, an MCP server's, Codex's shell policy; in
 * any letter case, as Windows reads it) or a word `PATH=…` (set before a command, or exported).
 * Only what the configs say is read: the PATH a shell builds before the session starts is not.
 */

/** A key or a word that sets PATH, in any letter case. */
export const isPathKey = (key: string): boolean => /^path$/i.test(key);
const PATH_WORD = /^path=(.*)$/is;

/** What a word sets PATH to, when it sets it: `PATH=./bin:$PATH` sets it to `./bin:$PATH`. */
export const pathWordValue = (word: string): string | undefined => PATH_WORD.exec(word)?.[1];

/** A PATH key or assignment as raw bytes show it: not `$PATH` or `${PATH}`, which only read it. */
const RAW_PATH = /(?<![\w${])path["']?\s*[:=]\s*["']?([^"'\s,&|]*)/gi;

/** What each PATH key or assignment on a raw line sets PATH to: what a parser rejects is read. */
export function rawPathValues(line: string): string[] {
  return [...line.matchAll(RAW_PATH)].map((m) => m[1]).filter(Boolean);
}

/** The pieces of a PATH value, each a folder as written: `:` and Windows' `;` both separate. */
export const pathPieces = (value: string): string[] => value.split(/[:;]/).filter(Boolean);

/** At most this many program-in-folder paths are tried: past it a reading is not whole. */
const MAX_ON_PATH = 50_000;

/**
 * Each program (a command's first word, holding no slash) in each folder on PATH, as a path
 * relative to the project's folder. Past {@link MAX_ON_PATH}, none is tried and `read` is not
 * whole: the caller names the sources that put a folder there, rather than trust a part.
 */
export function onPathTargets(
  folders: Iterable<string>,
  programs: Iterable<string>,
  read: { whole: boolean },
): string[] {
  const dirs = [...new Set(folders)];
  const names = [...new Set(programs)];
  if (dirs.length * names.length > MAX_ON_PATH) {
    read.whole = false;
    return [];
  }
  return dirs.flatMap((dir) => names.map((name) => climb([], `${dir}/${name}`).join("/")));
}
