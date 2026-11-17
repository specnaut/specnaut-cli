import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { specnautMarketplaceSource } from "../../src/domain/specnaut_marketplace.ts";
import {
  catalogRefProblems,
  declarationRefProblems,
  opencodePinProblems,
  stampCatalogRefs,
  stampDeclarationRef,
  stampOpencodePin,
} from "../../scripts/catalog-refs.ts";

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

const settings = (source?: object) =>
  JSON.stringify(source ? { extraKnownMarketplaces: { "specnaut-marketplace": { source } } } : {});

Deno.test("the scaffolded marketplace declaration is stamped and checked like a catalog", () => {
  const stamped = stampDeclarationRef(settings(specnautMarketplaceSource("v1.0.0")), "v2.0.0");
  assertEquals(
    JSON.parse(stamped).extraKnownMarketplaces["specnaut-marketplace"].source,
    specnautMarketplaceSource("v2.0.0"),
  );
  assertEquals(declarationRefProblems(stamped, "v2.0.0"), []);
  assertEquals(declarationRefProblems(settings(specnautMarketplaceSource("v1.0.0")), "v2.0.0"), [
    'specnaut-marketplace is pinned to "v1.0.0", not v2.0.0',
  ]);
  assertEquals(declarationRefProblems(settings(), "v2.0.0"), [
    "declares no specnaut-marketplace marketplace",
  ]);
});

// cli#783: the tag lives in the URL. A gate that read a `ref` field would pass
// a declaration Claude Code serves from the previous release.
Deno.test("a leftover ref field makes the declaration not Specnaut's, whatever it says", () => {
  const stale = { ...specnautMarketplaceSource("v1.0.0"), ref: "v2.0.0" };
  const [problem] = declarationRefProblems(settings(stale), "v2.0.0");
  assertStringIncludes(problem, "is not Specnaut's url source");
});

Deno.test("the declaration check refuses the github source Claude Code cannot refresh (cli#783)", () => {
  const legacy = {
    source: "github",
    repo: "specnaut/specnaut-cli",
    ref: "v2.0.0",
    path: "packaging/marketplace/.claude-plugin/marketplace.json",
  };
  const [problem] = declarationRefProblems(settings(legacy), "v2.0.0");
  assertStringIncludes(problem, "is not Specnaut's url source");
  // And the stamp never rewrites a shape it does not own into one it does.
  assertEquals(
    JSON.parse(stampDeclarationRef(settings(legacy), "v3.0.0"))
      .extraKnownMarketplaces["specnaut-marketplace"].source,
    legacy,
  );
});

// ── The README's OpenCode install line (cli#667) ────────────────────────────

const line = (spec: string) => `Add to \`opencode.json\`: \`"plugin": ["${spec}"]\`\n`;
const SPEC = "specnaut@git+https://github.com/specnaut/specnaut-cli.git";

Deno.test("stampOpencodePin pins an unpinned line and re-pins a pinned one", () => {
  assertEquals(stampOpencodePin(line(SPEC), "v2.0.0"), line(`${SPEC}#v2.0.0`));
  assertEquals(stampOpencodePin(line(`${SPEC}#v1.9.0`), "v2.0.0"), line(`${SPEC}#v2.0.0`));
  // Every occurrence, not the first.
  assertEquals(
    stampOpencodePin(line(SPEC) + line(`${SPEC}#main`), "v2.0.0"),
    line(`${SPEC}#v2.0.0`) + line(`${SPEC}#v2.0.0`),
  );
});

Deno.test("opencodePinProblems names a missing, unpinned or stale line", () => {
  assertEquals(opencodePinProblems(line(`${SPEC}#v2.0.0`), "v2.0.0"), []);
  assertEquals(opencodePinProblems("no install line here\n", "v2.0.0"), [
    "documents no OpenCode install line",
  ]);
  assertEquals(opencodePinProblems(line(SPEC), "v2.0.0"), [
    "the OpenCode install line has no ref — it would install the default branch",
  ]);
  assertEquals(opencodePinProblems(line(`${SPEC}#v1.9.0`), "v2.0.0"), [
    "the OpenCode install line is pinned to v1.9.0, not v2.0.0",
  ]);
});

Deno.test("the OpenCode ref is a tag's characters only — punctuation after it survives a stamp", () => {
  const prose = (ref: string) => `(see \`${SPEC}${ref}\`), and ${SPEC}${ref}', next\n`;
  assertEquals(stampOpencodePin(prose("#v1.9.0"), "v2.0.0"), prose("#v2.0.0"));
  assertEquals(opencodePinProblems(prose("#v2.0.0"), "v2.0.0"), []);
});
