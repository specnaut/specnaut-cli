import { assert, assertEquals } from "@std/assert";
import { catalogRefProblems, stampCatalogRefs } from "../../scripts/catalog-refs.ts";

/**
 * The one definition of "a catalog is pinned to this release", used by the
 * bump, the pre-tag gate and release.yml. Its predecessor was a regex on
 * `"ref": "v…"`, which could neither stamp nor see an entry with no ref or a
 * branch ref — the gate that caught it ran only after the tag was pushed.
 */

const catalog = (...sources: unknown[]) =>
  JSON.stringify({ name: "m", plugins: sources.map((source, i) => ({ name: `p${i}`, source })) });

Deno.test("stamp pins every entry, including one with no ref or a branch ref", () => {
  const out = JSON.parse(
    stampCatalogRefs(
      catalog({ source: "git-subdir", ref: "v1.0.0" }, { source: "github" }, {
        source: "github",
        ref: "main",
      }),
      "v2.0.0",
    ),
  );
  assertEquals(out.plugins.map((p: { source: { ref: string } }) => p.source.ref), [
    "v2.0.0",
    "v2.0.0",
    "v2.0.0",
  ]);
});

Deno.test("a catalog with every entry on the tag has no problems", () => {
  assertEquals(catalogRefProblems(catalog({ ref: "v2.0.0" }, { ref: "v2.0.0" }), "v2.0.0"), []);
});

Deno.test("each way an entry escapes the pin is named", () => {
  const problems = catalogRefProblems(
    catalog({ ref: "v2.0.0" }, { ref: "v1.9.0" }, {}, { ref: "main" }, "./local"),
    "v2.0.0",
  );
  assertEquals(problems, [
    'p1 is pinned to "v1.9.0", not v2.0.0',
    "p2 has no ref — it would install the default branch",
    'p3 is pinned to "main", not v2.0.0',
    "p4 has no source object, so nothing pins it",
  ]);
});

Deno.test("no plugins, or not JSON, is a problem rather than a pass", () => {
  assertEquals(catalogRefProblems('{"plugins": []}', "v1.0.0"), ["lists no plugins"]);
  assert(catalogRefProblems("{", "v1.0.0")[0].startsWith("not valid JSON"));
});

Deno.test("--check over the repository's catalogs agrees with deno.json", async () => {
  const version = JSON.parse(await Deno.readTextFile("deno.json")).version;
  const run = (tag: string) =>
    new Deno.Command("deno", {
      args: ["run", "--allow-read", "scripts/catalog-refs.ts", "--check", tag],
      stdout: "piped",
      stderr: "piped",
    }).output();
  assertEquals((await run(`v${version}`)).code, 0);
  assertEquals((await run("v0.0.1")).code, 1);
  assertEquals((await run("latest")).code, 2);
});
