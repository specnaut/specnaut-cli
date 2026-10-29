import { assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * #518 — nothing in the bundle may direct an agent at an artefact 2.0.0 removed.
 *
 * A feature produces exactly `plan.md` and `tasks.md`. `spec.md`,
 * `research.md`, `data-model.md`, `quickstart.md` and `contracts/` stopped
 * being generated in 2.0.0, and `spec-template.md` / `checklist-template.md`
 * stopped shipping.
 *
 * The prose said so in two places and the instructions kept pointing at the
 * old files anyway — `tasks-template.md` listed four of them as prerequisites,
 * and `developer.md` returned BLOCKED when it could not find the domain model
 * in `spec.md`, a file that no longer exists. Both survived two major releases
 * because nothing compared the instructions against the artefact set.
 *
 * A grep is the right shape of test here: the failure mode is a stale mention,
 * and a stale mention is exactly what a grep sees.
 */

const REMOVED = [
  /\bspec\.md\b/,
  /\bresearch\.md\b/,
  /\bdata-model\.md\b/,
  /\bquickstart\.md\b/,
  /\bcontracts\//,
  /\bspec-template\.md\b/,
  /\bchecklist-template\.md\b/,
];

/**
 * Legitimate mentions, each for a stated reason. These are NOT pinned defects:
 * every one refers to something other than a current Specnaut feature artefact.
 * Anything added here needs the same justification.
 */
const ALLOWED = new Map<string, string>([
  // Each of these names a removed artefact for a reason other than directing
  // work at it. They are NOT pinned defects — anything added here needs the
  // same kind of justification.
  ["specify|templates/plan-template.md", "states that they do not exist"],
  ["task|tasks.md", "states that they do not exist"],
  // Moved out of groom with the backlog//specnaut ownership split (#540): the
  // check reads spec artefacts and prescribes pipeline phases, so it lives
  // with the chain it inspects — under `/task` since cli#683. The exemption
  // travels with it unchanged.
  ["task|auto-chain.md", "detects pre-2.0.0 spec dirs, which genuinely have one"],
  ["developer|", "tolerates a pre-2.0.0 dir without ever requiring it"],
  ["task|constitution.md", "a project's own docs/quickstart.md, not ours"],
  ["product-owner|", "a spec the user attaches; never generated, never required"],
  ["specify|scripts/audit/collect-audit-scope.sh", "the audit phase's own design records"],
]);

Deno.test("no bundled file directs an agent at an artefact 2.0.0 removed", () => {
  const offenders: string[] = [];
  for (const entry of CORE_BUNDLE) {
    for (const pattern of REMOVED) {
      if (!pattern.test(entry.content)) continue;
      const key = `${entry.name}|${entry.suffix ?? ""}`;
      if (ALLOWED.has(key)) continue;
      offenders.push(`${key} — ${pattern.source}`);
    }
  }
  assertEquals(
    offenders,
    [],
    `these bundled files still name a removed artefact:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every allowance still excuses a bundled file", () => {
  // An allowance keyed on a file that moved excuses nothing while looking like
  // it does — and it hides the day a file comes back at the old key with a
  // stale mention. cli#683 moved four of the seven keys at once.
  const keys = new Set(CORE_BUNDLE.map((e) => `${e.name}|${e.suffix ?? ""}`));
  const named = new Set(
    CORE_BUNDLE.filter((e) => REMOVED.some((p) => p.test(e.content)))
      .map((e) => `${e.name}|${e.suffix ?? ""}`),
  );
  const dead = [...ALLOWED.keys()].filter((k) => !keys.has(k) || !named.has(k));
  assertEquals(dead, [], "these allowances excuse no bundled file that names a removed artefact");
});
