import { assert, assertEquals } from "@std/assert";
import {
  exemptGlobsProblem,
  exemptRules,
  type HeldBy,
  heldBy,
  MAX_EXEMPT_GLOBS,
  MAX_GLOB_LENGTH,
  MAX_GLOBS_TOTAL,
} from "../../src/domain/size_exempt.ts";
import { globMatches } from "../../src/domain/case_glob.ts";

const rules = (globs: string[] = [], managed: string[] = []) =>
  exemptRules(new Set(managed), globs);

Deno.test("heldBy: the constitution is held first, even under a glob that takes everything", () => {
  assertEquals(heldBy("docs/constitution.md", rules(["*"])), {
    kind: "unit",
    unit: "constitution",
    marker: false,
  });
});

Deno.test("heldBy: Specnaut's tree, then the lock's entries, then the globs", () => {
  const r = rules(["*.lock", "/gen/*"], [".claude/agents/a.md"]);
  assertEquals(heldBy(".specnaut/x.sh", r), { kind: "exempt", reason: "specnaut" });
  assertEquals(heldBy(".claude/agents/a.md", r), { kind: "exempt", reason: "installed_lock" });
  assertEquals(heldBy("deep/dir/deno.lock", r), { kind: "exempt", reason: "exempt_glob" });
  assertEquals(heldBy("gen/a/b.ts", r), { kind: "exempt", reason: "exempt_glob" });
  assertEquals(heldBy("src/gen/b.ts", r), { kind: "unit", unit: "file", marker: true });
  assertEquals(heldBy("specnaut/x.sh", r), { kind: "unit", unit: "file", marker: true });
});

Deno.test("heldBy: a generated name is exempt with no entry, after every config glob", () => {
  assertEquals(heldBy("src/api.gen.ts", rules()), { kind: "exempt", reason: "generated" });
  assertEquals(heldBy("src/api.gen.ts", rules(["src/*"])), {
    kind: "exempt",
    reason: "exempt_glob",
  });
});

Deno.test("heldBy: a `!` entry keeps a file measured by name and by header, never a glob", () => {
  const r = rules(["!src/api.gen.ts", "!*.lock", "!src/schema.ts"]);
  const measured: HeldBy = { kind: "unit", unit: "file", marker: false };
  assertEquals(heldBy("src/api.gen.ts", r), measured);
  assertEquals(heldBy("deep/Cargo.lock", r), measured);
  assertEquals(heldBy("src/schema.ts", r), measured);
  assertEquals(heldBy("src/other.gen.ts", r), { kind: "exempt", reason: "generated" });
  // `!` is never a positive glob, and never undoes one.
  assertEquals(heldBy("!src/api.gen.ts", r), { kind: "exempt", reason: "generated" });
  assertEquals(heldBy("src/x.ts", rules(["src/*", "!src/x.ts"])), {
    kind: "exempt",
    reason: "exempt_glob",
  });
});

Deno.test("heldBy: a name holding a newline is never exempt, as the ratchet holds it", () => {
  const r = rules(["*"], ["a\nb"]);
  const measured: HeldBy = { kind: "unit", unit: "file", marker: false };
  for (const path of ["a\nb", ".specnaut/a\nb", "x\ny.ts", "a\nb.gen.ts"]) {
    assertEquals(heldBy(path, r), measured, JSON.stringify(path));
  }
});

Deno.test("heldBy: a name holding a control character is never generated, nor its header", () => {
  const measured: HeldBy = { kind: "unit", unit: "file", marker: false };
  for (const path of ["a\x1bb.gen.ts", "a\rb.ts", "a\x9bb.ts"]) {
    assertEquals(heldBy(path, rules()), measured, JSON.stringify(path));
  }
});

Deno.test("exemptGlobsProblem: a config over a bound is refused, never trimmed", () => {
  assertEquals(exemptGlobsProblem(["*.lock"]), null);
  assert(exemptGlobsProblem(Array(MAX_EXEMPT_GLOBS + 1).fill("a")) !== null);
  assert(exemptGlobsProblem(["a", "x".repeat(MAX_GLOB_LENGTH + 1)])!.includes("glob 2"));
  const atTotal = Array(MAX_GLOBS_TOTAL / MAX_GLOB_LENGTH).fill("x".repeat(MAX_GLOB_LENGTH));
  assertEquals(exemptGlobsProblem(atTotal), null);
  assert(exemptGlobsProblem([...atTotal, "y"])!.includes(`total over ${MAX_GLOBS_TOTAL}`));
});

/** The costliest glob the bounds allow: every `a` matches, then the `b` fails, at every start. */
const WORST_GLOB = "*" + "a".repeat(MAX_GLOB_LENGTH - 2) + "b";

Deno.test("heldBy: the costliest config the bounds allow, on long paths, finishes at once", () => {
  const r = rules(Array(MAX_GLOBS_TOTAL / MAX_GLOB_LENGTH).fill(WORST_GLOB));
  const started = performance.now();
  for (let i = 0; i < 4; i++) assertEquals(heldBy(`${"a".repeat(4000)}/f${i}.ts`, r).kind, "unit");
  assert(performance.now() - started < 2000, "the matcher backtracked without bound");
});

/**
 * Globs and subjects bash `case` is asked about, with the classes and escapes the ratchet sees. A
 * trailing `\` is left out: bash 3.2 matches it to nothing and bash 5 to a final `\`, so the
 * ratchet itself answers it two ways; the matcher takes bash 5's.
 */
// deno-fmt-ignore
const GLOBS = [
  "*", "*.lock", "/src/*", "src/*.ts", "?", "a?c", "[abc]*", "[!a]*", "[^a]*", "[a-c]x", "[]]",
  "[!]]", "[a-]", "[[:digit:]]*", "*[[:upper:]]", "[[:alpha:][:digit:]]", "\\*", "a\\?", "[",
  "a[", "a[b", "*/*", "**", "a*b*c", "[\\]]", "[a\\-c]", "*.[ch]", "[z-a]", "[[:bogus:]]",
  "x.lock", "/src/a.ts", "src/a.ts", "a", "]", "a-",
];
// deno-fmt-ignore
const SUBJECTS = [
  "", "a", "abc", "src/a.ts", "/src/a.ts", "x.lock", "d/x.lock", "*", "?", "]", "-", "a-",
  "1x", "aB", "Z", "a?", "[", "a[", "a[b", "x/y", "aXbYc", "b", "\\", "x\\", "m.c", "m.h", "bx",
];

/** bash `case`'s answer for each glob and subject, as the ratchet asks it: an unquoted glob. */
async function bashCase(pairs: readonly (readonly [string, string])[]): Promise<boolean[]> {
  const input = pairs.map(([g, s]) => `${g}\0${s}\0`).join("");
  const script = 'while IFS= read -r -d "" g && IFS= read -r -d "" s; do\n' +
    '  case "$s" in $g) echo 1 ;; *) echo 0 ;; esac\ndone';
  const child = new Deno.Command("bash", {
    args: ["-c", script],
    env: { LC_ALL: "C" },
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const answers = new TextDecoder().decode((await child.output()).stdout).trim().split("\n");
  assertEquals(answers.length, pairs.length);
  return answers.map((a) => a === "1");
}

Deno.test("globMatches: the same answer as bash `case`, glob by subject", async () => {
  const pairs = GLOBS.flatMap((g) => SUBJECTS.map((s) => [g, s] as const));
  const answers = await bashCase(pairs);
  const differ = pairs.filter(([g, s], i) => globMatches(g, s) !== answers[i]);
  assertEquals(differ, [], "the matcher and bash disagree");
});

Deno.test("heldBy: a glob takes a path when bash takes the path or /path, plain or not", async () => {
  const pairs = GLOBS.flatMap((g) => SUBJECTS.flatMap((s) => [[g, s], [g, `/${s}`]] as const));
  const answers = await bashCase(pairs);
  const differ = pairs.filter(([g, s], i) => {
    if (i % 2 === 1) return false;
    const held = heldBy(s, rules([g]));
    const exempt = held.kind === "exempt" && held.reason === "exempt_glob";
    return exempt !== (answers[i] || answers[i + 1]);
  });
  assertEquals(differ, [], "heldBy and bash disagree");
});
