import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";
import { managedSectionLabels } from "../../src/domain/template.ts";

/**
 * #611 — a project adds to a bundled phase without preserving or editing it.
 *
 * The seam is a project-owned sidecar at `.specnaut/addenda/<skill>/<phase>.md`,
 * read at one defined position by three surfaces: the `/specnaut` router's
 * Routing step 2, the `/ship` router's Step 3, and a managed `phase-addenda`
 * block in `AGENTS.md` for the surfaces that reach a phase without a router
 * (a per-phase workflow, an always-on context file, a stale plugin router).
 *
 * What this file pins is the shape of that seam, not its existence:
 *
 * - the read happens at the step it is claimed to, not merely somewhere in the
 *   file — a sentence moved below `Execute` reads the addendum after the work;
 * - the three surfaces state ONE precedence rule, byte-identical, so the router
 *   and the always-on block cannot drift into disagreeing about whether an
 *   addendum may replace a bundled step;
 * - no phase doc carries a single character of it. Upgrade classifies phase
 *   docs by whole-file SHA; a seam written INTO them is the freeze #611 exists
 *   to remove.
 */

/** The sidecar root. Under `.specnaut/`, the one root no harness relocates. */
const ADDENDA_ROOT = ".specnaut/addenda/";
const SPECNAUT_ADDENDUM = ".specnaut/addenda/specnaut/<phase>.md";
const SHIP_ADDENDUM = ".specnaut/addenda/ship/<phase>.md";
const AGENTS_ADDENDUM = ".specnaut/addenda/<skill>/<phase>.md";

/**
 * The precedence rule, as every surface must spell it. One string, so a
 * rewording in one surface is a failure here rather than a second rule.
 */
const PRECEDENCE = "It adds to the phase at the step it names and never replaces or skips a " +
  "bundled step: where it contradicts one, the bundled step stands and you say so.";

/** The no-op rule — AC: a missing addendum renders nothing and warns nothing. */
const NO_OP = "No file means no addendum — say nothing about it.";

const LABEL = "phase-addenda";

/** Each router's H1, paired with the addendum path its read step must carry. */
const ROUTER_MARKERS = [
  ["# Specnaut router", SPECNAUT_ADDENDUM],
  ["# Ship skill", SHIP_ADDENDUM],
] as const;

const OPTS = {
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  specAutogen: false,
} as const;

function entry(pred: (e: CoreEntry) => boolean, what: string): CoreEntry {
  const e = CORE_BUNDLE.find(pred);
  if (!e) throw new Error(`missing bundle entry: ${what}`);
  return e;
}

const router = (name: string) =>
  entry((e) => e.category === "skill" && e.name === name, `${name} router`).content;

/** The body of one `## ` section, heading excluded, up to the next `## `. */
function section(content: string, heading: string): string {
  const start = content.indexOf(`\n${heading}\n`);
  assert(start !== -1, `no "${heading}" section`);
  const from = start + heading.length + 2;
  const next = content.indexOf("\n## ", from);
  return content.slice(from, next === -1 ? undefined : next);
}

/** Normalises the line wrapping prose picks up, so a reflow is not a rewording. */
function unwrap(text: string): string {
  return text.replace(/\s*\n\s*/g, " ");
}

Deno.test("/specnaut reads the addendum at Routing step 2 — after the phase doc, before executing it", () => {
  const routing = section(router("specnaut"), "## Routing");
  const readPhase = routing.indexOf("1. **Read** the phase reference file");
  const readAddendum = routing.indexOf("2. **Read the project addendum**");
  const execute = routing.indexOf("**Execute**");
  assert(readPhase !== -1, "Routing step 1 no longer reads the phase doc");
  assert(readAddendum !== -1, "Routing step 2 is not the addendum read");
  assert(execute !== -1, "Routing has no Execute step");
  assert(readPhase < readAddendum, "the addendum is read before the phase it adds to");
  assert(readAddendum < execute, "the addendum is read after the phase already ran");
  // The path is asserted in the STEP, not the file: a mention elsewhere in the
  // router (a docs paragraph, the index) would satisfy a file-level check and
  // move the read to no defined position at all.
  const step = routing.slice(readAddendum, routing.indexOf("\n3. ", readAddendum));
  assertStringIncludes(step, SPECNAUT_ADDENDUM);
  assertStringIncludes(unwrap(step), PRECEDENCE);
  assertStringIncludes(unwrap(step), NO_OP);
});

Deno.test("/specnaut contract docs are anchored through their parent phase, not addressed", () => {
  // `plan-audits`, `merge-close` … are loaded BY a phase, never routed to. An
  // addendum keyed on one would sit at a path nothing reads, silently.
  const routing = unwrap(section(router("specnaut"), "## Routing"));
  assertStringIncludes(
    routing,
    "Contract docs take none; the parent phase's addendum names their step.",
  );
});

Deno.test("/ship reads the addendum in Step 3, before Step 4's irreversible act", () => {
  const ship = router("ship");
  const step3 = section(ship, "## Step 3 — execute");
  assertStringIncludes(step3, SHIP_ADDENDUM);
  assertStringIncludes(unwrap(step3), PRECEDENCE);
  assertStringIncludes(unwrap(step3), NO_OP);
  // An addendum is most often a pre-flight ("run the migration check before
  // tagging"). Read after the confirmation, it arrives once the tag is pushed.
  assert(
    ship.indexOf(SHIP_ADDENDUM) < ship.indexOf("## Step 4"),
    "the ship addendum is read after the push it would have guarded",
  );
});

Deno.test("AGENTS.md declares the phase-addenda section and fences the rule inside it", () => {
  const agents = entry(
    (e) => e.category === "project-root" && e.suffix === "AGENTS.md",
    "root AGENTS.md",
  );
  const labels = managedSectionLabels(agents.managedSection);
  assert(labels.includes(LABEL), `${LABEL} missing from ${JSON.stringify(labels)}`);

  // Against the BODY: fences wrapped around nothing satisfy a file-level check
  // and deliver no instruction.
  const body = extractBlock(agents.content, LABEL, "html");
  assert(body !== null && body.trim().length > 0, "the phase-addenda block is absent or empty");
  assertStringIncludes(body!, AGENTS_ADDENDUM);
  assertStringIncludes(unwrap(body!), PRECEDENCE);
  assertStringIncludes(unwrap(body!), NO_OP);
  // The surfaces this block exists for bypass the router — it must say it
  // applies however the phase was reached, or it reads as a router footnote.
  assertStringIncludes(unwrap(body!), "however it was reached");
});

Deno.test("every harness carries both routers' addendum step and the AGENTS.md declaration", () => {
  for (const harness of HARNESSES) {
    const bundle = harness.mapBundle(CORE_BUNDLE, OPTS);
    const files = Object.values(bundle);

    // Located by a body marker, not by destination: each harness puts the
    // router somewhere else, and a destination list is a hand list that
    // forgets the next harness.
    for (const [marker, path] of ROUTER_MARKERS) {
      const routers = files.filter((f) => f.content.includes(`\n${marker}\n`));
      assert(routers.length > 0, `${harness.key} emits no file carrying "${marker}"`);
      for (const f of routers) {
        assertStringIncludes(
          f.content,
          path,
          `${harness.key} router "${marker}" lost the addendum step`,
        );
      }
    }

    const agents = bundle["AGENTS.md"];
    assert(agents !== undefined, `${harness.key} does not scaffold AGENTS.md`);
    assert(
      managedSectionLabels(agents.managedSection).includes(LABEL),
      `${harness.key} drops managedSection "${LABEL}" — upgraded projects never receive it`,
    );
  }
});

Deno.test("no bundled phase doc carries a character of the addendum seam", () => {
  // The ruling's first line. A phase doc is classified by whole-file SHA on
  // upgrade; a region or pointer written into it either flips the file to
  // "customized" the moment a project touches it, or costs budget in a
  // Windsurf workflow no build-time test can measure with the user's text in.
  const phases = CORE_BUNDLE.filter((e) => e.category === "phase");
  // Non-vacuity: both routed skills, and the two docs the ACs are about.
  assert(phases.length >= 20, `only ${phases.length} phase docs found — the sweep read nothing`);
  assert(
    phases.some((e) => e.name === "ship" && e.suffix === "release.md"),
    "ship/release.md not swept",
  );
  assert(
    phases.some((e) => e.name === "specnaut" && e.suffix === "plan.md"),
    "specnaut/plan.md not swept",
  );

  const carrying = phases
    .filter((e) => /addend/i.test(e.content) || e.content.includes(ADDENDA_ROOT))
    .map((e) => `${e.name}/${e.suffix}`);
  assertEquals(
    carrying,
    [],
    "phase docs carrying the seam — it belongs in the routers and AGENTS.md",
  );
});
