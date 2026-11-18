import { parse as parseJsonc } from "@std/jsonc";
import { parse as parseToml } from "@std/toml";
import { climb, readings } from "./project_path.ts";
import { rawWords, type Reading, valueEntries } from "./command_words.ts";
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

/** A source larger than this is not parsed: read from its bytes, and named as not fully read. */
const PARSE_LIMIT = 256 * 1024;
/** A longer word is not read: no path is that long. */
const MAX_WORD = 4096;
/** An absolute path, or one after a dropped variable, is tried from at most this many last parts. */
const MAX_SUFFIXES = 32;
/** At most this many paths are put under the folders one group of words names. */
const MAX_JOINS = 50_000;

/** What a source's commands name, and whether every word of it was read. */
export type CommandPaths = { readonly paths: readonly string[]; readonly whole: boolean };

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
): CommandPaths {
  const read: Reading = { whole: true };
  const text = new TextDecoder().decode(bytes);
  const entries = isCommandMarkdown(path)
    ? markdownEntries(text, read, PARSE_LIMIT)
    : [...parsedEntries(path, text, read), ...text.split("\n").map(rawWords)];
  const paths = new Set(entries.flatMap((words) => entryPaths(words, isFolder, read)));
  return { paths: [...paths], whole: read.whole };
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
  read: Reading = { whole: true },
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

function pathsIn(word: string, read: Reading): string[] {
  const pieces = new Set([word, ...word.split("="), ...word.split(":")]);
  return [...pieces].flatMap(readings).flatMap((p) => pathOf(p, read));
}

/**
 * One piece as a path: relative as written; or, when it is absolute, starts at the home (`~`), or
 * starts with a variable dropped up to its first `/`, each of its folder suffixes, since where it
 * starts is not known. None when a variable is left.
 */
function pathOf(piece: string, read: Reading): string[] {
  const slashed = piece.replaceAll("\\", "/");
  const bare = withoutVariable(slashed);
  if (bare === null || bare === "" || bare === "~") return [];
  const rooted = bare !== slashed || /^(?:~|(?:[A-Za-z]:)?\/)/.test(bare);
  if (!rooted) return [climb([], bare).join("/")].filter(Boolean);
  const parts = climb([], bare.replace(/^(?:~|[A-Za-z]:)?\/*/, "")).filter((p) => p !== "..");
  if (parts.length > MAX_SUFFIXES) read.whole = false;
  const kept = parts.slice(-MAX_SUFFIXES);
  return kept.map((_, i) => kept.slice(i).join("/"));
}

/**
 * `token` without a leading segment, up to its first `/`, that holds a variable or a command
 * (`$X`, `${X}`, `$(…)`, a backquote): the project's folder, most often. `null` when one is left.
 */
function withoutVariable(token: string): string | null {
  const slash = firstSlash(token);
  const lead = slash < 0 ? token : token.slice(0, slash);
  const rest = !/[$`]/.test(lead) ? token : slash < 0 ? "" : token.slice(slash + 1);
  return /[$`]/.test(rest) ? null : rest;
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

function parsedEntries(path: string, text: string, read: Reading): string[][] {
  if (text.length > PARSE_LIMIT) {
    read.whole = false;
    return [];
  }
  try {
    return valueEntries(path.toLowerCase().endsWith(".toml") ? parseToml(text) : parseJsonc(text));
  } catch (err) {
    // Not swallowed: a source that does not parse, or nests too deep to walk, is not read whole,
    // and its caller names it. Anything else is not a parse failure and goes up.
    if (!(err instanceof SyntaxError || err instanceof RangeError)) throw err;
    read.whole = false;
    return [];
  }
}
