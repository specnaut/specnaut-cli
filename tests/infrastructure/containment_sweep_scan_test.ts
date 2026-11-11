import { assert, assertEquals, assertGreaterOrEqual } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  mutatingModules,
  MUTATOR_CALLS,
  parseSinks,
  readExclusions,
  unguardedSinks,
} from "./containment_sweep_scan.ts";

/**
 * The containment sweep's scanner, tested on its own (cli#766): which function
 * owns each mutating call, whether a guard stands in front of it, and the
 * exclusion parser. `containment_sweep_test.ts` holds the sweep over `src/`.
 */

Deno.test("unguardedSinks: an entry check guards a removal or a rename, never a write", () => {
  const f = (s: string) => unguardedSinks(`function f() { assertRemovableInProject(); ${s}(); }`);
  assertEquals([f("Deno.remove"), f("Deno.rename"), f("Deno.writeTextFile")], [[], [], ["f"]]);
});

Deno.test("unguardedSinks: a sink is charged to the method it sits in, modifiers and all", () => {
  // A `private async` method the attribution cannot see hands its sinks
  // to whatever function precedes it — a false alarm on the wrong name at best,
  // and a sink excused under its neighbour's exclusion at worst.
  const src = [
    "class C {",
    "  async guarded(p: string) {",
    "    await assertInsideProject(root, p);",
    "  }",
    "  private async write(p: string) {",
    "    await Deno.writeTextFile(p, 'x');",
    "  }",
    "  static remove(p: string) {",
    "    Deno.remove(p);",
    "  }",
    "}",
  ].join("\n");
  assertEquals(unguardedSinks(src).sort(), ["remove", "write"]);
});

Deno.test("unguardedSinks: a multi-line signature with a function-typed parameter owns its sinks", () => {
  // cli#766: a signature pattern stopping at the first `)` never saw this one,
  // so its sink was charged to the guarded method before it and never judged.
  const src = [
    "class C {",
    "  async guarded(p: string) {",
    "    await assertRemovableInProject(root, p);",
    "  }",
    "  async deletePaths(",
    "    paths: string[],",
    "    options: { within?: (rel: string) => boolean },",
    "  ): Promise<void> {",
    "    await Deno.remove(paths[0]);",
    "  }",
    "}",
  ].join("\n");
  assertEquals(unguardedSinks(src), ["deletePaths"]);
});

Deno.test("unguardedSinks: an owner is a named declaration; a callback belongs to its encloser", () => {
  const owners = (src: string) => unguardedSinks(src).sort();
  assertEquals(owners("const put = async (p: string) => { await Deno.mkdir(p); };"), ["put"]);
  assertEquals(owners("class C { field = (p: string) => Deno.mkdir(p); }"), ["field"]);
  // An object-literal member is part of the function that builds the object:
  // the exclusions for `defaultDeps` and `runInit` are written about that function.
  assertEquals(owners("function make() { return { w: (p: string) => Deno.mkdir(p) }; }"), ["make"]);
  assertEquals(owners("function f() {\n  function g() {}\n  Deno.mkdir('x');\n}"), ["f"]);
  // The innermost owner, judged from its own start: a guard in the outer
  // function does not cover a nested one, which may run later on any path.
  assertEquals(
    owners(
      "function f() {\n  assertInsideProject();\n  function g(p: string) { Deno.mkdir(p); }\n}",
    ),
    ["g"],
  );
});

Deno.test("parseSinks: deletePaths' Deno.remove is attributed to deletePaths", async () => {
  const path = fromFileUrl(new URL("../../src/infrastructure/deno_fs_writer.ts", import.meta.url));
  const src = await Deno.readTextFile(path);
  const at = src.indexOf("Deno.remove(", src.indexOf("async deletePaths("));
  const owner = parseSinks(src).sinks.find((s) => s.at === at)?.owner;
  assertEquals(owner, "deletePaths");
});

Deno.test("parseSinks: the parse finds every mutating call the text shows, across src/", async () => {
  // The population is still found by text (`mutatingModules`); the attribution
  // is the parse. They must agree on every call, or a sink is judged by neither.
  let total = 0;
  for (const rel of await mutatingModules()) {
    const src = await Deno.readTextFile(fromFileUrl(new URL(`../../${rel}`, import.meta.url)));
    const { sinks, comments } = parseSinks(src);
    const inComment = (at: number) => comments.some(([s, e]) => s <= at && at < e);
    const textual = [...src.matchAll(MUTATOR_CALLS)].map((m) => m.index).filter((at) =>
      !inComment(at)
    );
    assertEquals(sinks.map((s) => s.at), textual, `${rel}: the parse and the text disagree`);
    total += sinks.length;
  }
  assertGreaterOrEqual(total, 36, `the parse found ${total} sinks; 36 when this was written`);
});

Deno.test("readExclusions ignores comments and blank lines", () => {
  // A positive control for the parser. Every assertion above is downstream of
  // it, so a parser that returned nothing would make all three vacuously true.
  const parsed = readExclusions("# a comment\n\n  \nsrc/x.ts  because reasons\n");
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].path, "src/x.ts");
  assert(parsed[0].reason.includes("because reasons"));
});
