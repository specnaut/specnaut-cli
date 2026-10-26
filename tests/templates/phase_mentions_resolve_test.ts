import { assert } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * Every `/specnaut <phase>` a shipped document tells someone to run resolves:
 * to a phase the router routes, or to a row of the router's "Removed phases"
 * section, which answers it with a notice. Anything else is an instruction
 * that leads nowhere — what spec 034 found in five skills and four agents
 * once the audit phases were gone.
 *
 * Derived from the bundle, not from a list of retired names: a list would be a
 * registry kept forever, and it would only catch the names someone remembered.
 */

const documents: Array<{ where: string; content: string; isStatic: boolean }> = [
  ...CORE_BUNDLE.map((e) => ({
    where: `${e.category}:${e.name}/${e.suffix ?? ""}`,
    content: e.content,
    isStatic: false,
  })),
  ...Object.entries(HARNESS_STATIC).flatMap(([h, files]) =>
    Object.entries(files).map(([dest, f]) => ({
      where: `${h}:${dest}`,
      content: f.content,
      isStatic: true,
    }))
  ),
];

const router = CORE_BUNDLE.find((e) => e.category === "skill" && e.name === "specnaut");

/**
 * What the router routes: the first column of its "Phase index" table, and only
 * where the phase document actually ships. Not every bundled document under
 * `phases/` — `merge-squash`, `plan-audits` and the other contract docs sit
 * there too, and the router answers them with the index, not a phase.
 */
const shipped = new Set(
  CORE_BUNDLE.filter((e) => e.category === "phase" && e.name === "specnaut").map(skillDocName),
);
const indexSection = router?.content.split(/^## /m).find((s) => s.startsWith("Phase index")) ?? "";
const routed = new Set(
  indexSection.split("\n")
    .filter((l) => l.startsWith("| `"))
    .map((l) => /`([a-z][a-z-]*)`/.exec(l.split("|")[1])?.[1])
    .filter((p): p is string => p !== undefined && shipped.has(p)),
);
const removedSection = router?.content.split(/^## /m).find((s) => s.startsWith("Removed phases")) ??
  "";
/**
 * What the router answers with a notice: the first column of the section's table,
 * and the names on its "… are RETIRED" lines. Not every backticked word in the
 * section — `/ship tag` and `/sec-audit` sit there too, and counting them would
 * let `/specnaut security` resolve.
 */
const removed = new Set(
  removedSection.split("\n").flatMap((line) => {
    const source = line.startsWith("|") ? line.split("|")[1] : /RETIRED/.test(line) ? line : "";
    return [...source.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]);
  }),
);

/**
 * `/specnaut <phase>`; a two-word `audit <axis>` reads as `audit-<axis>`.
 *
 * In Markdown only inside a code span: prose says "the `/specnaut` router", and a
 * word after the command is a phase only where the text is quoting a command. A
 * script has no prose, so there every mention counts.
 */
function mentions(where: string, content: string): string[] {
  const script = /\.(sh|ps1|js|ts)$/.test(where);
  const re = script
    ? /\/specnaut ([a-z][a-z-]*)(?: ([a-z]+))?/g
    : /`\/specnaut ([a-z][a-z-]*)(?: ([a-z]+))?[^`]*`/g;
  return [...content.matchAll(re)].map(([, phase, next]) =>
    phase === "audit" && next ? `audit-${next}` : phase
  );
}

Deno.test("the router and its removed-phases section were found, and read narrowly", () => {
  assert(routed.has("plan") && routed.has("review"), "no routed phase read from the bundle");
  assert(!routed.has("merge-squash"), "a contract doc read as a routed phase");
  assert(
    removed.has("brainstorm") && removed.has("audit-security"),
    "no removed-phases section read",
  );
  // A bare axis or a replacement skill must never resolve as a retired phase.
  assert(!removed.has("security") && !removed.has("sec-audit"), "the removed set reads too wide");
});

Deno.test("every /specnaut <phase> a shipped document names resolves", () => {
  const dangling: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  const from = { script: 0, static: 0 };
  for (const { where, content, isStatic } of documents) {
    for (const phase of mentions(where, content)) {
      total++;
      if (/\.(sh|ps1|js|ts)$/.test(where)) from.script++;
      if (isStatic) from.static++;
      seen.add(phase);
      if (!routed.has(phase) && !removed.has(phase)) dangling.push(`${where}: /specnaut ${phase}`);
    }
  }
  // Non-vacuity: a regex that stopped matching would report "nothing dangles".
  assert(total > 20 && seen.has("plan") && seen.has("merge"), `only ${total} mentions read`);
  // Per source, so a broken script regex or a dropped HARNESS_STATIC spread fails alone.
  assert(from.script > 0, "no mention read from a script — the script scan read nothing");
  assert(from.static > 0, "no mention read from a harness static — the static scan read nothing");
  assert(dangling.length === 0, `mentions of a phase nothing answers:\n${dangling.join("\n")}`);
});

Deno.test("no shipped document carries the retired upstream's attribution", () => {
  const hits = documents.filter((d) => /superpowers/i.test(d.content)).map((d) => d.where);
  assert(hits.length === 0, `still attributed:\n${hits.join("\n")}`);
});
