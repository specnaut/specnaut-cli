import { parse as parseJsonc } from "@std/jsonc";
import { parse as parseToml } from "@std/toml";
import { climb } from "./project_path.ts";
import {
  PARSE_LIMIT,
  parsedGroups,
  rawWords,
  type Reading,
  reading,
  valueEntries,
} from "./command_words.ts";
import { pathPieces, rawPathValues } from "./command_search_path.ts";
import { pathOf, pathsIn } from "./command_word_paths.ts";
import { isCommandMarkdown, markdownEntries } from "./markdown_commands.ts";

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

/** Whether `path` is one of {@link COMMAND_SOURCES}, or a file of commands, its letter case aside. */
export const isCommandSource = (path: string): boolean =>
  COMMAND_SOURCES.some((s) => s === path.toLowerCase()) || isCommandMarkdown(path);

/** The reason a source gets when its commands could not all be read: it is asked about whole. */
export const COMMAND_REASON = { partial: "commands not fully read" } as const;

/** A longer word is not read: no path is that long. */
const MAX_WORD = 4096;
/** At most this many paths are put under the folders one group of words names. */
const MAX_JOINS = 50_000;

/**
 * What a source's commands name, and whether every word of it was read; and, for the programs a
 * bare name runs (`command_search_path.ts`), the folders it puts on PATH and the programs it names;
 * and the patterns its paths built around a variable read as (`command_word_paths.ts`).
 */
export type CommandPaths = {
  readonly paths: readonly string[];
  readonly whole: boolean;
  readonly onPath: readonly string[];
  readonly programs: readonly string[];
  readonly patterns: readonly string[];
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
  const read = reading(depth);
  const text = new TextDecoder().decode(bytes);
  const entries = isCommandMarkdown(path)
    ? markdownEntries(text, read)
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
  };
}

/**
 * The folders the PATH values `read` noted put there. A value longer than {@link MAX_WORD} is not
 * read, as a word is not, and the reading is not whole: its pieces are not paths a check should
 * spend its time on.
 */
function pathFolders(read: Reading): string[] {
  const folders = new Set<string>();
  for (const value of read.pathValues) {
    if (value.length > MAX_WORD) read.whole = false;
    else pathPieces(value).flatMap((p) => pathOf(p, read)).forEach((f) => folders.add(f));
  }
  return [...folders];
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
