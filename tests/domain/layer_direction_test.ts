import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { dirname, fromFileUrl, join, relative, resolve, SEPARATOR } from "@std/path";
import { walk } from "@std/fs/walk";

/**
 * The domain layer depends on nothing outward and touches no `Deno.*` API
 * (cli#695).
 *
 * The layering under `src/` is `domain/` (pure) ← `application/` ←
 * `infrastructure/` / `cli/`. A rule stated only in prose is a rule nothing
 * enforces: `domain/cloud/` imported an infrastructure type and did its own file
 * and environment I/O for months with every test green. This walks every file
 * under `src/domain/` and fails on either breach.
 *
 * Comments are ignored, and so are string contents for the `Deno.*` check: the
 * domain's own doc comments say "the domain layer never touches `Deno.*`", and a
 * guard that flagged its own rule would be muted on its first day.
 */

const SRC = fromFileUrl(new URL("../../src", import.meta.url));
const DOMAIN = join(SRC, "domain");
const OUTWARD = ["application", "infrastructure", "cli"];

/** Characters after which a `/` opens a regex literal rather than dividing. */
const REGEX_PRECEDES = new Set([..."(,=:[!&|?{};+-*%<>~^"]);

/** Keywords after which a `/` opens a regex literal. */
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "void", "throw"]);

/** Blank `s[from, to)` in `out`, keeping newlines so line numbers survive. */
function blank(out: string[], s: string, from: number, to: number): void {
  for (let i = from; i < to; i++) if (s[i] !== "\n") out[i] = " ";
}

/** Index just past the quoted string opened at `i` (escape-aware). */
function endOfQuoted(s: string, i: number): number {
  const q = s[i];
  let j = i + 1;
  while (j < s.length && s[j] !== q && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** Index just past the regex literal opened at `i` (escape- and class-aware). */
function endOfRegex(s: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < s.length && s[j] !== "\n") {
    if (s[j] === "\\") j++;
    else if (s[j] === "[") inClass = true;
    else if (s[j] === "]") inClass = false;
    else if (s[j] === "/" && !inClass) break;
    j++;
  }
  j++;
  while (j < s.length && /[a-z]/.test(s[j])) j++; // flags
  return j;
}

/**
 * Two views of a TypeScript source: `code`, with comments blanked, and `bare`,
 * with string, template and regex contents blanked too. A lexer, not a parser —
 * enough to tell prose and literals from code. A template's `${…}` holes stay
 * code, nested to any depth.
 */
function views(s: string): { code: string; bare: string } {
  const code = [...s];
  const bare = [...s];
  const holes: number[] = []; // brace depth at each open `${`, innermost last
  let depth = 0;
  let lastSignificant = "";
  let wordStart = 0;
  let i = 0;
  const template = (start: number): number => {
    let j = start;
    while (j < s.length && s[j] !== "`") {
      if (s[j] === "\\") j += 2;
      else if (s[j] === "$" && s[j + 1] === "{") {
        blank(bare, s, start, j);
        holes.push(depth);
        depth++;
        return j + 2;
      } else j++;
    }
    blank(bare, s, start, j);
    lastSignificant = "`";
    return j + 1;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "/") {
      const end = s.indexOf("\n", i) === -1 ? s.length : s.indexOf("\n", i);
      blank(code, s, i, end);
      blank(bare, s, i, end);
      i = end;
    } else if (c === "/" && s[i + 1] === "*") {
      const close = s.indexOf("*/", i + 2);
      const end = close === -1 ? s.length : close + 2;
      blank(code, s, i, end);
      blank(bare, s, i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      const end = endOfQuoted(s, i);
      blank(bare, s, i + 1, end - 1);
      lastSignificant = c;
      i = end;
    } else if (c === "`") {
      i = template(i + 1);
    } else if (c === "/" && (lastSignificant === "" || REGEX_PRECEDES.has(lastSignificant))) {
      const end = endOfRegex(s, i);
      blank(bare, s, i + 1, end);
      lastSignificant = "/";
      i = end;
    } else if (c === "}" && holes.length > 0 && holes[holes.length - 1] === depth - 1) {
      holes.pop();
      depth--;
      i = template(i + 1);
    } else {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      if (!/\s/.test(c)) lastSignificant = /[\w$]/.test(c) ? "a" : c;
      if (/[\w$]/.test(c) && !/[\w$]/.test(s[i - 1] ?? "")) wordStart = i;
      // A keyword that can precede a regex reads as an operator, not an operand.
      if (/[\w$]/.test(c) && !/[\w$]/.test(s[i + 1] ?? "")) {
        if (REGEX_KEYWORDS.has(s.slice(wordStart, i + 1))) lastSignificant = "(";
      }
      i++;
    }
  }
  return { code: code.join(""), bare: bare.join("") };
}

const SPECIFIER =
  /\b(?:from\s*|import\s*\(\s*|import\s+)(["'])([^"'\n]+)\1|\bexport\s[^;]*?\bfrom\s*(["'])([^"'\n]+)\3/g;

/** Every module specifier a source imports or re-exports from, comments excluded. */
function specifiers(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(SPECIFIER)) out.push(m[2] ?? m[4]);
  return out;
}

const lineOf = (s: string, at: number) => s.slice(0, at).split("\n").length;

/** Each breach in one domain file, as `path:line: what`. */
function breaches(rel: string, abs: string, src: string): string[] {
  const { code, bare } = views(src);
  const out: string[] = [];
  for (const spec of specifiers(code)) {
    if (!spec.startsWith(".")) continue; // `@std/*`, `jsr:`, `npm:` — libraries
    const target = relative(SRC, resolve(dirname(abs), spec)).split(SEPARATOR)[0];
    if (OUTWARD.includes(target)) out.push(`${rel}: imports ${spec}`);
  }
  for (const m of bare.matchAll(/\bDeno\s*\.\s*[\w$]+/g)) {
    out.push(`${rel}:${lineOf(bare, m.index)}: uses ${m[0].replace(/\s/g, "")}`);
  }
  return out;
}

async function domainBreaches(): Promise<{ files: number; found: string[] }> {
  let files = 0;
  const found: string[] = [];
  for await (const e of walk(DOMAIN, { exts: [".ts"], includeDirs: false })) {
    files++;
    const rel = relative(SRC, e.path).split(SEPARATOR).join("/");
    found.push(...breaches(rel, e.path, await Deno.readTextFile(e.path)));
  }
  return { files, found: found.sort() };
}

Deno.test("no file under src/domain imports outward or uses a Deno API", async () => {
  const { files, found } = await domainBreaches();
  // A floor: a walk that matched nothing would pass in silence.
  assertGreaterOrEqual(files, 60, `the walk read ${files} domain files; it read 71 when written`);
  assertEquals(found, [], `the domain layer must stay pure:\n${found.join("\n")}`);
});

Deno.test("breaches: sees an outward import and a Deno call, not prose or literals", () => {
  // The positive control. Every assertion above is downstream of the lexer, so
  // a lexer that blanked everything would make the walk vacuously clean.
  const abs = join(DOMAIN, "cloud", "x.ts");
  const src = [
    "// Deno.readTextFile in a comment",
    "/** never touches `Deno.*` */",
    'import type { A } from "../../infrastructure/a.ts";',
    'import { B } from "../b.ts";',
    'export { C } from "../../cli/c.ts";',
    'const s = "Deno.env.get";',
    "const r = /Deno\\.x/;",
    "const t = `Deno.y ${Deno.env.get(`K`)} //`;",
    "const u = a / b; const v = Deno.cwd();",
    'const w = await import("../../application/w.ts");',
  ].join("\n");
  assertEquals(breaches("domain/cloud/x.ts", abs, src).sort(), [
    "domain/cloud/x.ts: imports ../../application/w.ts",
    "domain/cloud/x.ts: imports ../../cli/c.ts",
    "domain/cloud/x.ts: imports ../../infrastructure/a.ts",
    "domain/cloud/x.ts:8: uses Deno.env",
    "domain/cloud/x.ts:9: uses Deno.cwd",
  ]);
});
