import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { FE_VOCAB, flat } from "./mobile_first_vocab.ts";

/**
 * The mobile-first contract (#576) — shape, wiring, and the two things the
 * contract forbids itself.
 *
 * Byte-identity with `plugin/` is NOT asserted here on purpose: it is already
 * decided by `SYNC_PAIRS` in `tests/plugin/plugin_sync_test.ts`, and a second
 * comparison would be a second decider of one rule.
 */

const CONTRACT = "mobile-first-contract";

function contractEntry() {
  const e = CORE_BUNDLE.find((x) => x.category === "skill" && x.name === CONTRACT);
  if (!e) {
    throw new Error(
      `${CONTRACT} is not in CORE_BUNDLE — an authored template ` +
        "that is not manifest-registered renders for nobody",
    );
  }
  return e;
}

Deno.test("the contract is registered, and it is the only place it exists", () => {
  // Presence in CORE_BUNDLE IS the registration proof: the bundle is generated
  // from templates/manifest.json, so an unregistered file cannot appear here.
  contractEntry();
  const sameName = CORE_BUNDLE.filter((x) => x.name === CONTRACT);
  assertEquals(sameName.length, 1, "one authored contract, not two");
});

Deno.test("the contract ships preloaded, not user-invocable", () => {
  const { content } = contractEntry();
  assert(/^user-invocable:\s*false\s*$/m.test(content), "user-invocable: false missing");
  assert(
    content.includes("Preloaded, not user-invocable."),
    "the marker sentence is what the description carries into every harness listing",
  );
});

/**
 * A closed set, and the right instrument for it. Constitution § XI's open set —
 * any unrelated project's name — is served by the contract carrying no examples
 * at all, not by this list. Scoped to the contract FILE: the constitution
 * template names frameworks as tuning guidance, deliberately, and this
 * assertion must not reach it.
 */
const FRAMEWORK_NAMES = [
  "tailwind",
  "bootstrap",
  "react",
  "vue.js",
  "svelte",
  "angular",
  "solidjs",
  "chakra",
  "material-ui",
  "shadcn",
  "bulma",
  "foundation css",
  "styled-components",
  "emotion",
  "sass",
  "less css",
  "flutter",
  "swiftui",
  "jetpack compose",
];

Deno.test("the contract names no framework", () => {
  const lower = contractEntry().content.toLowerCase();
  const hits = FRAMEWORK_NAMES.filter((n) => lower.includes(n));
  assertEquals(hits, [], `a framework named in the contract is a bug in the contract: ${hits}`);
});

/**
 * By NAMED TUNABLE, never by digit. A digit ban would forbid the WCAG citations
 * the rules take their authority from — 1.4.10 Reflow, 2.1 A/AA — and could
 * never go green. What must not appear is a VALUE for something the project
 * decides.
 */
const TUNABLE_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ["absolute unit", /\b\d+(?:\.\d+)?\s*(?:px|rem|em|pt|dp|sp)\b/i],
  // Round 2: "at least 44 CSS pixels" slipped every rule — `px` sits inside
  // `pixels`, `\s*` cannot span `CSS`, and 44 is under the 3-digit floor.
  // WCAG 2.5.5's own wording is "44 by 44 CSS pixels", so this is the literal
  // an author is most likely to reach for.
  ["two-digit size", /\b\d{2}\s+(?:\w+\s+)?(?:css\s+)?(?:pixels?|points?|dp|sp)\b/i],
  ["relative unit", /\b\d+(?:\.\d+)?\s*(?:vw|vh|vmin|vmax|ch|ex|%)(?![\w-])/i],
  ["spelled-out unit", /\b\d+\s*(?:pixels?|points?|ems?|rems?)\b/i],
  // A bare integer assigned to a token IS a value: `--touch-min: 44`.
  ["token assignment", /--[a-z0-9-]+\s*[:=]\s*\d/i],
  // A bare 3-4 digit integer is a breakpoint in every design system alive.
  // Applied AFTER citations are stripped (see `withoutCitations`) rather than
  // fenced off by lookaround: the first attempt excluded a FOLLOWING dot to
  // spare "1.4.10", which also spared "768." at the end of a sentence.
  ["bare breakpoint", /(?<![\d.-])\d{3,4}(?![\d])/],
];

/** WCAG criteria and version numbers are citations, not values. Remove them
 * before looking for bare integers, so the two questions never fight. */
function withoutCitations(s: string): string {
  // Only a dotted number NOT followed by a unit is a citation. Round 2: the
  // stripper rewrote "37.5" in "37.5 em" to § and so created a miss of its own
  // — a cleaner that removes the evidence.
  return s
    .replace(/\b\d+(?:\.\d+)+\b(?!\s*(?:px|rem|em|pt|dp|sp|vw|vh|%))/gi, "§")
    .replace(/\bWCAG\s+[\d.]+/gi, "WCAG");
}

Deno.test("the contract declares no tunable value", () => {
  const content = withoutCitations(contractEntry().content);
  const hits = TUNABLE_SHAPES
    .filter(([, re]) => re.test(content))
    .map(([name, re]) => `${name}: ${re.exec(content)?.[0]}`);
  assertEquals(
    hits,
    [],
    "a value here is a second decider competing with the project's own DESIGN.md",
  );
});

/** Excluded on purpose, each with the reason. An empty reason is not an exclusion. */
const EXCLUSIONS = new Map<string, string>([
  [
    "accessibility-expert",
    "Excluded deliberately. Its scope is WCAG 2.1 A/AA, and the contract states " +
    "that target-size is NOT an accessibility criterion. Pointing this seat at it " +
    "would invite exactly the misattribution the contract forbids.",
  ],
  [
    "performance-expert",
    "Its two front-end mentions are about bundle size and render thrash, not about " +
    "how a layout adapts. Nothing it reviews is decided by this contract.",
  ],
]);

Deno.test("every UI-touching agent points at the contract, or is excused with a reason", () => {
  const candidates = CORE_BUNDLE
    .filter((e) => e.category === "agent" && FE_VOCAB.test(e.content))
    .map((e) => e.name);
  assert(candidates.length > 0, "the derivation matched nothing — it is broken, not clean");

  const unwired: string[] = [];
  for (const name of candidates) {
    if (EXCLUSIONS.get(name)?.trim()) continue;
    const { content } = CORE_BUNDLE.find((e) => e.category === "agent" && e.name === name)!;
    const skills = /^skills:\s*(.+)$/m.exec(content)?.[1] ?? "";
    if (!skills.split(",").map((s) => s.trim()).includes(CONTRACT)) unwired.push(name);
  }
  assertEquals(unwired, [], "UI-touching agents with no pointer and no written exclusion");
});

/**
 * Agents that carry the pointer WITHOUT matching the derivation. Recorded so
 * the pointer is a decision on the record rather than a silent extra: the
 * derivation reads content, and this seat's only UI vocabulary is the pointer
 * line itself, so it can never match by construction.
 */
const POINTED_BY_DECISION = new Map<string, string>([
  [
    "code-reviewer",
    "Reviews whatever the developer wrote, UI included — the seat where a " +
    "fixed-width layout is caught after the fact. Its own text carries no UI " +
    "vocabulary, so the content derivation cannot reach it.",
  ],
]);

Deno.test("an agent pointed outside the derivation says why", () => {
  const candidates = new Set(
    CORE_BUNDLE.filter((e) => e.category === "agent" && FE_VOCAB.test(e.content)).map((e) =>
      e.name
    ),
  );
  const undocumented = CORE_BUNDLE
    .filter((e) => e.category === "agent" && !candidates.has(e.name))
    .filter((e) => (/^skills:\s*(.+)$/m.exec(e.content)?.[1] ?? "").includes(CONTRACT))
    .map((e) => e.name)
    .filter((n) => !POINTED_BY_DECISION.get(n)?.trim());
  assertEquals(undocumented, [], "pointed at the contract with no written reason");
});

Deno.test("an exclusion names something that is actually a candidate", () => {
  const candidates = new Set(
    CORE_BUNDLE.filter((e) => e.category === "agent" && FE_VOCAB.test(e.content)).map((e) =>
      e.name
    ),
  );
  const stale = [...EXCLUSIONS.keys()].filter((n) => !candidates.has(n));
  assertEquals(stale, [], "an exclusion outliving its subject is how a carve-out becomes a fossil");
});

/**
 * The rule set lives in ONE file, and the sweep covers every NORMATIVE sentence
 * — not three rules of eight, and not only each rule's bold lead.
 *
 * Round 2 widened it from three hand-picked sentences to eight derived leads.
 * Round 3 found the aperture still too narrow twice over: rule BODIES were
 * never checked, and the window began at the rules section, leaving the
 * default-and-opt-out section unswept entirely.
 *
 * The window is now both normative sections, swept sentence by sentence. The
 * framing intro is deliberately outside it: its "It exists so the rule is
 * stated once" is boilerplate this contract shares verbatim with
 * `backlog-reference-contract`, and a sweep that flagged shared framing as a
 * restatement would be crying wolf on the one thing that is correct.
 */
function normativeSentences(content: string): string[] {
  const from = content.indexOf("## A default, not a mandate");
  const to = content.indexOf("## Where the values live");
  const section = content.slice(from, to === -1 ? undefined : to);
  return flat(section.replace(/[*`]/g, ""))
    .split(/(?<=\.)\s+/)
    .map((x) => x.trim())
    // Short fragments match everywhere and say nothing; a sentence long enough
    // to be a rule is long enough to be evidence.
    .filter((x) => x.split(" ").length >= 8);
}

Deno.test("no surface restates a rule — they point", () => {
  // `length === 1` was not enough: it stays green when a rule MOVES out of the
  // contract into an agent, since the count is still one. Assert the location.
  // And sweep HARNESS_STATIC as well as CORE_BUNDLE — a rule pasted into an
  // always-on context file is the restatement with the widest blast radius,
  // and the count-only version was blind to that whole tree.
  const statics = Object.entries(HARNESS_STATIC).flatMap(([h, files]) =>
    Object.entries(files).map(([dest, f]) => [`${h}:${dest}`, f.content] as const)
  );
  const sentences = normativeSentences(contractEntry().content);
  assert(
    sentences.length >= 20,
    `the sweep window collapsed to ${sentences.length} sentences — broken, not clean`,
  );
  for (const sentence of sentences) {
    // Whitespace-normalised on BOTH sides: a rule restated with a different
    // line wrap is still a restatement, and exact-substring matching is what
    // let rule 5's paraphrase through in round 2.
    // Emphasis stripped on both sides: a rule copied with different bolding is
    // still a copy, and matching the raw markdown let a paraphrase through.
    const bare = (x: string) => flat(x.replace(/[*`]/g, ""));
    const core = CORE_BUNDLE.filter((e) => bare(e.content).includes(sentence)).map((e) => e.name);
    const inStatics = statics.filter(([, c]) => bare(c).includes(sentence)).map(([k]) => k);
    assertEquals(
      [...core, ...inStatics],
      [CONTRACT],
      `"${sentence}" must appear in the contract and nowhere else`,
    );
  }
});

/**
 * FR-013 — no examples. This is what plan § 7 rests the constitution § XI
 * verdict on, and it was enforced by a comment until the review said so.
 *
 * § XI protects an OPEN set — any unrelated project's name, vendor or host —
 * which no deny-list can close over. What CAN be closed over is the shape a
 * leak takes: an identifier that points outward. A contract with no URL, no
 * domain, no handle and no address has nowhere to carry one.
 */
const OUTWARD_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ["url", /https?:\/\//i],
  ["bare domain", /\b[a-z0-9-]+\.(?:com|io|dev|net|org|app|ai|co)\b/i],
  ["handle", /(?:^|\s)@[a-z0-9][a-z0-9-]{2,}/i],
  ["email", /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
];

Deno.test("the contract carries no outward-pointing identifier", () => {
  const { content } = contractEntry();
  const hits = OUTWARD_SHAPES
    .filter(([, re]) => re.test(content))
    .map(([name, re]) => `${name}: ${re.exec(content)?.[0]?.trim()}`);
  assertEquals(hits, [], "an example naming something real is a § XI incident, not a typo");
});

/** FR-014 — the scope-limiting sentence. A partial mitigation, but it is free. */
Deno.test("the contract limits its own authority", () => {
  assert(
    /confers no authority/i.test(flat(contractEntry().content)),
    "an always-on instruction file must say what it does NOT authorise",
  );
});
