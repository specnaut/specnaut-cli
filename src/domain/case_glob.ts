/**
 * A path against a glob as bash `case` matches it, the way `_config.sh`'s `config_exempt` asks: the
 * one TypeScript copy of that matcher. `size_exempt.ts` asks it for the config's `exempt:` globs.
 */

/** A config glob split into code points once; `plain` when it holds no `*?[\`, so it is itself. */
export type CompiledGlob = {
  readonly text: string;
  readonly points: readonly string[];
  readonly plain: boolean;
};

/** Globs compiled once, when the config is read, never per path. */
export function compileGlobs(globs: readonly string[]): CompiledGlob[] {
  return globs.map((text) => ({ text, points: [...text], plain: !/[*?[\\]/.test(text) }));
}

/** Whether a glob takes `path` or `/path`; the path is split into code points once, if at all. */
export function anyGlobTakes(globs: readonly CompiledGlob[], path: string): boolean {
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
