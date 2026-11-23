/**
 * The narrow block YAML of the project-owned gate configs (spec 038), as the binary reads it. The
 * bash reader is the awk in `_config.sh`; both are held to one corpus, `tests/fixtures/size_limits/`,
 * so they cannot read one file two ways. What a record means is the caller's (`size_limits.ts`).
 */

export type ParsedRecord =
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
export function parseNarrowYaml(
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
