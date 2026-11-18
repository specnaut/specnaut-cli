import { manifestsOf, programOf } from "./command_runners.ts";
import { isPathKey, pathWordValue } from "./command_search_path.ts";
import { shellSegments } from "./shell_words.ts";

/**
 * The words a parsed command source holds, grouped as the harness reads them: each object's strings
 * are one group (a server's `command`, `args` and `cwd`), each group's commands split as a shell
 * would (`shell_words.ts`), plus the manifest each command's runner reads (`command_runners.ts`).
 * And the words of a raw line, for what a parser rejects. Shared by every kind of command source:
 * a config (`command_targets.ts`) and a skill's, an agent's or a command's file
 * (`markdown_commands.ts`). What decides a bare name's program is noted on the way: the values
 * PATH is set to, and the programs named by name alone (`command_search_path.ts`).
 */

/**
 * What a reading of one source found beside its words: whether it met no limit (a source that did
 * not parse, a word or an expansion past a cap), each value it sets PATH to, each program its
 * commands name without a slash, and each pattern a path built around a variable reads as
 * (`command_word_paths.ts`). And how many folders the project sits below the repository's top.
 */
export type Reading = {
  whole: boolean;
  readonly pathValues: string[];
  readonly programs: Set<string>;
  readonly patterns: Set<string>;
  readonly depth: number;
};

/** A source larger than this is not parsed: read from its bytes, and named as not fully read. */
export const PARSE_LIMIT = 256 * 1024;

/**
 * At most this many objects and lists are walked in one source. Each takes at least a byte of its
 * own, so no source within {@link PARSE_LIMIT} holds more: the cap only stops a walk that would
 * take a value met again (a YAML alias) once per use, and makes that reading not whole.
 */
const MAX_VISITS = PARSE_LIMIT;

export const reading = (depth = 0): Reading => ({
  whole: true,
  pathValues: [],
  programs: new Set(),
  patterns: new Set(),
  depth,
});

/** Every group of words `value` holds: one per object, its own strings together. */
export function valueEntries(value: unknown, read: Reading): string[][] {
  const entries: string[][] = [];
  const walked: Walked = { seen: new Set(), visits: 0 };
  entries.push(commandWords(stringsOf(value, entries, walked, read), read));
  return entries;
}

/**
 * The groups of words `parse` yields, or `null` when the text does not parse or nests too deep to
 * walk (a `RangeError`), and the reading is then not whole: the caller reads the text's lines
 * instead, and names the source. Anything else is not a parse failure, and goes up.
 */
export function parsedGroups(read: Reading, parse: () => string[][]): string[][] | null {
  try {
    return parse();
  } catch (err) {
    if (!(err instanceof SyntaxError || err instanceof RangeError)) throw err;
    read.whole = false;
    return null;
  }
}

/**
 * The words of `strings`, and the manifest each command among them runs (`manifestsOf`); each
 * command's program, when it holds no slash, and each `PATH=…` word's value, are noted in `read`.
 */
export function commandWords(strings: readonly string[], read: Reading): string[] {
  const commands = strings.flatMap(shellSegments);
  for (const words of commands) {
    const program = programOf(words);
    if (program !== undefined && !/[\\/]/.test(program)) read.programs.add(program);
    read.pathValues.push(...words.flatMap((w) => pathWordValue(w) ?? []));
  }
  return [...commands.flat(), ...commands.flatMap(manifestsOf)];
}

/**
 * The strings of `value` that belong to the object holding it; each object's are one entry. An
 * object or a list met again (a YAML alias is the same value at each use) is read once: walking it
 * at each use would read a chain of aliases in time doubling with its length, and its strings are
 * already read.
 */
function stringsOf(value: unknown, entries: string[][], walked: Walked, read: Reading): string[] {
  if (typeof value === "string") return [value];
  if (!firstVisit(value, walked, read)) return [];
  if (Array.isArray(value)) return value.flatMap((v) => stringsOf(v, entries, walked, read));
  for (const [key, v] of Object.entries(value)) {
    if (isPathKey(key) && typeof v === "string") read.pathValues.push(v);
  }
  const strings = Object.values(value).flatMap((v) => stringsOf(v, entries, walked, read));
  entries.push(commandWords(strings, read));
  return [];
}

/** The objects and lists a walk has met, and how many times it entered one. */
type Walked = { readonly seen: Set<object>; visits: number };

/**
 * Whether `value` is an object or a list the walk has not met: one past {@link MAX_VISITS} is not
 * entered, and the reading is not whole.
 */
function firstVisit(value: unknown, walked: Walked, read: Reading): value is object {
  if (value === null || typeof value !== "object" || walked.seen.has(value)) return false;
  if (++walked.visits > MAX_VISITS) {
    read.whole = false;
    return false;
  }
  walked.seen.add(value);
  return true;
}

/** The text's words read as bytes: an escaped quote or backslash undone, split on punctuation. */
export function rawWords(text: string): string[] {
  const plain = text.replace(/\\\\/g, "/").replace(/\\["']/g, " ");
  return plain.split(/[\s"'`,;&|<>(){}[\]]+/).filter(Boolean);
}
