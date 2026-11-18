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
 * not parse, a word or an expansion past a cap), each value it sets PATH to, and each program its
 * commands name without a slash.
 */
export type Reading = {
  whole: boolean;
  readonly pathValues: string[];
  readonly programs: Set<string>;
};

export const reading = (): Reading => ({ whole: true, pathValues: [], programs: new Set() });

/** Every group of words `value` holds: one per object, its own strings together. */
export function valueEntries(value: unknown, read: Reading): string[][] {
  const entries: string[][] = [];
  entries.push(commandWords(stringsOf(value, entries, new Set(), read), read));
  return entries;
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
function stringsOf(
  value: unknown,
  entries: string[][],
  seen: Set<object>,
  read: Reading,
): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v) => stringsOf(v, entries, seen, read));
  for (const [key, v] of Object.entries(value)) {
    if (isPathKey(key) && typeof v === "string") read.pathValues.push(v);
  }
  const strings = Object.values(value).flatMap((v) => stringsOf(v, entries, seen, read));
  entries.push(commandWords(strings, read));
  return [];
}

/** The text's words read as bytes: an escaped quote or backslash undone, split on punctuation. */
export function rawWords(text: string): string[] {
  const plain = text.replace(/\\\\/g, "/").replace(/\\["']/g, " ");
  return plain.split(/[\s"'`,;&|<>(){}[\]]+/).filter(Boolean);
}
