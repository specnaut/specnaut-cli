import { isPathKey } from "./command_search_path.ts";
import { commandWords, PARSE_LIMIT, type Reading } from "./command_words.ts";
import { isEnvSurface, semanticsOf, surelySetsPath } from "./env_surfaces.ts";
import { respellsProjectVariable } from "./project_variable.ts";
import { type Carried, noteKey } from "./sourced_files.ts";

/**
 * The walk of a parsed command source (a JSON or TOML config, a YAML frontmatter): each object's
 * strings are one group of words (`command_words.ts`), and each key `path` of it a value PATH may
 * be set to (`command_search_path.ts`).
 */

/**
 * At most this many objects and lists are walked in one source. Each takes at least a byte of its
 * own, so no source within {@link PARSE_LIMIT} holds more: the cap only stops a walk that would
 * take a value met again (a YAML alias) once per use, and makes that reading not whole.
 */
const MAX_VISITS = PARSE_LIMIT;

/** Every group of words `value` holds: one per object, its own strings together. */
export function valueEntries(value: unknown, read: Reading): string[][] {
  const walk: Walk = { seen: new Set(), visits: 0, entries: [], read };
  walk.entries.push(commandWords(stringsOf(value, walk, []), read));
  return walk.entries;
}

/**
 * The strings of `value` that belong to the object holding it; each object's are one entry. An
 * object or a list met again (a YAML alias is the same value at each use) is read once: walking it
 * at each use would read a chain of aliases in time doubling with its length, and its strings are
 * already read. `under` is the last two keys above `value` (`""` for a list), which say whether a
 * key `path` of it sets the environment's PATH (`surelySetsPath`).
 */
function stringsOf(value: unknown, walk: Walk, under: readonly string[]): string[] {
  if (typeof value === "string") return [value];
  if (!firstVisit(value, walk)) return [];
  if (Array.isArray(value)) return value.flatMap((v) => stringsOf(v, walk, below(under, "")));
  const [strings, code]: string[][] = [[], []];
  const carried: Carried = { unread: false, files: [] };
  const exec = execForm(value);
  for (const [key, v] of Object.entries(value)) {
    if (respellsProjectVariable(key)) walk.read.rebindsProject = true;
    if (isEnvSurface(under) && typeof v === "string") noteKey(carried, key, v);
    if (isPathKey(key) && typeof v === "string") {
      const [sure, semantics] = [surelySetsPath(key, under), semanticsOf(walk.read.source, under)];
      walk.read.pathValues.push({ value: v, sure, semantics });
    }
    const own = stringsOf(v, walk, below(under, key));
    strings.push(...own);
    if (!(exec.length > 0 && key === "command") && runs(key, under)) {
      code.push(...own);
    }
  }
  const [argv, moved] = [exec.length > 0 ? [exec] : [], Object.hasOwn(value, "cwd")];
  walk.entries.push(commandWords(strings, walk.read, { code, argv, moved }));
  if (carried.unread) walk.read.whole = false;
  carried.files.forEach((file) => walk.read.sourced.add(file));
  return [];
}

/**
 * The command an object starts with no shell: its `command` and each string of its `args`, a
 * hook's exec form or an MCP server's; none when it has no `args` list.
 */
function execForm(value: object): string[] {
  const { command, args } = value as Record<string, unknown>;
  if (typeof command !== "string" || !Array.isArray(args)) return [];
  return [command, ...args.filter((a): a is string => typeof a === "string")];
}

/**
 * The keys whose string a harness never runs: a hook's `matcher` (a pattern), `type`, `shell` and
 * `statusMessage`, a server's `url` and `cwd`, a `description`, Codex's environment filters
 * (`include_only`, `exclude`, `env_vars`), and `args`, a command's arguments, run with it alone
 * (`execForm`).
 */
const NOT_RUN = new Set(
  "matcher type shell statusMessage url cwd description include_only exclude env_vars args"
    .split(" "),
);

/**
 * Whether a harness may run the string of `key` in an object held under `under`: not a key of
 * {@link NOT_RUN} or a key `path` (a folder), a value of an object that sets the environment
 * (`env_surfaces.ts`) or of a `headers` object, nor a permission rule, which grants a command
 * rather than runs one. A string it never runs is read for its paths as any other, but no rule on
 * code a command runs holds it.
 */
function runs(key: string, under: readonly string[]): boolean {
  if (NOT_RUN.has(key) || isPathKey(key) || isEnvSurface(under)) return false;
  if (/headers$/i.test(under.at(-1) ?? "")) return false;
  return !(under.at(-1) === "permissions" && ["allow", "deny", "ask"].includes(key));
}

/** The last two keys above a value held at `key` of one held under `under`. */
const below = (under: readonly string[], key: string) => [...under, key].slice(-2);

/**
 * A walk of one parsed value: the objects and lists it has met, how many times it entered one,
 * the groups of words it found, and the reading it notes them in.
 */
type Walk = {
  readonly seen: Set<object>;
  visits: number;
  readonly entries: string[][];
  readonly read: Reading;
};

/**
 * Whether `value` is an object or a list the walk has not met: one past {@link MAX_VISITS} is not
 * entered, and the reading is not whole.
 */
function firstVisit(value: unknown, walk: Walk): value is object {
  if (value === null || typeof value !== "object" || walk.seen.has(value)) return false;
  if (++walk.visits > MAX_VISITS) {
    walk.read.whole = false;
    return false;
  }
  walk.seen.add(value);
  return true;
}
