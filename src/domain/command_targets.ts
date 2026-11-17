import { parse as parseJsonc } from "@std/jsonc";
import { parse as parseToml } from "@std/toml";
import { climb, readings } from "./project_path.ts";
import { shellWords } from "./shell_words.ts";

/**
 * The repository files a judged config makes a harness run: a hook's or a status line's command,
 * an MCP server's, a Codex notifier's. Each source is already judged byte for byte, so a command
 * the branch changes is already named; what this adds is the file an unchanged command runs,
 * which the branch may have changed. So every string value is swept, never a list of fields, and
 * a word is read too much rather than too little: reading too much only names a file the branch
 * changed. Words are read as text, never expanded, evaluated or run.
 */

/** The judged files that name programs a harness runs. */
export const COMMAND_SOURCES: readonly string[] = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".mcp.json",
  ".codex/config.toml",
  ".codex/hooks.json",
];

/** Whether `path` is one of {@link COMMAND_SOURCES}, its letter case aside. */
export const isCommandSource = (path: string): boolean =>
  COMMAND_SOURCES.some((s) => s === path.toLowerCase());

/** At most this many words are read from a source's parsed values, and as many from its bytes. */
export const MAX_WORDS = 2000;

/** A source larger than this is read from its bytes alone: no parser runs on it. */
const PARSE_LIMIT = 256 * 1024;

/**
 * A program that runs what a manifest in its folder lists (`npm run lint`, `make`): that manifest
 * is read as a target too.
 */
const RUNNERS: Readonly<Record<string, readonly string[]>> = {
  npm: ["package.json"],
  pnpm: ["package.json"],
  yarn: ["package.json"],
  bun: ["package.json"],
  make: ["Makefile", "makefile", "GNUmakefile"],
  gmake: ["Makefile", "makefile", "GNUmakefile"],
  just: ["justfile", ".justfile", "Justfile"],
  deno: ["deno.json", "deno.jsonc"],
};

/**
 * The groups of words a source holds: each object's strings, parsed (a server's `command`, `args`
 * and `cwd` together), then the whole text read as bytes. Both always: the parse reads escapes
 * (`\u002e`), the bytes read what a parser rejects or misses. A source that does not parse, or is
 * too large or too deep to, is read from its bytes alone.
 */
export function commandEntries(path: string, bytes: Uint8Array): string[][] {
  const text = new TextDecoder().decode(bytes);
  const entries = [...capped(parsedEntries(path, text)), ...capped([rawWords(text)])];
  return entries.filter((e) => e.length > 0);
}

/**
 * The paths one group of words may name, relative to the project's folder: each word, each part
 * of it around `=` or `:`, without a leading variable or command (`$DIR/x.sh` is `x.sh`), each
 * folder suffix of an absolute path, and the manifest a runner reads. A word naming a folder
 * (`isFolder`: a `cwd`, `cd X`, `-C X`) also puts every other path under it.
 */
export function entryPaths(
  words: readonly string[],
  isFolder: (path: string) => boolean,
): string[] {
  const found = new Set(words.flatMap((w) => [...pathsIn(w), ...RUNNERS[runner(w)] ?? []]));
  const named = [...found];
  for (const folder of named.filter(isFolder)) {
    for (const path of named) {
      if (path !== folder) found.add(climb([], `${folder}/${path}`).join("/"));
    }
  }
  return [...found];
}

const runner = (word: string) => word.slice(word.lastIndexOf("/") + 1);

function pathsIn(word: string): string[] {
  const pieces = new Set([word, ...word.split("="), ...word.split(":")]);
  return [...pieces].flatMap(readings).flatMap(pathOf);
}

/** One piece as a path: relative as written, each suffix of an absolute one, none if a variable is left. */
function pathOf(piece: string): string[] {
  const bare = withoutVariable(piece.replaceAll("\\", "/"));
  if (bare === null || bare === "" || bare.startsWith("~")) return [];
  const absolute = /^(?:[A-Za-z]:)?\//.test(bare);
  const parts = climb([], bare.replace(/^(?:[A-Za-z]:)?\/+/, "")).filter((p) => p !== "..");
  if (!absolute) return parts.length === 0 ? [] : [climb([], bare).join("/")];
  return parts.map((_, i) => parts.slice(i).join("/"));
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

function parsedEntries(path: string, text: string): string[][] {
  if (text.length > PARSE_LIMIT) return [];
  try {
    const value = path.toLowerCase().endsWith(".toml") ? parseToml(text) : parseJsonc(text);
    const entries: string[][] = [];
    entries.push(stringsOf(value, entries).flatMap(shellWords));
    return entries;
  } catch {
    // Not swallowed: a source that does not parse, or nests too deep to walk, is read from its
    // bytes (`rawWords`), which every source is read from anyway.
    return [];
  }
}

/** The strings of `value` that belong to the object holding it; each object's are one entry. */
function stringsOf(value: unknown, entries: string[][]): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => stringsOf(v, entries));
  if (value === null || typeof value !== "object") return [];
  entries.push(Object.values(value).flatMap((v) => stringsOf(v, entries)).flatMap(shellWords));
  return [];
}

/** The text's words read as bytes: an escaped quote or backslash undone, split on punctuation. */
function rawWords(text: string): string[] {
  const plain = text.replace(/\\\\/g, "/").replace(/\\["']/g, " ");
  return plain.split(/[\s"'`,;&|<>(){}[\]]+/).filter(Boolean);
}

/** `entries`, each without repeats, until {@link MAX_WORDS} words are read. */
function capped(entries: readonly string[][]): string[][] {
  let left = MAX_WORDS;
  return entries.map((words) => {
    const kept = [...new Set(words)].slice(0, Math.max(left, 0));
    left -= kept.length;
    return kept;
  });
}
