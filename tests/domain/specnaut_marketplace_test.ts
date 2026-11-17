import { assertEquals, assertThrows } from "@std/assert";
import {
  classifyDeclaration,
  describeSource,
  specnautMarketplaceRef,
  specnautMarketplaceSource,
} from "../../src/domain/specnaut_marketplace.ts";

// cli#783: Claude Code does not refresh a `github` marketplace source carrying
// `path`, so Specnaut declares its catalog by URL, the tag in the URL's path.
// What counts as Specnaut's own is matched exactly: anything a looser rule
// caught would be a user's choice overwritten by an upgrade.

const PATH = "packaging/marketplace/.claude-plugin/marketplace.json";
const RAW = "https://raw.githubusercontent.com/specnaut/specnaut-cli";
const LEGACY = { source: "github", repo: "specnaut/specnaut-cli", ref: "v9.4.0", path: PATH };

Deno.test("specnautMarketplaceSource: this repository's catalog, by URL, at the tag", () => {
  assertEquals(specnautMarketplaceSource("v9.5.0"), {
    source: "url",
    url: `${RAW}/v9.5.0/${PATH}`,
  });
  assertEquals(specnautMarketplaceRef(specnautMarketplaceSource("v9.5.0")), "v9.5.0");
  assertThrows(() => specnautMarketplaceSource("v1/../main"));
  assertThrows(() => specnautMarketplaceSource(".."));
});

Deno.test("classifyDeclaration: absent, current at any tag, legacy at any ref", () => {
  assertEquals(classifyDeclaration(undefined), "absent");
  assertEquals(classifyDeclaration({ source: specnautMarketplaceSource("v0.0.1") }), "current");
  assertEquals(classifyDeclaration({ source: LEGACY }), "legacy");
  const { ref: _ref, ...unpinned } = LEGACY;
  assertEquals(classifyDeclaration({ source: unpinned }), "legacy");
});

const url = (u: string) => ({ source: { source: "url", url: u } });
const FOREIGN = [
  {},
  null,
  { source: null },
  { source: "github" },
  url(`${RAW.replace("specnaut/", "my-fork/")}/v9.4.0/${PATH}`),
  url(`https://raw.githubusercontent.com.evil.example/specnaut/specnaut-cli/v9.4.0/${PATH}`),
  url(`https://mirror.example/specnaut/specnaut-cli/v9.4.0/${PATH}`),
  url(`http://raw.githubusercontent.com/specnaut/specnaut-cli/v9.4.0/${PATH}`),
  url(`${RAW}/v9.4.0/${PATH}?token=x`),
  url(`${RAW}/v9.4.0/${PATH}#x`),
  url(`https://user@raw.githubusercontent.com/specnaut/specnaut-cli/v9.4.0/${PATH}`),
  url(`https://raw.githubusercontent.com:8443/specnaut/specnaut-cli/v9.4.0/${PATH}`),
  url(`${RAW}/v9.4.0/packaging/marketplace/.github/plugin/marketplace.json`),
  url(`${RAW}/v9.4.0/${PATH}/extra`),
  url("not a url"),
  { source: { ...specnautMarketplaceSource("v9.4.0"), headers: { a: "b" } } },
  { source: { ...LEGACY, repo: "my-fork/specnaut-cli" } },
  { source: { ...LEGACY, path: ".claude-plugin/marketplace.json" } },
  { source: { ...LEGACY, sparsePaths: ["x"] } },
  { source: { source: "github", repo: "specnaut/specnaut-marketplace" } },
];

Deno.test("classifyDeclaration: everything else is the user's own", () => {
  for (const entry of FOREIGN) {
    assertEquals(classifyDeclaration(entry), "foreign", JSON.stringify(entry));
  }
});

Deno.test("classifyDeclaration: a URL is compared after parsing, so dot segments cannot smuggle a fork in", () => {
  const dotted =
    `https://raw.githubusercontent.com/my-fork/../specnaut/specnaut-cli/v9.4.0/${PATH}`;
  assertEquals(classifyDeclaration({ source: { source: "url", url: dotted } }), "current");
  const escaped =
    `https://raw.githubusercontent.com/specnaut/x/../../my-fork/specnaut-cli/v9.4.0/${PATH}`;
  assertEquals(classifyDeclaration({ source: { source: "url", url: escaped } }), "foreign");
});

Deno.test("describeSource: Specnaut's source by repository and tag, any other by repo or URL", () => {
  assertEquals(describeSource(specnautMarketplaceSource("v9.5.0")), "specnaut/specnaut-cli@v9.5.0");
  assertEquals(describeSource({ source: "github", repo: "o/r" }), "o/r");
  assertEquals(
    describeSource({ source: "url", url: "https://x.example/m.json" }),
    "https://x.example/m.json",
  );
  assertEquals(describeSource(undefined), "a custom source");
  assertEquals(describeSource({ source: "github", repo: 42 }), "a custom source");
});
