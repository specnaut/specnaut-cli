import { climb, readings } from "./project_path.ts";
import { fold, type PathIndex } from "./path_index.ts";
import { closing } from "./shell_words.ts";
import type { Reading } from "./command_words.ts";

/**
 * The paths one word of a command may name, relative to the project's folder, read as text: a
 * leading variable or command is dropped (the project's folder, most often), an absolute path is
 * tried from each of its folder suffixes, from the project and from each folder above it when the
 * project sits in a subfolder, and a variable left inside the path makes it a pattern the listing
 * is matched against (`scripts/$NAME.sh` is every `.sh` under `scripts/`). Nothing is expanded.
 */

/** An absolute path, or one after a dropped variable, is tried from at most this many last parts. */
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
  const slashed = piece.replaceAll("\\", "/");
  const bare = withoutVariable(slashed);
  if (bare === "" || bare === "~") return [];
  const rooted = bare !== slashed || /^(?:~|(?:[A-Za-z]:)?\/)/.test(bare);
  const glob = globbed(bare);
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

/** A pattern's source: its folded text as written, and any text where a variable stood. */
const patternOf = (path: string) =>
  `^${path.split(VAR).map((t) => fold(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`;

/** Each path of `index` some pattern of `patterns` matches, as the commit spells it. */
export function matching(patterns: readonly string[], index: PathIndex): string[] {
  const compiled = patterns.map((p) => new RegExp(p, "s"));
  return [...index].flatMap(([key, held]) =>
    compiled.some((re) => re.test(key)) ? held.map((p) => p.path) : []
  );
}

/**
 * `token` with each variable or command (`$X`, `${X}`, `$(…)`, a backquote) as one {@link VAR},
 * a command's slashes and all; a run of them is one.
 */
function globbed(token: string): string {
  let out = "";
  for (let i = 0; i < token.length;) {
    const end = variableEnd(token, i);
    if (end > i) {
      if (!out.endsWith(VAR)) out += VAR;
      i = end;
    } else out += token[i++];
  }
  return out;
}

/** Where the variable or command starting at `i` ends, or `i` when none starts there. */
function variableEnd(token: string, i: number): number {
  if (token[i] === "`") {
    const close = token.indexOf("`", i + 1);
    return close < 0 ? token.length : close + 1;
  }
  if (token[i] !== "$") return i;
  const next = token[i + 1] ?? "";
  if (next === "(" || next === "{") return closing(token, i + 1) + 1;
  const name = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(token.slice(i + 1));
  return i + 1 + (name?.[0].length ?? 0);
}

/**
 * `token` without a leading segment, up to its first `/`, that holds a variable or a command: the
 * project's folder, most often. A token with no `/` is a name of its own, and is kept.
 */
function withoutVariable(token: string): string {
  const slash = firstSlash(token);
  if (slash < 0 || !/[$`]/.test(token.slice(0, slash))) return token;
  return token.slice(slash + 1);
}

/** The first `/` outside a `$(…)`, `${…}` or backquoted command. */
function firstSlash(token: string): number {
  let depth = 0;
  let back = false;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "`") back = !back;
    else if (c === "(" || c === "{") depth++;
    else if ((c === ")" || c === "}") && depth > 0) depth--;
    else if (c === "/" && depth === 0 && !back) return i;
  }
  return -1;
}
