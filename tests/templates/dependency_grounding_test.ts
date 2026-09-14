import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * Locks `dependency-expert` to the supply-chain domain file it used to
 * duplicate.
 *
 * This seat is the one grounding case in the fleet that must NOT get a
 * catalogue of its own. `06-supply-chain-and-integrity.md` already covered its
 * ground at comparable depth — advisories, lockfiles, typosquats, transitive
 * trees — and the two were free to drift because neither pointed at the other.
 * A parallel `memory/dependency/` tree would have made that three sources
 * instead of two.
 *
 * So the guards here are about *delegation*, not about coverage: the domain
 * file is named, and the delegated axes carry no second opinion beside it.
 */

const DOMAIN_FILE = "06-supply-chain-and-integrity.md";

function agent(name: string): string {
  const entry = CORE_BUNDLE.find((e) => e.category === "agent" && e.name === name);
  assert(entry, `${name} agent is missing from the bundle`);
  return entry.content;
}

/** Text between two markers, used to scope a guard to one block of the file. */
function slice(body: string, from: string, to: string): string {
  const start = body.indexOf(from);
  assert(start >= 0, `expected to find ${JSON.stringify(from)}`);
  const end = body.indexOf(to, start + from.length);
  assert(end >= 0, `expected to find ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return body.slice(start, end);
}

Deno.test("dependency-expert opens the supply-chain domain file before judging", () => {
  const body = agent("dependency-expert");
  assertStringIncludes(body, "## Step 0");
  assertStringIncludes(body, `.specnaut/memory/security/${DOMAIN_FILE}`);
  // The hand-off has to be stated in both directions, or the seat cannot tell
  // which half of the ground is its own.
  assertStringIncludes(body, "version currency");
});

/**
 * The guard that actually catches a regression.
 *
 * "Point at the domain file" is cheap to satisfy while leaving the duplicated
 * rules in place beside the pointer — which is worse than either alone, because
 * the two can now disagree and the reader has no way to know which won. A
 * restated rule is recognisable by the thing a rule carries and a pointer does
 * not: **its own severity.**
 */
Deno.test("delegated axes carry no severity of their own", () => {
  const body = agent("dependency-expert");
  const blocks = {
    "Mode 1 always-check rules": slice(body, "### Always-check rules", "## Mode 2"),
    "Mode 2 axis 1 (supply-chain shape)": slice(
      body,
      "1. **Supply-chain shape (delegated)**",
      "2. **Unused declared deps**",
    ),
  };
  for (const [label, block] of Object.entries(blocks)) {
    for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
      assert(
        !block.includes(severity),
        `${label} assigns ${severity} itself. Pin discipline, lockfiles and ` +
          `typosquats are delegated to ${DOMAIN_FILE} — a severity here is a ` +
          `second opinion free to drift from the file that owns the axis.`,
      );
    }
    assertStringIncludes(
      block,
      DOMAIN_FILE,
      `${label} must name the file it delegates to`,
    );
  }
});

Deno.test("licensing stays with the seat and carries its own negative section", () => {
  const body = agent("dependency-expert");
  // The domain file hands licence policy back by name, so this is the one axis
  // whose negative section cannot live there.
  assertStringIncludes(body, "### License allowlist resolution");
  assertStringIncludes(body, "### When it is NOT a license finding");
  const negative = slice(
    body,
    "### When it is NOT a license finding",
    "### Scope checklist",
  );
  // Each bullet must kill a specific wrong licence finding, not restate the rule.
  for (const kill of ["devDependencies", "subprocess", "dual-licensed", "not counsel"]) {
    assertStringIncludes(
      negative,
      kill,
      `the license negative section must cover "${kill}" — these are the false ` +
        `positives that make a license finding expensive and wrong`,
    );
  }
});

Deno.test("no dependency catalogue was created", () => {
  // Explicitly required by the ticket: this seat is grounded by a pointer, not
  // by a parallel tree. A `memory/dependency/` catalogue would reintroduce the
  // drift the pointer removes.
  const stray = CORE_BUNDLE.filter((e) => (e.suffix ?? "").startsWith("memory/dependency"));
  assert(
    stray.length === 0,
    `dependency-expert must be grounded by a pointer at ${DOMAIN_FILE}, not by ` +
      `its own catalogue; found ${stray.length} entries under memory/dependency/`,
  );
});

Deno.test("transitive-dependency ground is reachable through the pointer", () => {
  // The seat carried zero transitive-dependency content and the domain file
  // carried it already. The pointer closes that gap for free — assert the chain
  // rather than a copy of the content.
  const domain = CORE_BUNDLE.find(
    (e) => e.suffix === `memory/security/${DOMAIN_FILE}`,
  );
  assert(domain, `${DOMAIN_FILE} is missing from the bundle`);
  assertStringIncludes(domain.content, "transitive");
  assertStringIncludes(agent("dependency-expert"), DOMAIN_FILE);
});

Deno.test("dependency-expert degrades cleanly when installed as a plugin", () => {
  // plugin/ ships no memory tree, so the fallback is this seat's real case —
  // not a hypothetical. Without it the review runs ungrounded and silent.
  const body = agent("dependency-expert");
  assertStringIncludes(body, "standalone plugin");
  assertStringIncludes(body, "is absent");
});

Deno.test("both dependency dispatch surfaces name the domain file", () => {
  // The agent can be entered from the skill or from the phase. A Step 0 the
  // dispatch prompt never mentions is a Step 0 that gets skipped under load.
  const skill = CORE_BUNDLE.find((e) => e.category === "skill" && e.name === "dep-audit");
  assert(skill, "dep-audit skill is missing from the bundle");
  assertStringIncludes(skill.content, `memory/security/${DOMAIN_FILE}`);

  const phase = CORE_BUNDLE.find(
    (e) => e.category === "phase" && skillDocName(e) === "audit-dependencies",
  );
  assert(phase, "audit-dependencies phase is missing from the bundle");
  assertStringIncludes(phase.content, `memory/security/${DOMAIN_FILE}`);
});
