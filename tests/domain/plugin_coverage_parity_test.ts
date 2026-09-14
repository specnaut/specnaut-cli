import { assertEquals } from "@std/assert";
import { PLUGIN_COVERED_PATHS_CLAUDE } from "../../src/domain/plugin_coverage.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * The coverage list must equal what actually ships.
 *
 * `PLUGIN_COVERED_PATHS_CLAUDE` is hand-written, and so is `SYNC_PAIRS` in the
 * plugin sync test, and so is `templates/manifest.json`. Three mirrors of one
 * fact. #455 removed six phases and added two; the manifest and SYNC_PAIRS were
 * updated and this one was not, for two releases.
 *
 * The cost landed on users rather than on CI: `specnaut check --project` reads
 * this list, so every correctly-migrated project reported six files "missing —
 * restore via `specnaut upgrade` or install the plugin". Neither remedy works —
 * `upgrade` is precisely what removes them — so it was a permanent warning
 * state, and the one diagnostic a user runs to confirm the migration worked
 * told them it had not.
 *
 * Nothing compared any mirror to the bundle. That is the actual defect; the
 * stale names were the symptom. These two assertions are the comparison.
 */

function coveredNames(prefix: string): string[] {
  return PLUGIN_COVERED_PATHS_CLAUDE
    .filter((p) => p.startsWith(prefix) && p.endsWith(".md"))
    .map((p) => p.slice(prefix.length, -".md".length))
    .filter((n) => !n.includes("/"))
    .sort();
}

/**
 * The bundle's identity for a category, as it appears in a destination.
 *
 * For most categories that is `name`. For the two **sub-document** categories
 * — `phase` and `backlog-doc` — `name` is the OWNING SKILL and the document is
 * in `suffix` (spec 033; see `CoreEntry`). Reading `name` there would return
 * the owner twenty-one times over and compare it against twenty-one distinct
 * filenames, which is a false red rather than a real disagreement.
 *
 * This function is deliberately not "the destination": composing one here
 * would re-state the adapter's rule, which is exactly the duplication spec 033
 * §5 forbids. It compares identities, and the prefix the caller passes is what
 * ties them to a location.
 */
function bundleNames(category: string): string[] {
  const isSubDoc = category === "phase" || category === "backlog-doc";
  return CORE_BUNDLE
    .filter((e) => e.category === category)
    .map((e) => isSubDoc ? skillDocName(e) : e.name)
    .sort();
}

Deno.test("every phase the bundle ships is covered, and nothing else is", () => {
  assertEquals(
    coveredNames(".claude/skills/specnaut/phases/"),
    bundleNames("phase"),
    "coverage list and bundled phases disagree — `specnaut check` will report " +
      "files as missing that were deliberately removed, or miss files that ship",
  );
});

Deno.test("every agent the bundle ships is covered, and nothing else is", () => {
  assertEquals(
    coveredNames(".claude/agents/"),
    bundleNames("agent"),
    "coverage list and bundled agents disagree",
  );
});
