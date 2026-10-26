import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";

/**
 * REACH, not shape (#575, FR-020…FR-024).
 *
 * Every other assertion about this contract asks whether the templates have the
 * right shape. None of them can fail when the contract reaches no turn.
 *
 * The two holes this file is built to avoid were both observed on the #576
 * equivalent and are pinned here rather than rediscovered: asserting the routes
 * with an OR (so one route satisfies every harness and the other decides
 * nothing), and asserting that a pointer EXISTS while never asserting the
 * pointed-at file is delivered — a project told to read something it never
 * received. Each route is asserted alone; delivery is asserted apart from
 * reference. No harness is exempt.
 */

const CONTRACT = "response-style-contract";
const LABEL = "response-style";

/**
 * A sentence from the contract BODY, not its frontmatter. `copilot_harness`
 * rebuilds frontmatter into `applyTo: "**"` and `codex`/`opencode` rewrite it
 * from other fields, so a probe keyed on `name:` reports three harnesses as not
 * delivering a file they do deliver. The body survives every adapter.
 */
const BODY_MARKER = "A badge describes the state at the time of reading";

const OPTS = {
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  specAutogen: false,
} as const;

/** The always-on destinations, from `alwaysOn` in the manifest — not a hand list. */
async function alwaysOnDestinations(): Promise<Map<string, string[]>> {
  const raw = await Deno.readTextFile(
    fromFileUrl(new URL("../../templates/manifest.json", import.meta.url)),
  );
  const m = JSON.parse(raw) as {
    harness_static: Array<{ harness: string; destination: string; alwaysOn?: boolean }>;
  };
  const out = new Map<string, string[]>();
  for (const e of m.harness_static) {
    if (!e.alwaysOn) continue;
    out.set(e.harness, [...(out.get(e.harness) ?? []), e.destination]);
  }
  return out;
}

Deno.test("the contract is actually DELIVERED by every harness, not merely referenced", () => {
  for (const harness of HARNESSES) {
    const bundle = harness.mapBundle(CORE_BUNDLE, OPTS);
    const delivered = Object.entries(bundle).some(([dest, file]) =>
      dest.includes(CONTRACT) && file.content.includes(BODY_MARKER)
    );
    assert(delivered, `${harness.key} references the contract but never writes it`);
  }
});

Deno.test("every always-on context file carries the pointer", async () => {
  // The route the three harnesses that HAVE a context file take. Asserted alone
  // so the AGENTS.md fence cannot stand in for it.
  const alwaysOn = await alwaysOnDestinations();

  // Membership, not cardinality: an oracle that derives its expectation from the
  // very field an edit touches goes green when a harness's flag is dropped
  // together with its pointer. The set is INVERTED instead — a harness whose
  // HARNESS_STATIC ships a context file of its own must be flagged, or written
  // down as an exception. Giving copilot a context file tomorrow turns this red.
  const shouldBeFlagged = new Set<string>();
  for (const [harnessKey, files] of Object.entries(HARNESS_STATIC)) {
    for (const dest of Object.keys(files)) {
      if (/\.(md|mdc)$/.test(dest) && !dest.includes("/hooks/")) shouldBeFlagged.add(harnessKey);
    }
  }
  /** A harness shipping a context file that is deliberately NOT always-on. Empty
   * today; a row here is a decision on the record, never a way to quiet a red. */
  const NOT_ALWAYS_ON = new Map<string, string>();

  const unflagged = [...shouldBeFlagged]
    .filter((h) => !alwaysOn.has(h))
    .filter((h) => !NOT_ALWAYS_ON.get(h)?.trim());
  assertEquals(
    unflagged,
    [],
    "harnesses shipping a context file that is not declared alwaysOn — the reach oracle cannot see them",
  );
  assert(alwaysOn.size > 0, "no alwaysOn entries at all — the flag is gone, not clean");

  const missing: string[] = [];
  for (const [harnessKey, dests] of alwaysOn) {
    const statics = HARNESS_STATIC[harnessKey] ?? {};
    for (const dest of dests) {
      const file = statics[dest];
      if (!file) missing.push(`${harnessKey}:${dest} (not in HARNESS_STATIC)`);
      else if (!file.content.includes(CONTRACT)) missing.push(`${harnessKey}:${dest}`);
    }
  }
  assertEquals(missing, [], "always-on surfaces with no pointer");
});

Deno.test("the response-style fence carries the pointer, for every harness", () => {
  // The only route on the four harnesses with no context file of their own — and
  // the only route that reaches EXISTING projects, since managed sections are
  // grafted independently of skipIfExists.
  const missing: string[] = [];
  for (const harness of HARNESSES) {
    const agents = harness.mapBundle(CORE_BUNDLE, OPTS)["AGENTS.md"];
    if (!agents) {
      missing.push(`${harness.key}: no AGENTS.md at all`);
      continue;
    }
    // The FENCED body, not the file: a pointer outside the fence reaches new
    // projects only, which is the hole this feature exists to close.
    const fenced = extractBlock(agents.content, LABEL, "html");
    if (!fenced || !fenced.includes(CONTRACT)) missing.push(`${harness.key}:AGENTS.md#${LABEL}`);
  }
  assertEquals(missing, [], "harnesses whose response-style fence does not carry the pointer");
});

Deno.test("the fence is declared on the entry that ships it, so upgrade grafts it", () => {
  // Reference and delivery are not enough: `managedSectionEntries` grafts only
  // labels the entry DECLARES. A fence present in the content but undeclared
  // reaches new projects and no existing one — silently.
  const root = CORE_BUNDLE.find((e) => e.category === "project-root" && e.suffix === "AGENTS.md");
  assert(root, "no project-root AGENTS.md entry");
  const declared = typeof root!.managedSection === "string"
    ? [root!.managedSection]
    : [...(root!.managedSection ?? [])];
  assert(
    declared.includes(LABEL),
    `AGENTS.md carries the ${LABEL} fence but does not declare it: ${JSON.stringify(declared)}`,
  );
});
