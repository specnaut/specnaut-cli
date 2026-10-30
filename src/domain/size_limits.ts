import { CONSTITUTION_PATH, SIZE_LIMITS_CONFIG_PATH } from "./constitution_paths.ts";
import type { DiskEntry } from "./context_link.ts";

/**
 * Size limits, as the binary judges them (spec 038). The gate itself is
 * `size-ratchet.sh`; this module answers the one size question the CLI asks
 * on its own — is the constitution over its ceiling — and is the TypeScript
 * reader of `.specnaut/size-limits.yml`. The bash reader is `_config.sh`
 * beside the ratchet; both are held to one corpus,
 * `tests/fixtures/size_limits/`, so they cannot read one file two ways.
 */

/** A unit's limits in lines. `null` is the config's `none`: that rule is off. */
export type SizeLimit = {
  readonly target: number | null;
  readonly ceiling: number | null;
};

/** The units the config sets. `class`, `component` and the like are the agents' judgement. */
export const SIZE_UNITS = ["file", "function", "constitution"] as const;
export type SizeUnit = typeof SIZE_UNITS[number];

/**
 * The `constitution` default from `.specnaut/memory/size-limits.md`. It is
 * short on purpose: the file is loaded into every session, so every line it
 * gains is paid by every later one.
 */
export const DEFAULT_CONSTITUTION_LIMIT: SizeLimit = { target: 60, ceiling: 100 };

/**
 * The defaults of `.specnaut/memory/size-limits.md`, mirrored here and in
 * `_config.sh`; `size_thresholds_single_arbiter_test.ts` pins all three
 * copies to that file's table.
 */
export const DEFAULT_SIZE_LIMITS: Readonly<Record<SizeUnit, SizeLimit>> = {
  file: { target: 300, ceiling: 500 },
  function: { target: 30, ceiling: 50 },
  constitution: DEFAULT_CONSTITUTION_LIMIT,
};

/** A unit's limits, and whether the project's config set them. */
export type ResolvedLimit = SizeLimit & { readonly source: "config" | "default" };

export type SizeLimits = {
  readonly units: Readonly<Record<SizeUnit, ResolvedLimit>>;
  /** Globs matched against the repository-relative path; never the constitution. */
  readonly exempt: readonly string[];
};

/**
 * The config, read. `unreadable` is never answered with the defaults: a file
 * the gate stops on (exit 2) must not look like a project with no limits.
 */
export type SizeConfig =
  | { readonly kind: "ok"; readonly limits: SizeLimits }
  | { readonly kind: "unreadable"; readonly reason: string };

/** A limit value: a whole number of lines or `none` (S4). Nine digits: `[ -gt ]` never overflows. */
export const LIMIT_VALUE = /^(none|[0-9]{1,9})$/;

/** `"300"` → 300, `"none"` → null. Only for a value that matched `LIMIT_VALUE`. */
const toLimit = (v: string): number | null => v === "none" ? null : Number.parseInt(v, 10);

/** A value as the config spells it. */
export const limitText = (n: number | null): string => n === null ? "none" : String(n);

type ParsedRecord =
  | { kind: "key"; line: number; key: string }
  | { kind: "child"; line: number; key: string; child: string; value: string }
  | { kind: "item"; line: number; key: string; value: string };

/** A plain list entry YAML would read as something else: flow, alias, tag, comment, map. */
const PLAIN_TRAP = /^[\][{}*&!|>%@`#,?:'"]|^- | #|: |:$/;

/**
 * The narrow block YAML both readers take, and nothing else: a top-level key
 * alone on its line; under it, children `  name: value` (a map) or entries
 * `  - value` (a list). Full-line `#` comments and blank lines are skipped; a
 * trailing comment is not stripped — it fails the value check or the list
 * rule. CRLF line ends are taken (an autocrlf checkout), any other carriage
 * return, and every tab, are refused. Flow maps, inline values, block
 * scalars, deeper indentation and a key given twice are refused. Mirrors the
 * awk in `_config.sh`, message for message.
 */
function parseNarrowYaml(
  text: string,
  maps: readonly string[],
  lists: readonly string[],
): ParsedRecord[] | string {
  const st: ParseState = {
    kind: new Map<string, "map" | "list">([
      ...maps.map((k) => [k, "map"] as const),
      ...lists.map((k) => [k, "list"] as const),
    ]),
    records: [],
    seen: new Map(),
    got: new Set(),
    has: new Set(),
    cur: "",
  };
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const [i, raw] of lines.entries()) {
    const refused = parseLine(st, raw, i + 1);
    if (refused !== null) return `line ${i + 1}: ${refused}`;
  }
  for (const [key, n] of st.seen) if (!st.has.has(key)) return `line ${n}: '${key}' has no value`;
  return st.records;
}

/** What `parseNarrowYaml` has read so far: the keys, the children and the current key. */
type ParseState = {
  readonly kind: ReadonlyMap<string, "map" | "list">;
  readonly records: ParsedRecord[];
  /** Top-level key → the line it is on. */
  readonly seen: Map<string, number>;
  /** `key.child` pairs already given. */
  readonly got: Set<string>;
  /** Keys with at least one value under them. */
  readonly has: Set<string>;
  cur: string;
};

/** Takes one line into `st`: `null` when taken or skipped, else why it is refused. */
function parseLine(st: ParseState, raw: string, n: number): string | null {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (line.includes("\r")) return "a carriage return inside a line";
  if (line.includes("\t")) return "a tab — indent with two spaces";
  if (/^ *$/.test(line) || /^ *#/.test(line)) return null;
  const top = /^([a-z_]+): *$/.exec(line);
  if (top) return topKey(st, top[1], n);
  if (/^[a-z_]+:/.test(line)) {
    return "an inline or flow value — write the block form, one value per line";
  }
  if (/^[^ ]/.test(line)) return "a line this reader does not take";
  if (st.cur === "") return "a value outside any key";
  const child = /^ {2}([a-z_]+):(.*)$/.exec(line);
  if (st.kind.get(st.cur) === "map" && child) return mapChild(st, child[1], child[2], n);
  if (st.kind.get(st.cur) === "list" && line.startsWith("  - ")) {
    return listItem(st, line.slice(4), n);
  }
  return "a line this reader does not take — one value per line, indented two spaces";
}

/** A top-level key alone on its line: known, and given once. */
function topKey(st: ParseState, key: string, n: number): string | null {
  if (!st.kind.has(key)) return `unknown key '${key}'`;
  if (st.seen.has(key)) return `'${key}' is given twice`;
  st.seen.set(key, n);
  st.cur = key;
  st.records.push({ kind: "key", line: n, key });
  return null;
}

/** `  name: value` under a map key: a value, given once. */
function mapChild(st: ParseState, child: string, rest: string, n: number): string | null {
  const value = rest.replace(/^ +/, "").replace(/ +$/, "");
  const path = `${st.cur}.${child}`;
  if (value === "") return `'${path}' has no value`;
  if (st.got.has(path)) return `'${path}' is given twice`;
  st.got.add(path);
  st.has.add(st.cur);
  st.records.push({ kind: "child", line: n, key: st.cur, child, value });
  return null;
}

/** `  - value` under a list key: plain only when YAML would read it as written; quotes peel. */
function listItem(st: ParseState, rest: string, n: number): string | null {
  let value = rest.replace(/ +$/, "");
  if (/^"[^"\\]*"$/.test(value) || /^'[^']*'$/.test(value)) value = value.slice(1, -1);
  else if (PLAIN_TRAP.test(value)) return "a value YAML reads otherwise — quote it";
  if (value === "") return "an empty entry";
  st.has.add(st.cur);
  st.records.push({ kind: "item", line: n, key: st.cur, value });
  return null;
}

/**
 * Reads `.specnaut/size-limits.yml` (FR-008). `null` — no file — is the
 * defaults; any file the ratchet would stop on is `unreadable`, with the
 * reason the ratchet prints. Settings are checked in file order, after the
 * whole file parsed, as `config_size_limits` does.
 */
export function readSizeLimits(text: string | null): SizeConfig {
  const dflt = (u: SizeUnit): ResolvedLimit => ({ ...DEFAULT_SIZE_LIMITS[u], source: "default" });
  const units = {
    file: dflt("file"),
    function: dflt("function"),
    constitution: dflt("constitution"),
  };
  if (text === null) return { kind: "ok", limits: { units, exempt: [] } };
  const parsed = parseNarrowYaml(text, SIZE_UNITS, ["exempt"]);
  if (typeof parsed === "string") return { kind: "unreadable", reason: parsed };
  const given = givenSettings(parsed);
  if (typeof given === "string") return { kind: "unreadable", reason: given };
  for (const r of parsed) {
    if (r.kind !== "key" || r.key === "exempt") continue;
    const set = given.values.get(r.key)!;
    const lacks = ["target", "ceiling"].find((child) => !set.has(child));
    if (lacks !== undefined) {
      return { kind: "unreadable", reason: `line ${r.line}: '${r.key}' lacks its ${lacks}` };
    }
    const [target, ceiling] = [set.get("target")!, set.get("ceiling")!];
    units[r.key as SizeUnit] = { target, ceiling, source: "config" };
  }
  return { kind: "ok", limits: { units, exempt: given.exempt } };
}

/** Every value checked in file order, the first bad one the reason; and the exempt globs. */
function givenSettings(parsed: readonly ParsedRecord[]) {
  const exempt: string[] = [];
  const values = new Map<string, Map<string, number | null>>();
  for (const r of parsed) {
    if (r.kind === "key") values.set(r.key, new Map());
    if (r.kind === "item") exempt.push(r.value);
    if (r.kind !== "child") continue;
    const at = `line ${r.line}: '${r.key}.${r.child}'`;
    if (r.child !== "target" && r.child !== "ceiling") {
      return `${at} is not a setting — expected target and ceiling`;
    }
    if (!LIMIT_VALUE.test(r.value)) {
      return `${at} is '${r.value}' — expected a whole number of lines or none`;
    }
    values.get(r.key)!.set(r.child, toLimit(r.value));
  }
  return { values, exempt };
}

/**
 * The config as `lstat` sees it: a link is unreadable whatever it points at —
 * the hooks guard the config by its path, and a link would move the file they
 * guard somewhere they do not look. Bytes that are not UTF-8 are unreadable.
 */
export function sizeConfigFromEntry(entry: DiskEntry | null): SizeConfig {
  if (entry === null) return readSizeLimits(null);
  if (entry.kind === "symlink") {
    return {
      kind: "unreadable",
      reason: "is a link — the config is read only from a regular file",
    };
  }
  if (entry.lossy) return { kind: "unreadable", reason: "is not valid UTF-8" };
  return readSizeLimits(entry.content);
}

/** What `check` and `upgrade` say about a config the ratchet stops on. */
export function sizeConfigUnreadableNote(reason: string): string {
  return `${SIZE_LIMITS_CONFIG_PATH} is unreadable (${reason}) — the size ratchet stops on it ` +
    `with exit 2; fix it`;
}

/**
 * `.specnaut/size-limits.yml` for the given units and globs, in the form both
 * readers take. Globs are double-quoted — `*.lock` bare is a YAML alias — so
 * a glob holding `"`, `\` or a control character cannot be written.
 */
export function sizeLimitsYaml(
  units: Partial<Record<SizeUnit, SizeLimit>>,
  exempt: readonly string[],
): string {
  let out = "";
  for (const u of SIZE_UNITS) {
    const l = units[u];
    if (l === undefined) continue;
    out += `${u}:\n  target: ${limitText(l.target)}\n  ceiling: ${limitText(l.ceiling)}\n`;
  }
  if (exempt.length > 0) out += `exempt:\n${exempt.map((g) => `  - "${g}"\n`).join("")}`;
  return out;
}

/** Whether `glob` can be written as a quoted entry and read back as itself. */
export const isWritableGlob = (glob: string): boolean => /^[^"\\\p{Cc}]+$/u.test(glob);

/** How far over its ceiling the constitution is. */
export type OverCeiling = { readonly lines: number; readonly ceiling: number };

/** Lines as `wc -l` counts them — newlines — so the warning and the ratchet agree. */
function countLines(text: string): number {
  return text.split("\n").length - 1;
}

/**
 * The constitution's size against its ceiling, or `null` when it is within
 * it (or the ceiling is `none`). The one home of this judgement: `check` and
 * the upgrade notice both ask it, so neither counts lines itself.
 */
export function constitutionOverCeiling(
  text: string,
  limit: SizeLimit = DEFAULT_CONSTITUTION_LIMIT,
): OverCeiling | null {
  if (limit.ceiling === null) return null;
  const lines = countLines(text);
  return lines > limit.ceiling ? { lines, ceiling: limit.ceiling } : null;
}

/** What `check` and `upgrade` say about an over-ceiling constitution. */
export function constitutionCeilingNote(over: OverCeiling): string {
  return `${CONSTITUTION_PATH} is ${over.lines} lines, over its ceiling of ${over.ceiling} — ` +
    `shrink it; every session loads it`;
}
