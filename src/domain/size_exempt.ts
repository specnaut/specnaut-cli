import { CONSTITUTION_PATH } from "./constitution_paths.ts";

/**
 * Which rule holds a tracked path: the one home of that decision (plan § 5). `size-ratchet.sh`'s
 * `is_exempt` is the bash asker of the same rule, and a differential fixture holds the two equal
 * both ways (SC-002), so a file the ratchet leaves out, the scan leaves out by the same rule.
 */

/** Why a path is left out, as the report counts it (FR-004). */
export const EXEMPT_REASONS = ["specnaut", "installed_lock", "exempt_glob", "binary"] as const;
export type ExemptReason = typeof EXEMPT_REASONS[number];

/** The unit a path is held to, or why it is held to none. */
export type HeldBy =
  | { readonly kind: "unit"; readonly unit: "file" | "constitution" }
  | { readonly kind: "exempt"; readonly reason: ExemptReason };

/** A config glob split into code points once; `plain` when it holds no `*?[\`, so it is itself. */
type CompiledGlob = {
  readonly text: string;
  readonly points: readonly string[];
  readonly plain: boolean;
};

export type ExemptRules = {
  /** The paths `.specnaut/installed.lock` lists: Specnaut's own files, rewritten by `upgrade`. */
  readonly managed: ReadonlySet<string>;
  /** The config's `exempt:` globs, compiled, already within `exemptGlobsProblem`'s bounds. */
  readonly globs: readonly CompiledGlob[];
};

/** The rules of one scan, each glob compiled once when the config is read, never per path. */
export function exemptRules(managed: ReadonlySet<string>, globs: readonly string[]): ExemptRules {
  const compiled = globs.map((text) => ({ text, points: [...text], plain: !/[*?[\\]/.test(text) }));
  return { managed, globs: compiled };
}

/**
 * The constitution first, before any exemption: it is loaded into every session, and an `exempt:`
 * glob does not reach it. Then Specnaut's own tree, the lock's entries and the globs, in the
 * ratchet's order. Binary files are decided apart (`binaryByAttribute`, `binaryBySize`,
 * `hasNulPrefix`), because the attribute comes from git and the sniff from the bytes.
 */
export function heldBy(path: string, rules: ExemptRules): HeldBy {
  if (path === CONSTITUTION_PATH) return { kind: "unit", unit: "constitution" };
  if (path.startsWith(".specnaut/")) return { kind: "exempt", reason: "specnaut" };
  if (rules.managed.has(path)) return { kind: "exempt", reason: "installed_lock" };
  if (anyGlobTakes(rules.globs, path)) return { kind: "exempt", reason: "exempt_glob" };
  return { kind: "unit", unit: "file" };
}

/** Whether a glob takes `path` or `/path`; the path is split into code points once, if at all. */
function anyGlobTakes(globs: readonly CompiledGlob[], path: string): boolean {
  const slashed = `/${path}`;
  let points: readonly string[] | null = null;
  for (const { text, points: glob, plain } of globs) {
    if (plain && (text === path || text === slashed)) return true;
    if (plain) continue;
    points ??= [...slashed];
    if (matchPoints(glob, points, 1) || matchPoints(glob, points, 0)) return true;
  }
  return false;
}

/** git's own sniff window: a NUL in the first 8000 bytes makes a blob binary. */
export const BINARY_SNIFF_BYTES = 8000;

/** git's default `core.bigFileThreshold`: a larger file is binary to `git diff` whatever it holds. */
const BIG_FILE_BYTES = 512 * 1024 * 1024;

/** Whether a file of `size` bytes is binary by its size alone, before a byte of it is read. */
export const binaryBySize = (size: number): boolean => size > BIG_FILE_BYTES;

/** Whether the first bytes of a file hold a NUL, as git judges a blob binary. */
export function hasNulPrefix(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * What `git check-attr diff` says about binariness: `unset` (`-diff`, or the `binary` macro) is
 * binary, `set` is text whatever the bytes, anything else leaves it to the size and the sniff.
 */
export function binaryByAttribute(value: string): boolean | null {
  if (value === "unset") return true;
  return value === "set" ? false : null;
}

/** Bounds on the config's globs: a path costs at most twice their total length times its own. */
export const MAX_EXEMPT_GLOBS = 128;
export const MAX_GLOB_LENGTH = 256;
export const MAX_GLOBS_TOTAL = 2048;

/** Why the globs cannot be used, or `null`: a config over a bound is refused, never trimmed. */
export function exemptGlobsProblem(globs: readonly string[]): string | null {
  if (globs.length > MAX_EXEMPT_GLOBS) {
    return `more than ${MAX_EXEMPT_GLOBS} exempt globs`;
  }
  const long = globs.findIndex((g) => g.length > MAX_GLOB_LENGTH);
  if (long >= 0) return `exempt glob ${long + 1} is over ${MAX_GLOB_LENGTH} characters`;
  const total = globs.reduce((sum, g) => sum + g.length, 0);
  return total > MAX_GLOBS_TOTAL ? `exempt globs total over ${MAX_GLOBS_TOTAL} characters` : null;
}

/**
 * Whether `subject` matches `glob` as a bash `case` pattern does: `*` crosses `/`, `?` is one
 * character, `[…]` a set with `!` or `^` negation, ranges and POSIX classes, `\` escapes. Iterative
 * two-pointer matching with one backtrack point, never a `RegExp` (plan S6): its cost is at most
 * the product of the two lengths, whatever the pattern.
 */
export function globMatches(glob: string, subject: string): boolean {
  return matchPoints([...glob], [...subject]);
}

/** `globMatches` on a glob and a subject already split into code points, from `s[start]` on. */
function matchPoints(p: readonly string[], s: readonly string[], start = 0): boolean {
  let [pi, si, starP, starS] = [0, start, -1, start];
  while (si < s.length) {
    if (p[pi] === "*") {
      starP = ++pi;
      starS = si;
      continue;
    }
    const step = pi < p.length ? matchOne(p, pi, s[si]) : 0;
    if (step > 0) [pi, si] = [pi + step, si + 1];
    else if (starP < 0) return false;
    else [pi, si] = [starP, ++starS];
  }
  while (p[pi] === "*") pi++;
  return pi === p.length;
}

/** How many pattern characters one subject character consumed at `pi`, or 0 for no match. */
function matchOne(p: readonly string[], pi: number, c: string): number {
  const t = p[pi];
  if (t === "?") return 1;
  if (t === "\\") {
    if (pi + 1 >= p.length) return c === "\\" ? 1 : 0;
    return p[pi + 1] === c ? 2 : 0;
  }
  if (t === "[") {
    const set = bracket(p, pi, c);
    if (set !== null) return set.matched ? set.end - pi : 0;
  }
  return t === c ? 1 : 0;
}

/** A `[…]` set at `pi`: where it ends and whether `c` is in it, or `null` when it never closes. */
function bracket(p: readonly string[], pi: number, c: string) {
  let i = pi + 1;
  const negated = p[i] === "!" || p[i] === "^";
  if (negated) i++;
  let hit = false;
  for (let first = true; i < p.length; first = false) {
    if (p[i] === "]" && !first) return { end: i + 1, matched: hit !== negated };
    const item = setItem(p, i, c);
    hit ||= item.hit;
    i = item.next;
  }
  return null;
}

/** One item of a set at `i`: a class, an escaped or plain character, or a range. */
function setItem(p: readonly string[], i: number, c: string): { hit: boolean; next: number } {
  if (p[i] === "[" && p[i + 1] === ":") {
    const close = p.indexOf(":", i + 2);
    const name = close > 0 && p[close + 1] === "]" ? p.slice(i + 2, close).join("") : null;
    const test = name === null ? undefined : POSIX_CLASSES.get(name);
    if (test !== undefined) return { hit: test(c), next: close + 2 };
  }
  const lo = p[i] === "\\" && i + 1 < p.length ? p[++i] : p[i];
  if (p[i + 1] === "-" && i + 2 < p.length && p[i + 2] !== "]") {
    const hi = p[i + 2] === "\\" && i + 3 < p.length ? p[i + 3] : p[i + 2];
    const next = p[i + 2] === "\\" ? i + 4 : i + 3;
    return { hit: lo <= c && c <= hi, next };
  }
  return { hit: c === lo, next: i + 1 };
}

/** Whether `c` falls in one of the inclusive ranges, written as pairs: `"AZaz"`. */
const inRanges = (ranges: string) => (c: string): boolean => {
  for (let i = 0; i < ranges.length; i += 2) if (ranges[i] <= c && c <= ranges[i + 1]) return true;
  return false;
};

/** The POSIX classes, in the C locale bash uses for a script with no locale set. */
const POSIX_CLASSES: ReadonlyMap<string, (c: string) => boolean> = new Map([
  ["alpha", inRanges("AZaz")],
  ["digit", inRanges("09")],
  ["alnum", inRanges("AZaz09")],
  ["upper", inRanges("AZ")],
  ["lower", inRanges("az")],
  ["space", inRanges("\t\r  ")],
  ["blank", inRanges("\t\t  ")],
  ["punct", inRanges("!/:@[`{~")],
  ["xdigit", inRanges("09AFaf")],
  ["word", inRanges("AZaz09__")],
]);
