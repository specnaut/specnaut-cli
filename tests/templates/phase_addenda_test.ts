import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";
import { managedSectionLabels } from "../../src/domain/template.ts";
import { ADDENDUM_SKILLS, ROUTABLE_PHASES } from "../../src/domain/addendum_audit.ts";

/**
 * #611 — a project adds to a bundled phase without preserving or editing it.
 *
 * The seam is a project-owned sidecar at `.specnaut/addenda/<skill>/<phase>.md`,
 * read at one defined position by four surfaces: the `/task` and `/specnaut`
 * routers' Routing step 2, the `/ship` router's Step 3, and a managed
 * `phase-addenda` block in `AGENTS.md` for the surfaces that reach a phase
 * without a router (a per-phase workflow, an always-on context file, a stale
 * plugin router). Since cli#683 that block names addenda **by phase**, so an
 * older router that still runs `plan` finds the addendum at its new home.
 *
 * What this file pins is the shape of that seam, not its existence:
 *
 * - the read happens at the step it is claimed to, not merely somewhere in the
 *   file — a sentence moved below `Execute` reads the addendum after the work;
 * - the four surfaces state ONE precedence rule, byte-identical, so the router
 *   and the always-on block cannot drift into disagreeing about whether an
 *   addendum may replace a bundled step;
 * - no phase doc carries a single character of it. Upgrade classifies phase
 *   docs by whole-file SHA; a seam written INTO them is the freeze #611 exists
 *   to remove.
 */

/** The sidecar root. Under `.specnaut/`, the one root no harness relocates. */
const ADDENDA_ROOT = ".specnaut/addenda/";
const TASK_ADDENDUM = ".specnaut/addenda/task/<verb>.md";
const SPECNAUT_ADDENDUM = ".specnaut/addenda/specnaut/<verb>.md";
const SHIP_ADDENDUM = ".specnaut/addenda/ship/<phase>.md";

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
  ["# Task router", TASK_ADDENDUM],
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
  entry(
    (e) => (e.category === "skill" || e.category === "backlog-skill") && e.name === name,
    `${name} router`,
  ).content;

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

for (const [name, path] of [["task", TASK_ADDENDUM], ["specnaut", SPECNAUT_ADDENDUM]] as const) {
  Deno.test(`/${name} reads the addendum at Routing step 2 — after the verb's doc, before executing it`, () => {
    const routing = section(router(name), "## Routing");
    const readDoc = routing.indexOf("1. **Read** the verb's reference file");
    const readAddendum = routing.indexOf("2. **Read the project addendum**");
    const execute = routing.indexOf("**Execute**");
    assert(readDoc !== -1, "Routing step 1 no longer reads the verb's doc");
    assert(readAddendum !== -1, "Routing step 2 is not the addendum read");
    assert(execute !== -1, "Routing has no Execute step");
    assert(readDoc < readAddendum, "the addendum is read before the doc it adds to");
    assert(readAddendum < execute, "the addendum is read after the verb already ran");
    // The path is asserted in the STEP, not the file: a mention elsewhere in the
    // router (a docs paragraph, the table) would satisfy a file-level check and
    // move the read to no defined position at all.
    const step = routing.slice(readAddendum, routing.indexOf("\n3. ", readAddendum));
    assertStringIncludes(step, path);
    assertStringIncludes(unwrap(step), PRECEDENCE);
    assertStringIncludes(unwrap(step), NO_OP);
  });
}

Deno.test("/task contract docs are anchored through their parent verb, not addressed", () => {
  // `plan-audits`, `merge-close` … are loaded BY a verb, never routed to. An
  // addendum keyed on one would sit at a path nothing reads, silently.
  const routing = unwrap(section(router("task"), "## Routing"));
  assertStringIncludes(
    routing,
    "Contract docs take none; the parent verb's addendum names their step.",
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
  // By phase (plan 037 § 11 M1): one row per router, its first column exactly
  // the phases that router reads an addendum for, its second the address. A
  // phase missing from the row is a guardrail an older router never finds.
  const rows = body!.split("\n").filter((l) => l.startsWith("| `"));
  for (const skill of ADDENDUM_SKILLS) {
    const address = `\`.specnaut/addenda/${skill}/<name>.md\``;
    const row = rows.find((r) => r.split("|")[2]?.trim() === address);
    assert(row !== undefined, `no phase-addenda row for ${address}`);
    const named = [...row.split("|")[1].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).sort();
    assertEquals(named, [...ROUTABLE_PHASES[skill]].sort(), `${skill}: the row's phases drifted`);
  }
  assertStringIncludes(unwrap(body!), PRECEDENCE);
  assertStringIncludes(unwrap(body!), NO_OP);
  // The surfaces this block exists for bypass the router — it must say it
  // applies however the phase was reached, or it reads as a router footnote.
  assertStringIncludes(unwrap(body!), "however it was reached");
});

Deno.test("every harness carries every router's addendum step and the AGENTS.md declaration", () => {
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
  // "customized" the moment a project touches it.
  const phases = CORE_BUNDLE.filter((e) => e.category === "phase");
  // Non-vacuity: both routed skills, and the two docs the ACs are about.
  assert(phases.length >= 15, `only ${phases.length} phase docs found — the sweep read nothing`);
  assert(
    phases.some((e) => e.name === "ship" && e.suffix === "release.md"),
    "ship/release.md not swept",
  );
  assert(
    phases.some((e) => e.name === "task" && e.suffix === "plan.md"),
    "task/plan.md not swept",
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
