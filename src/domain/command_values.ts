import { isPathKey } from "./command_search_path.ts";
import { commandWords, PARSE_LIMIT, type Reading } from "./command_words.ts";
import { semanticsOf, surelySetsPath } from "./env_surfaces.ts";
import { respellsProjectVariable } from "./project_variable.ts";

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
  const strings: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (respellsProjectVariable(key)) walk.read.rebindsProject = true;
    if (isPathKey(key) && typeof v === "string") {
      const [sure, semantics] = [surelySetsPath(key, under), semanticsOf(walk.read.source, under)];
      walk.read.pathValues.push({ value: v, sure, semantics });
    }
    strings.push(...stringsOf(v, walk, below(under, key)));
  }
  walk.entries.push(commandWords(strings, walk.read));
  return [];
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
