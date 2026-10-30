import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { FE_VOCAB, flat } from "./mobile_first_vocab.ts";

/**
 * The mobile-first contract reaches skills too, not only agents (#678).
 *
 * The agent sweep in `mobile_first_contract_test.ts` reads `skills:` frontmatter,
 * which a skill does not have — so when `ui-ux-designer` became the `/design`
 * skill, the one surface that owns `DESIGN.md` would have left the guarded
 * population in silence. A skill points at a contract the way every other skill
 * does: a sentence naming "the `<contract>` skill".
 */

const CONTRACT = "mobile-first-contract";
const POINTER = `\`${CONTRACT}\` skill`;

/** Top-level skill documents — what a user or a router loads by name. */
const skills = () =>
  CORE_BUNDLE.filter((e) =>
    (e.category === "skill" || e.category === "backlog-skill") && e.suffix === null &&
    e.name !== CONTRACT
  );

const candidates = () => skills().filter((e) => FE_VOCAB.test(e.content)).map((e) => e.name);

/**
 * Excluded on purpose, each with the reason. An empty reason is not an exclusion.
 * Empty today: `specnaut-facts` matched only on the `ux` in `ui-ux-designer`, and
 * left the population with that name — the stale-exclusion test below caught it.
 */
const EXCLUSIONS = new Map<string, string>();

Deno.test("every UI-touching skill points at the contract, or is excused with a reason", () => {
  const unwired = candidates()
    .filter((name) => !EXCLUSIONS.get(name)?.trim())
    .filter((name) => !skills().find((e) => e.name === name)!.content.includes(POINTER));
  assertEquals(unwired, [], "UI-touching skills with no pointer and no written exclusion");
});

Deno.test("the skill derivation reaches /design — it is not vacuous", () => {
  assert(candidates().includes("design"), `derived: ${candidates().join(", ")}`);
});

Deno.test("a skill exclusion names something that is actually a candidate", () => {
  const stale = [...EXCLUSIONS.keys()].filter((n) => !candidates().includes(n));
  assertEquals(stale, [], "an exclusion outliving its subject is how a carve-out becomes a fossil");
});

/** FR-009 (#576) — plan.md promises this assertion by name. Round 2: regressing the
 * `40px` literal across all three copies consistently left 1605 tests green,
 * because only the plugin byte-identity guard noticed, and a consistent edit
 * satisfies it. Assert the absence where it matters instead. Since #678 the
 * primitives live in the DESIGN.md template, and `/design` writes from it. */
Deno.test("no interactive primitive decides its own touch size", () => {
  const surfaces = CORE_BUNDLE.filter((e) =>
    (e.category === "skill" && e.name === "design") ||
    (e.category === "spec-root" && e.suffix === "templates/design-template.md")
  );
  assertEquals(surfaces.length, 2, "the /design skill or its DESIGN.md template is not bundled");
  // Flattened first. A line-based check requires the keyword and the literal to
  // land on the same line of a hard-wrapped file, so the same defect passes or
  // fails depending on where the wrap fell.
  const hits = surfaces.flatMap((e) =>
    [
      ...flat(e.content).matchAll(
        /(?:min[- ]height|min[- ]width|hit area|touch[a-z-]*)[^.]{0,60}?\b\d+\s*(?:px|rem|dp|pt)\b/gi,
      ),
    ].map((m) => m[0])
  );
  assertEquals(
    hits,
    [],
    "a literal size on a touch affordance is a second decider — the value lives in DESIGN.md tokens",
  );
});
