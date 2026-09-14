import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * Locks the offline accessibility catalogue into the bundle.
 *
 * Shape note, because it is deliberately a third one. Architecture is a
 * *lookup* — you know the name of the smell — so its catalogue is one leaf per
 * item and its gate is per shipped finding. Security routes by *symptom*, so
 * its domain files are chosen per scope. Accessibility is entered by
 * **surface** ("this diff touches a form") but exited by **criterion** ("this
 * is 3.3.2"). Grouping follows the entry key, and every failure mode inside a
 * leaf carries its criterion so the exit key still works. Do not harmonise it
 * with either sibling.
 *
 * The base ships as `spec-root` under `.specnaut/memory/a11y/` for the same
 * reason as the security base: `.specnaut/` is the one tree every harness
 * scaffolds at an identical path.
 */

const DIR = "memory/a11y/";

/** Every leaf, in the order the README's routing table presents them. */
const LEAVES: readonly string[] = [
  "01-images-and-text-alternatives.md",
  "02-structure-and-semantics.md",
  "03-forms-and-labels.md",
  "04-keyboard-and-focus.md",
  "05-aria-and-custom-widgets.md",
  "06-color-and-contrast.md",
  "07-text-zoom-and-reflow.md",
  "08-time-motion-and-media.md",
  "09-navigation-and-language.md",
  "10-dynamic-updates-and-status.md",
];

function entries(): CoreEntry[] {
  return CORE_BUNDLE.filter(
    (e) => e.category === "spec-root" && (e.suffix ?? "").startsWith(DIR),
  );
}

function entryFor(name: string): CoreEntry {
  const entry = entries().find((e) => e.suffix === `${DIR}${name}`);
  assert(entry, `a11y catalogue is missing ${name} — add it to templates/manifest.json`);
  return entry;
}

function agent(name: string): string {
  const e = CORE_BUNDLE.find((x) => x.category === "agent" && x.name === name);
  assert(e, `${name} agent is missing from the bundle`);
  return e.content;
}

Deno.test("catalogue ships a README, a triage gate, and every leaf", () => {
  entryFor("README.md");
  entryFor("00-triage.md");
  for (const name of LEAVES) entryFor(name);
  assertEquals(
    entries().length,
    LEAVES.length + 2,
    "unexpected extra or missing file under .specnaut/memory/a11y/ — " +
      "update LEAVES when the catalogue gains or loses a surface",
  );
});

Deno.test("catalogue ships as spec-root so all harnesses scaffold it", () => {
  for (const entry of entries()) {
    assertEquals(entry.category, "spec-root");
    for (const harness of HARNESSES) {
      const bundle = harness.mapBundle([entry], { backend: "local" } as never);
      assert(
        `.specnaut/${entry.suffix}` in bundle,
        `${harness.key} must scaffold ${entry.suffix} at the canonical .specnaut path`,
      );
    }
  }
});

Deno.test("catalogue files are refreshed on upgrade, not skipped", () => {
  // Upstream-maintained reference content: an upgrade has to deliver
  // corrections. The constitution is skipIfExists because users own it; this
  // is the opposite case.
  for (const entry of entries()) {
    assert(
      entry.skipIfExists !== true,
      `${entry.suffix} must not be skipIfExists — it would freeze at the ` +
        `version first scaffolded and never receive corrections`,
    );
  }
});

Deno.test("the README indexes every leaf it ships", () => {
  // The README is generated from the tree, so this holds by construction —
  // which is exactly why it is worth asserting: it catches a leaf added by
  // hand without regenerating.
  const readme = entryFor("README.md").content;
  for (const name of LEAVES) {
    assertStringIncludes(
      readme,
      name,
      `README must route to ${name}, otherwise an agent has no way to find it`,
    );
  }
  assertStringIncludes(readme, "00-triage.md");
});

/**
 * The section that kills a wrong finding.
 *
 * This seat needs it more than any other. Reviewing accessibility from source
 * produces a specific, repeatable family of wrong findings — decorative images
 * read as missing alternatives, redundant ARIA read as broken ARIA, contrast
 * ratios asserted through design tokens that were never resolved. Every one of
 * those looks like a defect in a diff.
 *
 * `00-triage.md` is excluded: it *is* the generic version of this gate, and a
 * per-file copy there is the duplication the section exists to avoid.
 */
Deno.test("every leaf carries the section that kills a wrong finding", () => {
  for (const name of LEAVES) {
    assertStringIncludes(
      entryFor(name).content,
      "## When it is NOT a finding",
      `${name} has no negative section — accessibility-expert is told to read one before each finding`,
    );
  }
  assert(
    !entryFor("00-triage.md").content.includes("## When it is NOT a finding"),
    "00-triage.md is the generic gate; a per-file copy of it there is the duplication this avoids",
  );
});

Deno.test("the three highest-cost false positives are covered by name", () => {
  // Required explicitly by the ticket, because these three are what make an
  // accessibility report untrustworthy: they are common, they look like
  // defects, and each one is actually correct code.
  const all = entries().map((e) => e.content).join("\n");
  const cases: Record<string, string> = {
    "decorative content": 'alt=""',
    "ARIA duplicating native semantics": "Redundant ARIA on a native element",
    "not computable from source": "cannot compute a ratio through a design token",
  };
  for (const [label, needle] of Object.entries(cases)) {
    assertStringIncludes(
      all,
      needle,
      `the catalogue must kill the "${label}" false positive explicitly`,
    );
  }
});

Deno.test("every leaf keys its failure modes to WCAG criteria", () => {
  // The catalogue is grouped by surface but a finding must cite a criterion.
  // A leaf with no criterion numbers cannot support the finding format.
  const criterion = /\b\d\.\d+\.\d+\b/;
  for (const name of LEAVES) {
    const body = entryFor(name).content;
    assertStringIncludes(body, "**WCAG 2.1**", `${name} must declare its criteria up front`);
    assert(
      criterion.test(body),
      `${name} names no numbered success criterion — findings from it cannot be cited`,
    );
  }
});

Deno.test("leaves stay small enough that a per-surface read is affordable", () => {
  // Routed per scope like the security base, not per finding like the
  // architecture leaves, so the bound is looser than 4KB — but a leaf that
  // grows past this stops being read and starts being skimmed.
  const MAX = 8192;
  for (const name of LEAVES) {
    const size = entryFor(name).content.length;
    assert(size <= MAX, `${name} is ${size} chars; keep leaves under ${MAX}`);
  }
});

Deno.test("the catalogue reproduces no W3C text and says so", () => {
  // WCAG 2.1 is published under the W3C Document License, which grants no
  // right to create derivative works for use as a technical specification.
  // The prose here is original and cites criteria by number and name; if that
  // ever stops being true, this assertion is the place it gets caught.
  const readme = entryFor("README.md").content;
  assertStringIncludes(readme, "https://www.w3.org/TR/WCAG21/");
  assertStringIncludes(readme, "W3C Document License");
  assertStringIncludes(readme, "No W3C text is reproduced here");
});

/**
 * Only the catalogue-dependent half of the grounding is asserted here. The two
 * mechanisms that need no catalogue — declare your sources, downgrade what you
 * cannot cite — are shared verbatim across three seats and are owned by
 * `expert_mechanisms_test.ts`. Asserting their wording in both places is how a
 * shared string acquires two guards that can disagree about it.
 */
Deno.test("accessibility-expert is gated on the catalogue and cites it", () => {
  const body = agent("accessibility-expert");
  assertStringIncludes(body, "## Step 0");
  assertStringIncludes(body, ".specnaut/memory/a11y/00-triage.md");
  assertStringIncludes(body, "## When it is NOT a finding");
  assertStringIncludes(body, "shipped");
  // The seat-specific citation rule: a criterion is cited by number AND name.
  assertStringIncludes(body, "Cite the criterion by number and name");
  // plugin/ ships no memory tree, so the fallback is a real case, not a
  // hypothetical — without it a plugin install reviews ungrounded and silent.
  assertStringIncludes(body, "standalone plugin");
  assertStringIncludes(body, "is absent");
});

Deno.test("the FE-surface gate still short-circuits ahead of Step 0", () => {
  // Ordering matters: on a project with no front-end there is nothing to read
  // the catalogue about, and a mandatory read that fires anyway would turn a
  // designed no-op into wasted turns.
  const body = agent("accessibility-expert");
  assert(
    body.indexOf("## Front-end surface detection") < body.indexOf("## Step 0"),
    "the FE-surface gate must precede Step 0",
  );
  assertStringIncludes(body, "Do NOT continue to Step 0");
});

Deno.test("the agent's leaf pointers all resolve", () => {
  // The agent replaced its hand-maintained ten-axis checklist with pointers.
  // A pointer at a leaf that does not exist is worse than the checklist was.
  const body = agent("accessibility-expert");
  const shipped = new Set(entries().map((e) => (e.suffix ?? "").slice(DIR.length)));
  for (const m of body.matchAll(/`(\d\d-[a-z0-9-]+\.md)`/g)) {
    assert(
      shipped.has(m[1]),
      `accessibility-expert points at ${m[1]}, which the catalogue does not ship`,
    );
  }
  // ...and the pointers actually cover the catalogue, so no leaf is orphaned.
  for (const name of LEAVES) {
    assertStringIncludes(body, name, `no surface in accessibility-expert routes to ${name}`);
  }
});

Deno.test("both a11y dispatch surfaces name the catalogue", () => {
  const skill = CORE_BUNDLE.find((e) => e.category === "skill" && e.name === "a11y-audit");
  assert(skill, "a11y-audit skill is missing from the bundle");
  assertStringIncludes(skill.content, `${DIR}00-triage.md`);

  const phase = CORE_BUNDLE.find(
    (e) => e.category === "phase" && skillDocName(e) === "audit-accessibility",
  );
  assert(phase, "audit-accessibility phase is missing from the bundle");
  assertStringIncludes(phase.content, `${DIR}00-triage.md`);
});
