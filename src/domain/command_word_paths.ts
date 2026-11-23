import { climb, readings } from "./project_path.ts";
import { fold, type PathIndex } from "./path_index.ts";
import { backquoteEnd, closing } from "./shell_words.ts";
import type { Reading } from "./command_words.ts";
import { belowProject } from "./project_variable.ts";

/**
 * The paths one word of a command may name, relative to the project's folder, read as text: a
 * leading variable or command is dropped (the project's folder, most often), an absolute path is
 * tried from each of its folder suffixes, from the project and from each folder above it when the
 * project sits in a subfolder, and a variable left inside the path makes it a pattern the listing
 * is matched against (`scripts/$NAME.sh` is every `.sh` under `scripts/`). Nothing is expanded.
 */

/**
 * An absolute path, or one after a dropped variable, is tried from at most this many last parts:
 * past it the reading is not whole.
 */
const MAX_SUFFIXES = 32;
/** At most this many patterns are read from one source: past it the reading is not whole. */
const MAX_PATTERNS = 64;
/** What a variable or a command inside a word reads as, once the word is a pattern. */
const VAR = "\0";

/**
 * The paths `word` names: itself, and each part of it around `=` or `:`. A variable's assignment
 * (`r=$PWD`) is read for its value alone: as a whole it names no file a command runs.
 */
export function pathsIn(word: string, read: Reading): string[] {
  const pieces = new Set([word, ...word.split("="), ...word.split(":")]);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) pieces.delete(word);
  return [...pieces].flatMap(readings).flatMap((p) => pathOf(p, read));
}

/**
 * One piece as a path: relative as written; or, when it is absolute, starts at the home (`~`), or
 * starts with a variable dropped up to its first `/`, each of its folder suffixes, since where it
 * starts is not known, each also from each of the `read.depth` folders above the project.
 */
export function pathOf(piece: string, read: Reading): string[] {
  const bare = withoutVariable(piece);
  const glob = globbed(bare);
  if (glob === "" || glob === "~") return [];
  const rooted = bare !== piece || /^(?:~|(?:[A-Za-z]:)?\/)/.test(glob);
  if (climbsOverVariable(glob)) {
    read.whole = false;
    return [];
  }
  if (!rooted) return named(climb([], glob).join("/"), read);
  const parts = climb([], glob.replace(/^(?:~|[A-Za-z]:)?\/*/, "")).filter((p) => p !== "..");
  if (parts.length > MAX_SUFFIXES) read.whole = false;
  const kept = parts.slice(-MAX_SUFFIXES);
  // A suffix that starts with a variable is left out: its tail is tried as a suffix of its own.
  const suffixes = kept.map((_, i) => kept.slice(i)).filter((s) => s[0] !== VAR);
  const ups = Array.from({ length: read.depth + 1 }, (_, up) => "../".repeat(up));
  return suffixes.flatMap((s) => ups.flatMap((up) => named(up + s.join("/"), read)));
}

/**
 * Whether a `..` follows a part holding a variable (`tools/$OS/../run.sh`): what it climbs to
 * depends on how many folders the variable holds, so no one path can be read from it.
 */
function climbsOverVariable(glob: string): boolean {
  const parts = glob.split("/");
  const at = parts.findIndex((p) => p.includes(VAR));
  return at >= 0 && parts.slice(at + 1).includes("..");
}

/**
 * The folders one piece of a PATH value puts there, read as {@link pathOf} reads a path; none for
 * `$PATH`, the PATH a shell built before the session. In a value surely setting PATH (`sure`), a
 * piece holding any other expansion (`$T/bin`, `${X:+tools}`, `$(cat .dir)`) names no folder that
 * can be known, and the reading is not whole, but for the project's variable as the harness sets
 * it (`belowProject`), unless a source spells it otherwise (`rebindsProject`). In any other value,
 * `.`, a variable alone and a piece empty once its leading variable is dropped are the project's
 * folder, where the harness runs a command, and one holding a variable past its start is skipped.
 */
export function foldersOf(piece: string, read: Reading, sure: boolean): string[] {
  if (/^\$(?:PATH|\{PATH\})$/.test(piece)) return [];
  if (sure && globbed(piece).includes(VAR)) {
    const below = belowProject(piece);
    const known = below !== undefined && !globbed(below).includes(VAR);
    if (!known || read.rebindsProject) read.whole = false;
    read.leansOnProject ||= known;
    return !known ? [] : below === "" ? [""] : pathOf(piece, read);
  }
  const glob = globbed(withoutVariable(piece));
  if (glob === VAR || glob === "" || /^\.\/?$/.test(glob)) return [""];
  return glob.includes(VAR) ? [] : pathOf(piece, read);
}

/**
 * `path` when it holds no variable. One that does is noted in `read` as a pattern, unless its file
 * name is a variable alone (`"$DIR/$FILE"`, `scripts/$NAME`), or it names no folder before a
 * variable (`$NAME.sh`): the first would name every file of a folder, the second every file of the
 * repository with that ending, and an edit to any of them would stop every merge. The docs state
 * both as a limit.
 */
function named(path: string, read: Reading): string[] {
  if (!path.includes(VAR)) return path === "" ? [] : [path];
  if (path.startsWith(VAR) || path.split("/").at(-1) === VAR) return [];
  if (read.patterns.size >= MAX_PATTERNS) read.whole = false;
  else read.patterns.add(patternOf(path));
  return [];
}

/** A pattern: its folded text as written, and a {@link VAR} where any text may stand. */
const patternOf = (path: string) => path.split(VAR).map(fold).join(VAR);

/**
 * Each path of `index` some pattern of `patterns` matches, as the commit spells it. A pattern is
 * matched as a glob (`partsInOrder`), never as a regular expression: one that backtracks takes time
 * exponential in its wildcards on a crafted value, and the check would hang on it.
 */
export function matching(patterns: readonly string[], index: PathIndex): string[] {
  const split = patterns.map((p) => p.split(VAR));
  return [...index].flatMap(([key, held]) =>
    split.some((parts) => partsInOrder(parts, key)) ? held.map((p) => p.path) : []
  );
}

/**
 * Whether `key` is `parts`, two at least (a pattern holds a {@link VAR}), with any text between
 * each two: the first starts it, the last ends it, and each other is found at its leftmost place
 * after the one before. Leftmost is always right when only "any text" stands between parts, so
 * nothing is tried twice: the time is that of reading `key` once for each part.
 */
function partsInOrder(parts: readonly string[], key: string): boolean {
  const [first, last] = [parts[0], parts[parts.length - 1]];
  const end = key.length - last.length;
  if (end < first.length || !key.startsWith(first) || !key.endsWith(last)) return false;
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    const found = key.indexOf(part, at);
    if (found < 0 || found + part.length > end) return false;
    at = found + part.length;
  }
  return true;
}

/**
 * `token` with each variable or command (`$X`, `${X}`, `$(…)`, a backquote) as one {@link VAR},
 * a command's slashes and all; a run of them is one. A backslash left outside them is a Windows
 * folder's separator, read as `/`: only once the commands are found, since one inside a backquoted
 * command escapes the backquote after it.
 */
function globbed(token: string): string {
  let out = "";
  for (let i = 0; i < token.length;) {
    const end = variableEnd(token, i);
    if (end > i) {
      if (!out.endsWith(VAR)) out += VAR;
      i = end;
    } else out += token[i++].replace("\\", "/");
  }
  return out;
}

/** Where the variable or command starting at `i` ends, or `i` when none starts there. */
function variableEnd(token: string, i: number): number {
  if (token[i] === "`") return Math.min(backquoteEnd(token, i) + 1, token.length);
  if (token[i] !== "$") return i;
  const next = token[i + 1] ?? "";
  if (next === "(" || next === "{") return closing(token, i + 1) + 1;
  const name = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(token.slice(i + 1));
  return i + 1 + (name?.[0].length ?? 0);
}

/**
 * `token` without a leading segment, up to its first `/` or `\\`, that holds a variable or a
 * command: the project's folder, most often. A token with no slash is a name of its own, and is
 * kept.
 */
function withoutVariable(token: string): string {
  const slash = firstSlash(token);
  if (slash < 0 || !/[$`]/.test(token.slice(0, slash))) return token;
  return token.slice(slash + 1);
}

/** The first `/` or `\\` outside a `$(…)`, `${…}` or backquoted command. */
function firstSlash(token: string): number {
  let depth = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "`") i = backquoteEnd(token, i);
    else if (c === "(" || c === "{") depth++;
    else if ((c === ")" || c === "}") && depth > 0) depth--;
    else if ((c === "/" || c === "\\") && depth === 0) return i;
  }
  return -1;
}
