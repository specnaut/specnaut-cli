import { assertEquals } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";

/**
 * A shipped file must not tell a reader to open a path that exists only in
 * this repository.
 *
 * `backlog-reference-contract` pointed at `skills/backlog/scripts/<backend>/
 * _config.sh` — where that file lives in the bundle source. Installed, it is
 * `.specnaut/scripts/backlog/_config.sh`, flat, with no `<backend>` segment,
 * and identical under all seven harnesses. Three separate errors in one line.
 *
 * The class matters more than the instance: a doc written and verified inside
 * this checkout, where the path resolves, then shipped where it does not. It
 * is invisible to anyone testing from a checkout, and it fails *quietly* — an
 * agent that cannot find `_config.sh` does not error, it assembles the URL by
 * hand, which is the exact thing the contract exists to prevent.
 *
 * Filed as specnaut-cli#541, which named two instances. This scan found eight.
 */

/** Prefixes that resolve here and nowhere a user installs. */
const SOURCE_TREE_MARKERS = [
  "templates/core/",
  "templates/harness-specific/",
  "templates/manifest.json",
  "plugin/skills/",
  "plugin/agents/",
  "src/templates_bundle.ts",
  "src/main.ts",
  "skills/board/scripts/",
  "skills/backlog/scripts/",
  ".claude/skills/test-sandbox",
  "deno task bundle",
];

/**
 * Files allowed to name the source tree, each with the reason it is not the
 * defect above. The bar: the reader being addressed is standing in this
 * repository, and the text says so.
 */
const ADDRESSES_THIS_REPO: Record<string, string> = {
  // #562 moved the vendored snapshot out of the seat and into a preloaded
  // skill. The excuse moved with the text, not with the file name — an
  // allowlist keyed on a location goes stale the moment the content relocates,
  // and a stale entry excuses nothing while looking like it does.
  "skill/specnaut-facts":
    "answers questions ABOUT Specnaut's own architecture; naming the layout is the answer",
};

type Entry = { category: string; name: string; content: unknown };

/**
 * Core AND harness-specific — 265 entries plus 17. Scanning only the core
 * half would report a clean surface while never reading the other one, which
 * is the same shape of failure this file exists to catch.
 */
const ENTRIES: Entry[] = [
  ...(CORE_BUNDLE as ReadonlyArray<Entry>).filter((e) => typeof e.content === "string"),
  ...Object.entries(HARNESS_STATIC).flatMap(([harness, files]) =>
    Object.entries(files)
      .filter(([, f]) => typeof f?.content === "string")
      .map(([dest, f]) => ({
        category: `harness:${harness}`,
        name: dest,
        content: f.content as unknown,
      }))
  ),
];

function offendersOf(markers: readonly string[]): string[] {
  return [
    ...new Set(
      ENTRIES
        .filter((e) => markers.some((m) => (e.content as string).includes(m)))
        .map((e) => `${e.category}/${e.name}`),
    ),
  ].sort();
}

Deno.test("no shipped file cites a path that only exists in this checkout", () => {
  const offenders = offendersOf(SOURCE_TREE_MARKERS)
    .filter((key) => !(key in ADDRESSES_THIS_REPO));

  assertEquals(
    offenders,
    [],
    "these ship to projects where the path does not resolve — rewrite them " +
      "against the installed layout, or add a justified line to " +
      "ADDRESSES_THIS_REPO if the reader really is standing in this repo",
  );
});

Deno.test("the allow-list has no dead entries", () => {
  // A justification for something that no longer matches is a claim nobody
  // can check — the same discipline the backend-gating allow-list applies.
  const live = new Set(offendersOf(SOURCE_TREE_MARKERS));
  assertEquals(
    Object.keys(ADDRESSES_THIS_REPO).filter((k) => !live.has(k)),
    [],
    "these are excused but no longer name the source tree — drop them",
  );
});

Deno.test("the contract names the destination the code actually computes", () => {
  // The one path this whole file exists for. Pinned against the string the
  // harnesses build, so the doc cannot drift from `backlogScriptDestination`
  // again without a red test.
  const contract = ENTRIES.find((e) => e.name === "backlog-reference-contract");
  assertEquals(typeof contract?.content, "string", "the contract must ship");
  const text = contract!.content as string;
  assertEquals(
    text.includes(".specnaut/scripts/backlog/_config.sh"),
    true,
    "the contract must name the installed path",
  );
  assertEquals(
    text.includes("<backend>"),
    false,
    "the per-backend segment does not survive installation — only the " +
      "selected backend's scripts are emitted, and they are emitted flat",
  );
});
