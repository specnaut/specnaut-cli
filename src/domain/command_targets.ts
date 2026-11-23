import { parse as parseJsonc } from "@std/jsonc";
import { parse as parseToml } from "@std/toml";
import { climb } from "./project_path.ts";
import {
  commandWords,
  MAX_WORD,
  PARSE_LIMIT,
  parsedGroups,
  rawWords,
  type Reading,
  reading,
} from "./command_words.ts";
import { valueEntries } from "./command_values.ts";
import { rawPathValues } from "./command_search_path.ts";
import { pathsIn } from "./command_word_paths.ts";
import { pathFolders } from "./path_folders.ts";
import { isCommandMarkdown, markdownEntries } from "./markdown_commands.ts";
import { respellsProjectVariable } from "./project_variable.ts";

/**
 * The repository files a judged config makes a harness run: a hook's or a status line's command,
 * an MCP server's, a Codex notifier's. Each source is already judged byte for byte, so a command
 * the branch changes is already named; what this adds is the file an unchanged command runs,
 * which the branch may have changed. So every string value is swept, never a list of fields, and
 * a word is read too much rather than too little: reading too much only names a file the branch
 * changed. Words are read as text, never expanded, evaluated or run. A skill's, an agent's or a
 * slash command's file holds commands too: its frontmatter's hooks and its `!` spans
 * (`markdown_commands.ts`).
 */

/** The judged files that name programs a harness runs. */
export const COMMAND_SOURCES: readonly string[] = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".mcp.json",
  ".codex/config.toml",
  ".codex/hooks.json",
];

/** Whether `path` is one of {@link COMMAND_SOURCES} or a file of commands, letter case aside. */
export const isCommandSource = (path: string): boolean =>
  COMMAND_SOURCES.some((s) => s === path.toLowerCase()) || isCommandMarkdown(path);

/** The reason a source gets when its commands could not all be read: it is asked about whole. */
export const COMMAND_REASON = { partial: "commands not fully read" } as const;

/** At most this many paths are put under the folders one group of words names. */
const MAX_JOINS = 50_000;

/**
 * What a source's commands name, and whether every word of it was read; and, for the programs a
 * bare name runs (`command_search_path.ts`), the folders it puts on PATH and the programs it names;
 * and the patterns its paths built around a variable read as (`command_word_paths.ts`); and whether
 * it spells the project's variable otherwise than reading it, or puts a folder on PATH through it
 * (`project_variable.ts`); and the repository files it runs in its own process, whose PATH the
 * caller reads when their lines allow it (`sourced_files.ts`).
 */
export type CommandPaths = {
  readonly paths: readonly string[];
  readonly whole: boolean;
  readonly onPath: readonly string[];
  readonly programs: readonly string[];
  readonly patterns: readonly string[];
  readonly rebindsProject: boolean;
  readonly leansOnProject: boolean;
  readonly sourced: readonly string[];
};

/**
 * The paths a command source names (`entryPaths`), from its parsed values (each object's strings
 * together: a server's `command`, `args` and `cwd`) and from each line of its bytes. Both always:
 * the parse reads escapes (`\u002e`), the bytes what a parser rejects or misses. No word is left
 * unread for being one too many; a source that is not parsed, or a word or an expansion past a
 * cap, makes the reading not `whole`, and the caller names the source rather than trust it.
 */
export function commandPaths(
  path: string,
  bytes: Uint8Array,
  isFolder: (path: string) => boolean,
  depth = 0,
): CommandPaths {
  const read = reading(depth, path);
  const text = new TextDecoder().decode(bytes);
  read.rebindsProject = respellsProjectVariable(text);
  const entries = isCommandMarkdown(path)
    ? markdownEntries(path, text, read)
    : [...parsedEntries(path, text, read), ...rawEntries(text, read)];
  return found(entries.flatMap((words) => entryPaths(words, isFolder, read)), read);
}

/** The paths found, and what `read` noted on the way: the folders its PATH values name. */
function found(paths: readonly string[], read: Reading): CommandPaths {
  const onPath = pathFolders(read);
  return {
    paths: [...new Set(paths)],
    whole: read.whole,
    onPath,
    programs: [...read.programs],
    patterns: [...read.patterns],
    rebindsProject: read.rebindsProject,
    leansOnProject: read.leansOnProject,
    sourced: [...read.sourced],
  };
}

/**
 * The PATH a sourced file's `texts` (its bytes at HEAD and at the tip, each made only of
 * assignments: `onlyAssignments`) set, read through their words as a command's are, added to what
 * `found` read: a file a command runs in its own process sets the PATH that command runs with.
 */
export function withSourced<T extends CommandPaths>(
  found: T,
  texts: readonly string[],
  depth: number,
): T {
  const read = reading(depth);
  for (const text of texts) commandWords(text.split(/\r?\n/), read);
  const more = pathFolders(read);
  return {
    ...found,
    whole: found.whole && read.whole,
    onPath: [...new Set([...found.onPath, ...more])],
    rebindsProject: found.rebindsProject || read.rebindsProject,
    leansOnProject: found.leansOnProject || read.leansOnProject,
  };
}

/**
 * The sources as read together: the harness sets the project's variable once for every command
 * it runs, so a source that spells it otherwise (`rebindsProject`) makes each source that puts a
 * folder on PATH through it (`leansOnProject`) not whole, whichever source that is.
 */
export function acrossSources<T extends CommandPaths>(found: readonly T[]): T[] {
  if (!found.some((f) => f.rebindsProject)) return [...found];
  return found.map((f) => f.leansOnProject ? { ...f, whole: false } : f);
}

/** Each line's words as bytes, and what a PATH key or assignment on it sets PATH to. */
function rawEntries(text: string, read: Reading): string[][] {
  const lines = text.split("\n");
  read.pathValues.push(...lines.flatMap(rawPathValues));
  return lines.map(rawWords);
}

/**
 * The paths one group of words may name, relative to the project's folder: each word, each part
 * of it around `=` or `:`, without a leading variable or command (`$DIR/x.sh` is `x.sh`), each
 * folder suffix of an absolute path or of what follows a dropped variable or `~`. A word naming a
 * folder (`isFolder`: a `cwd`, `cd X`, `-C X`) also puts every other path under it.
 */
export function entryPaths(
  words: readonly string[],
  isFolder: (path: string) => boolean,
  read: Reading = reading(),
): string[] {
  const found = new Set<string>();
  for (const word of new Set(words)) {
    if (word.length > MAX_WORD) read.whole = false;
    else for (const p of pathsIn(word, read)) found.add(p);
  }
  return underFolders([...found], isFolder, read);
}

/** `named`, and each of them under each that is a folder, up to {@link MAX_JOINS} more. */
function underFolders(named: string[], isFolder: (path: string) => boolean, read: Reading) {
  const found = new Set(named);
  for (const folder of named.filter(isFolder)) {
    for (const path of named) {
      if (found.size >= named.length + MAX_JOINS) {
        read.whole = false;
        return [...found];
      }
      if (path !== folder) found.add(climb([], `${folder}/${path}`).join("/"));
    }
  }
  return [...found];
}

function parsedEntries(path: string, text: string, read: Reading): string[][] {
  if (text.length > PARSE_LIMIT) {
    read.whole = false;
    return [];
  }
  const parse = path.toLowerCase().endsWith(".toml") ? parseToml : parseJsonc;
  return parsedGroups(read, () => valueEntries(parse(text), read)) ?? [];
}
