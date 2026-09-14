import { assert, assertEquals } from "@std/assert";
import { PLUGIN_COVERED_PATHS_CLAUDE } from "../../src/domain/plugin_coverage.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreCategory, CoreEntry } from "../../src/domain/core_bundle.ts";
import { ClaudeHarness } from "../../src/infrastructure/harness/claude_harness.ts";
import { isSkillDoc } from "../../src/infrastructure/harness/skill_folder.ts";

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
 * stale names were the symptom.
 *
 * ## Why this file composes no paths at all
 *
 * An earlier version compared document *names* against
 * `coveredNames(".claude/skills/specnaut/phases/")` — a prefix hardcoded to one
 * owner. That was 1:1 with destinations only while every sub-document belonged
 * to `specnaut`. With a second owner it breaks, and **the obvious repair
 * re-creates #455**: adding `.claude/skills/specnaut/phases/<other-doc>.md` to
 * the list greens the test and puts a path in it that is never scaffolded,
 * which is precisely the "missing — restore via upgrade" state described above.
 *
 * So nothing here spells a path. The adapter is asked what it emits, and every
 * claim is membership in that map.
 *
 * ## The breadth knob
 *
 * `claimedOwners.size` is pinned. Whether the list SHOULD cover more skills —
 * it names one while `plugin/skills/` ships far more — is deliberately not
 * decided here; it is
 * [#605](https://github.com/specnaut/specnaut-cli/issues/605). Pinning the
 * count means neither widening nor narrowing can happen as a side effect: it
 * takes a deliberate edit to an integer, with a reason beside it.
 */

const harness = new ClaudeHarness();
const OPTS = { backlogBackend: "local", versionScheme: "semver", specBackend: "local" } as const;

/** Destinations the harness emits regardless of the bundle — not ours to claim. */
const STATIC = new Set(Object.keys(harness.mapBundle([], OPTS)));

function destOf(e: CoreEntry): string | null {
  const own = Object.keys(harness.mapBundle([e], OPTS)).filter((d) => !STATIC.has(d));
  if (own.length > 1) {
    throw new Error(`entry ${e.name}/${e.suffix} maps to ${own.length} destinations`);
  }
  return own[0] ?? null;
}

/** Every destination the Claude adapter really emits, mapped back to its entry. */
const SCAFFOLDED = new Map<string, CoreEntry>(
  CORE_BUNDLE.flatMap((e) => {
    const d = destOf(e);
    return d === null ? [] : [[d, e] as const];
  }),
);

/** The skill an entry belongs to, or null for entries no skill owns. */
function ownerOf(e: CoreEntry): string | null {
  return isSkillDoc(e.category) || e.category === "skill" || e.category === "backlog-skill"
    ? e.name
    : null;
}

const covered = new Set(PLUGIN_COVERED_PATHS_CLAUDE);
const claimedEntries = PLUGIN_COVERED_PATHS_CLAUDE
  .map((p) => SCAFFOLDED.get(p))
  .filter((e): e is CoreEntry => e !== undefined);
const claimedOwners = new Set(
  claimedEntries.map(ownerOf).filter((o): o is string => o !== null),
);

Deno.test("the derivation reconstructs the whole bundle mapping", () => {
  // Non-vacuity, and it is not a tautology: the left side is built one entry at
  // a time, the right is one call over the whole bundle. They agree only if the
  // per-entry derivation is faithful — and if it silently returned nothing,
  // this is what says so.
  const whole = Object.keys(harness.mapBundle(CORE_BUNDLE, OPTS)).length - STATIC.size;
  assertEquals(SCAFFOLDED.size, whole);
  assert(SCAFFOLDED.size > 0, "the adapter emitted nothing at all");
});

Deno.test("every covered path is one the binary actually scaffolds", () => {
  const phantom = PLUGIN_COVERED_PATHS_CLAUDE.filter((p) => !SCAFFOLDED.has(p));
  assertEquals(
    phantom,
    [],
    "these covered paths are not emitted by the Claude adapter, so `specnaut " +
      "check --project` will report them missing with advice that cannot work",
  );
});

Deno.test("claiming a skill claims all of it — no silent partial coverage", () => {
  const missing: string[] = [];
  for (const [dest, e] of SCAFFOLDED) {
    const owner = ownerOf(e);
    if (owner === null || !claimedOwners.has(owner)) continue;
    if (!covered.has(dest)) missing.push(dest);
  }
  assertEquals(
    missing,
    [],
    "the coverage list claims these skills but not all of their files — a " +
      "partially covered skill is the #455 shape with fewer paths",
  );
});

Deno.test("coverage breadth is a pinned, deliberate number", () => {
  // Two owners: `specnaut` and `ship` (spec 033). Widening further is the
  // subject of #605 and must
  // be an explicit edit here with a reason, never a side effect of adding a
  // path to the list.
  assertEquals(
    [...claimedOwners].sort(),
    ["ship", "specnaut"],
    "plugin coverage changed which skills it claims — see #605 before changing this",
  );
});

Deno.test("every agent the bundle ships is covered, and nothing else is", () => {
  const bundled = [...SCAFFOLDED]
    .filter(([, e]) => e.category === "agent" satisfies CoreCategory)
    .map(([d]) => d)
    .sort();
  const claimed = PLUGIN_COVERED_PATHS_CLAUDE
    .filter((p) => SCAFFOLDED.get(p)?.category === "agent")
    .sort();
  assertEquals(claimed, bundled, "coverage list and bundled agents disagree");
});
