import { manifestsOf } from "./command_runners.ts";
import { shellSegments } from "./shell_words.ts";

/**
 * The words a parsed command source holds, grouped as the harness reads them: each object's strings
 * are one group (a server's `command`, `args` and `cwd`), each group's commands split as a shell
 * would (`shell_words.ts`), plus the manifest each command's runner reads (`command_runners.ts`).
 * And the words of a raw line, for what a parser rejects. Shared by every kind of command source:
 * a config (`command_targets.ts`) and a skill's, an agent's or a command's file
 * (`markdown_commands.ts`).
 */

/** Whether a reading met no limit: a source that did not parse, or a word or expansion past a cap. */
export type Reading = { whole: boolean };

/** Every group of words `value` holds: one per object, its own strings together. */
export function valueEntries(value: unknown): string[][] {
  const entries: string[][] = [];
  entries.push(commandWords(stringsOf(value, entries, new Set())));
  return entries;
}

/** The words of `strings`, and the manifest each command among them runs (`manifestsOf`). */
export function commandWords(strings: readonly string[]): string[] {
  const commands = strings.flatMap(shellSegments);
  return [...commands.flat(), ...commands.flatMap(manifestsOf)];
}

/**
 * The strings of `value` that belong to the object holding it; each object's are one entry. An
 * object or a list met again (a YAML alias is the same value at each use) is read once: walking it
 * at each use would read a chain of aliases in time doubling with its length, and its strings are
 * already read.
 */
function stringsOf(value: unknown, entries: string[][], seen: Set<object>): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v) => stringsOf(v, entries, seen));
  entries.push(commandWords(Object.values(value).flatMap((v) => stringsOf(v, entries, seen))));
  return [];
}

/** The text's words read as bytes: an escaped quote or backslash undone, split on punctuation. */
export function rawWords(text: string): string[] {
  const plain = text.replace(/\\\\/g, "/").replace(/\\["']/g, " ");
  return plain.split(/[\s"'`,;&|<>(){}[\]]+/).filter(Boolean);
}
