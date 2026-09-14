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

/**
 * #605's ruling, as an assertion.
 *
 * This replaces a pinned owner list (`["ship", "specnaut"]`) that existed to
 * stop coverage drifting while the question was open. The question is settled:
 * every skill destination the Claude adapter emits is plugin-covered, because
 * all of them satisfy the membership criterion in `plugin_coverage.ts`.
 *
 * **Written after the ruling, deliberately.** Written before it, an assertion
 * over this dimension could only have pinned the then-current one-skill value,
 * which would have cemented the defect as the specification by construction —
 * the ticket says so in as many words.
 *
 * It asserts the criterion, not a count: no number appears here, so a new skill
 * joining the bundle takes this red until it is covered, rather than silently
 * widening the gap the way the previous twenty-eight did.
 */
Deno.test("every skill destination the bundle ships is covered, and nothing else is", () => {
  const bundled = [...SCAFFOLDED]
    .filter(([d]) => d.startsWith(".claude/skills/"))
    .map(([d]) => d)
    .sort();
  const claimed = PLUGIN_COVERED_PATHS_CLAUDE
    .filter((p) => p.startsWith(".claude/skills/"))
    .sort();
  assertEquals(
    claimed,
    bundled,
    "the coverage list and the skills the binary scaffolds disagree — a skill " +
      "the plugin serves but the list omits is invisible to `check --project`, " +
      "and one the list names but the bundle dropped is the #455 shape: a " +
      "permanent warning whose advice cannot be followed",
  );
  assert(bundled.length > 0, "the adapter emitted no skill destinations at all");
});

Deno.test("the categories behind those destinations are all three, not just phases", () => {
  // Non-vacuity with teeth. The assertion above compares paths, so it would
  // still pass if an entire CATEGORY stopped being emitted — both sides would
  // shrink together. This names the categories that must be present, which is
  // the dimension #605 found unguarded: `phase` and `agent` had parity
  // assertions, `skill` / `backlog-skill` / `backlog-doc` had none, and the
  // one-skill entry was the part nothing compared to anything.
  const covered = new Set(PLUGIN_COVERED_PATHS_CLAUDE);
  const seen = new Set<CoreCategory>();
  for (const [dest, e] of SCAFFOLDED) {
    if (covered.has(dest)) seen.add(e.category);
  }
  for (const c of ["skill", "backlog-skill", "backlog-doc", "phase", "agent"] as CoreCategory[]) {
    assert(seen.has(c), `no covered destination has category "${c}" — the sweep went blind to it`);
  }
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
