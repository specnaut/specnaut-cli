import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";

/**
 * Locks the offline architecture catalogue into the bundle.
 *
 * Like the security knowledge base beside it, the catalogue ships as
 * `spec-root` entries under `.specnaut/memory/architecture/` — `.specnaut/` is
 * the one tree every harness scaffolds at an identical path, so it needs no
 * per-harness destination. A skill folder can only ship its own `SKILL.md`, so
 * moving the catalogue under one would make it silently stop being scaffolded.
 *
 * Unlike the security base, this catalogue is deliberately **one file per
 * item** rather than grouped domain files. The two shapes are not an
 * inconsistency to reconcile: security routes by *symptom* (you do not yet know
 * what you are looking for), architecture is a *lookup* (you already know you
 * are about to write "Feature Envy" and need the page). The per-leaf shape is
 * what makes the agent's per-finding read gate affordable — see the leaf-size
 * test below, which is the assertion that actually protects it.
 */

const DIR = "memory/architecture/";

function entries(): CoreEntry[] {
  return CORE_BUNDLE.filter(
    (e) => e.category === "spec-root" && (e.suffix ?? "").startsWith(DIR),
  );
}

function entryFor(name: string): CoreEntry {
  const found = entries().find((e) => e.suffix === `${DIR}${name}`);
  assert(found, `architecture catalogue is missing ${name} — add it to templates/manifest.json`);
  return found;
}

function leavesIn(sub: string): CoreEntry[] {
  return entries().filter((e) => (e.suffix ?? "").startsWith(`${DIR}${sub}/`));
}

const README = () => entryFor("README.md").content;

Deno.test("catalogue ships a README, the DDD hub, and leaves in three directories", () => {
  entryFor("README.md");
  entryFor("ddd-and-clean-code.md");
  for (const sub of ["smells", "refactorings", "patterns"]) {
    assert(leavesIn(sub).length > 0, `no leaves under ${sub}/`);
  }
  assertEquals(
    entries().length,
    2 + leavesIn("smells").length + leavesIn("refactorings").length + leavesIn("patterns").length,
    "a file under .specnaut/memory/architecture/ is neither the README, the DDD hub, nor a leaf",
  );
});

Deno.test("catalogue ships as spec-root so every harness scaffolds it", () => {
  for (const e of entries()) {
    assertEquals(
      e.category,
      "spec-root",
      `${e.suffix} must ship as spec-root — every harness maps that to .specnaut/ verbatim`,
    );
  }
  // Guard the claim rather than assert it abstractly: spec-root has no
  // per-harness branch, so one harness in the list standing for all is honest
  // only while that stays true.
  assert(HARNESSES.length > 1, "harness list collapsed — re-check the spec-root assumption");
});

Deno.test("catalogue files refresh on upgrade rather than being skipped", () => {
  for (const e of entries()) {
    assert(
      e.skipIfExists !== true,
      `${e.suffix} must not be skipIfExists — the catalogue is Specnaut-owned and has to receive fixes`,
    );
  }
});

Deno.test("README index covers every leaf, with no dangling entries", () => {
  const readme = README();
  const listed = new Set(
    [...readme.matchAll(/\]\((smells|refactorings|patterns)\/([a-z0-9-]+\.md)\)/g)]
      .map((m) => `${m[1]}/${m[2]}`),
  );
  const shipped = new Set(
    entries().map((e) => (e.suffix ?? "").slice(DIR.length)).filter((s) => s.includes("/")),
  );

  for (const s of shipped) {
    assert(listed.has(s), `${s} ships but the README index does not list it`);
  }
  for (const l of listed) {
    assert(shipped.has(l), `README index links ${l}, which does not ship — dangling entry`);
  }
});

Deno.test("every internal catalogue link resolves to a shipped file", () => {
  const shipped = new Set(entries().map((e) => (e.suffix ?? "").slice(DIR.length)));
  for (const e of entries()) {
    const from = (e.suffix ?? "").slice(DIR.length);
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    for (
      const m of e.content.matchAll(
        /\]\((\.\.\/[a-z0-9-]+\/[a-z0-9-]+\.md|\.\.\/[a-z0-9-]+\.md|[a-z0-9-]+\.md)\)/g,
      )
    ) {
      const raw = m[1];
      const target = raw.startsWith("../") ? raw.slice(3) : (dir ? `${dir}/${raw}` : raw);
      assert(
        shipped.has(target),
        `${from} links to ${raw}, which resolves to ${target} and does not ship`,
      );
    }
  }
});

/**
 * The assertion that protects the layout.
 *
 * The per-leaf shape exists so the architect can afford to open one file per
 * finding it reports. That property degrades silently: nothing stops a leaf
 * growing into a grouped domain file one edit at a time, and by the time
 * anyone notices, the read gate has quietly become too expensive to obey and
 * the agent is back to judging from memory. The bound is generous — a leaf is
 * about a page — so tripping it means the shape changed, not that a leaf got
 * one paragraph longer.
 */
Deno.test("leaves stay small enough that a per-finding read is affordable", () => {
  const MAX = 4096;
  for (const e of entries()) {
    const name = (e.suffix ?? "").slice(DIR.length);
    if (!name.includes("/")) continue; // README and the DDD hub are hubs, not leaves
    assert(
      e.content.length <= MAX,
      `${name} is ${e.content.length} bytes, over the ${MAX}-byte leaf bound. ` +
        "Split it or trim it — do not raise the bound without deciding that the " +
        "per-finding read gate in architect-expert.md is still affordable.",
    );
  }
});

Deno.test("every smell and pattern carries the section that kills a wrong finding", () => {
  for (const e of leavesIn("smells")) {
    assertStringIncludes(
      e.content,
      "## When it is NOT a smell",
      `${e.suffix} has no negative section — the agent is told to read one`,
    );
  }
  for (const e of leavesIn("patterns")) {
    assertStringIncludes(
      e.content,
      "## When NOT to reach for it",
      `${e.suffix} has no negative section — the agent is told to read one`,
    );
  }
  for (const e of leavesIn("refactorings")) {
    assertStringIncludes(
      e.content,
      "## Caution",
      `${e.suffix} has no caution section`,
    );
  }
});

Deno.test("architect-expert is required to open the catalogue before naming anything", () => {
  const agent = CORE_BUNDLE.find((e) => e.category === "agent" && e.name === "architect-expert");
  assert(agent, "architect-expert agent is missing from the bundle");
  assertStringIncludes(agent.content, ".specnaut/memory/architecture/");
  assertStringIncludes(agent.content, "mandatory");
  // The gate is per SHIPPED finding, not per candidate — that distinction is
  // what keeps the cost proportional to the report instead of to the search.
  assertStringIncludes(agent.content, "NAME IN THE REPORT");
  // Without the standalone fallback, a plugin install reads as a silent skip.
  assertStringIncludes(agent.content, "standalone plugin");
});

Deno.test("README states the prose is original, not copied", () => {
  // The catalogue names are industry vocabulary; the descriptions are not.
  // Specnaut ships MIT-licensed and public, so this claim is load-bearing and
  // belongs where a reader of the catalogue will see it.
  assertStringIncludes(README(), "The prose is original");
});

/**
 * The agent's Mode 2 table points at a leaf per audit axis instead of restating
 * each axis inline — that removed a copy of the catalogue that was free to
 * drift from it. The copy is gone; a typo in a pointer would be its silent
 * replacement, so pin the pointers.
 */
Deno.test("every catalogue path named by architect-expert actually ships", () => {
  const agent = CORE_BUNDLE.find((e) => e.category === "agent" && e.name === "architect-expert");
  assert(agent, "architect-expert agent is missing from the bundle");
  const shipped = new Set(entries().map((e) => (e.suffix ?? "").slice(DIR.length)));

  const cited = [
    ...agent.content.matchAll(
      /`((?:smells|refactorings|patterns)\/[a-z0-9-]+\.md|ddd-and-clean-code\.md)`/g,
    ),
  ]
    .map((m) => m[1]);
  assert(
    cited.length > 0,
    "architect-expert cites no catalogue leaf — the Step 0 table lost its pointers",
  );
  for (const c of cited) {
    assert(shipped.has(c), `architect-expert cites ${c}, which does not ship`);
  }
});

Deno.test("the catalogue is self-contained — no file carries an external URL", () => {
  // Its README is explicit that a seat opens a local file instead of deciding
  // whether a lookup is worth it; a link out contradicts that and ties a
  // shipped file to somebody else's URLs. Every entry, README included.
  const all = entries();
  assert(all.length > 100, `expected the whole catalogue, got ${all.length} entries`);
  const linked = all.filter((e) => /https?:\/\//.test(e.content)).map((e) => e.suffix);
  assertEquals(linked, [], `external URLs found in: ${linked.join(", ")}`);
});
