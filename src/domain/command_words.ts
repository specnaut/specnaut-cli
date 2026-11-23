import { manifestsOf } from "./command_runners.ts";
import { pathAssignments, type PathValue } from "./command_search_path.ts";
import { buildsPathUnread, joinedPathUnread, setsPathUnread } from "./powershell_path.ts";
import { encodedWords } from "./powershell_forms.ts";
import { nestedSegments } from "./nested_commands.ts";
import { bindsByExpansion, respellsProjectVariable } from "./project_variable.ts";

/**
 * The words a parsed command source holds, grouped as the harness reads them: each object's strings
 * are one group (a server's `command`, `args` and `cwd`; the walk is `command_values.ts`), each
 * group's commands split as a shell
 * would (`shell_words.ts`), plus the manifest each command's runner reads (`command_runners.ts`).
 * And the words of a raw line, for what a parser rejects. Shared by every kind of command source:
 * a config (`command_targets.ts`) and a skill's, an agent's or a command's file
 * (`markdown_commands.ts`). What decides a bare name's program is noted on the way: the values
 * PATH is set to, and the words that may be programs named by name alone
 * (`command_search_path.ts`).
 */

/**
 * What a reading of one source found beside its words: whether it met no limit (a source that did
 * not parse, a word or an expansion past a cap), each value it sets PATH to, each word its
 * commands hold that may be a program named by name alone (`isProgram`), and each pattern a path
 * built around a variable reads as (`command_word_paths.ts`). Whether it spells the project's
 * variable otherwise than reading it, and whether a folder it puts on PATH leans on that variable
 * (`project_variable.ts`). And the source's path, and how many folders the project sits below the
 * repository's top.
 */
export type Reading = {
  readonly source: string;
  whole: boolean;
  rebindsProject: boolean;
  leansOnProject: boolean;
  readonly pathValues: PathValue[];
  readonly programs: Set<string>;
  readonly patterns: Set<string>;
  readonly depth: number;
};

/** A source larger than this is not parsed: read from its bytes, and named as not fully read. */
export const PARSE_LIMIT = 256 * 1024;
/** A longer word is not read: no path is that long. */
export const MAX_WORD = 4096;

export const reading = (depth = 0, source = ""): Reading => ({
  source,
  whole: true,
  rebindsProject: false,
  leansOnProject: false,
  pathValues: [],
  programs: new Set(),
  patterns: new Set(),
  depth,
});

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
 * The words of `strings` and of every command nested in them (`nested_commands.ts`), and the
 * manifest each of those commands runs (`manifestsOf`); each word that may be a program
 * (`isProgram`), and the value each PATH assignment sets (`pathAssignments`), are noted in `read`;
 * a word or a string that sets PATH where no value is read (`setsPathUnread`), a string or a word
 * spelled across quotes that sets PowerShell's PATH to a value its words do not give whole
 * (`buildsPathUnread`, `joinedPathUnread`), or a command handing PowerShell an encoded command
 * (`encodedWords`), leaves the reading not whole.
 */
export function commandWords(strings: readonly string[], read: Reading): string[] {
  const commands = nestedSegments(strings, read);
  for (const words of commands) read.pathValues.push(...pathAssignments(words));
  for (const word of commands.flat()) {
    if (isProgram(word)) read.programs.add(word);
    if (setsPathUnread(word)) read.whole = false;
  }
  if (strings.some((s) => setsPathUnread(s) || buildsPathUnread(s))) read.whole = false;
  if (joinedPathUnread(strings, commands.flat()) || commands.some(encodedWords)) read.whole = false;
  const respells = [...strings, ...commands.flat()].some(respellsProjectVariable);
  if (respells || commands.some(bindsByExpansion)) read.rebindsProject = true;
  return [...commands.flat(), ...commands.flatMap(manifestsOf)];
}

/**
 * Whether `word` may be a program run by name alone: it holds no slash, whatever its place in its
 * command, since a wrapper runs a word after it (`timeout 30 lint`, `nice -n 5 lint`, `xargs
 * lint`, `sudo lint`, `env -i lint`), and a command a shell is handed (`bash -c 'cd x && lint'`)
 * or a `$(lint)` is read for its own words. Most words name no program: the folders on PATH are
 * searched for the names a commit holds (`command_search_path.ts`), so a word too many costs
 * nothing.
 */
const isProgram = (word: string): boolean =>
  word.length <= MAX_WORD && !/[\\/]/.test(word) && !ASSIGNMENT.test(word);

/** A word that sets a variable for the command (`CI=1`): no program, whatever follows. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The text's words read as bytes: an escaped quote or backslash undone, split on punctuation. */
export function rawWords(text: string): string[] {
  const plain = text.replace(/\\\\/g, "/").replace(/\\["']/g, " ");
  return plain.split(/[\s"'`,;&|<>(){}[\]]+/).filter(Boolean);
}
