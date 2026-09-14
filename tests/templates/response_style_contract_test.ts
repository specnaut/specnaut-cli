import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * SHAPE and SINGLE-SOURCING for the response-style contract (#575).
 *
 * Reach lives in `response_style_reach_test.ts`. This file asks a different
 * question: does the contract SAY what it was required to say, is it the only
 * place that says it, and is the set of surfaces that point at it derived rather
 * than remembered.
 */

const CONTRACT = "response-style-contract";

/**
 * A `CoreEntry` has no path. Its identity is category + name + suffix, so that
 * triple is what every list below keys on — never a path string, which would be
 * a second spelling of the manifest.
 */
function id(e: CoreEntry): string {
  return e.suffix ? `${e.category}/${e.name}/${e.suffix}` : `${e.category}/${e.name}`;
}

const SOURCE = `skill/${CONTRACT}`;

function contractEntry(): CoreEntry {
  const e = CORE_BUNDLE.find((x) => x.category === "skill" && x.name === CONTRACT);
  assert(
    e,
    `${CONTRACT} is not in CORE_BUNDLE — an authored template that is not ` +
      "manifest-registered renders for nobody",
  );
  return e!;
}

/** Collapse whitespace so an assertion survives a `deno fmt` rewrap. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// The file itself
// ---------------------------------------------------------------------------

Deno.test("the contract is registered, preloaded, and not user-invocable", () => {
  const { content } = contractEntry();
  assert(content.includes("user-invocable: false"), "a style contract must never be invocable");
});

Deno.test("the contract's frontmatter grants no tools", () => {
  // Closed by construction rather than by luck. A preloaded file that could
  // declare `tools:` would be a privilege channel wearing a style contract's
  // name — and this one is delivered to every project, always on.
  const { content } = contractEntry();
  const frontmatter = content.split("---")[1] ?? "";
  for (const key of ["tools:", "allowed-tools:", "permissionMode:"]) {
    assert(!frontmatter.includes(key), `the contract's frontmatter declares ${key}`);
  }
});

// ---------------------------------------------------------------------------
// What it must say
// ---------------------------------------------------------------------------

/** Each row is a requirement that must be legible in the contract's own text. */
const NORMATIVE: ReadonlyArray<[string, string]> = [
  [
    "FR-006 the badge rule",
    "A badge describes the state at the time of reading, not the path taken",
  ],
  ["FR-007 lead with the outcome", "The first line carries the outcome"],
  ["FR-008 the carrier", "emoji glyph in Markdown"],
  ["FR-008 never ANSI", "never requires an escape sequence"],
  ["FR-028 ask the verdict", "a `fail` is 🔴, a `needs_followup` is 🟠, a `pass` is 🟢"],
  ["FR-029 worst-of", "A summary badge is the worst of what it summarises"],
  ["FR-010 blocks are untouched", "A badge never goes inside one"],
  ["FR-030 brevity limit", "Brevity removes restatement — never substance"],
  ["FR-030 precedence", "the block-defining contract wins"],
  ["FR-009 selection", "A question to the user is a **selection**, not an open prompt"],
  ["FR-009 degradation", "the portable fallback is a short numbered list"],
  ["FR-012 scope", "confers no authority to run commands"],
  ["FR-027 no examples", "no worked example naming anything real"],
  ["FR-033 delivered copies", "A modified copy is the project's own"],
];

Deno.test("the contract states every rule it was required to state", () => {
  const body = flat(contractEntry().content);
  const missing = NORMATIVE.filter(([, s]) => !body.includes(flat(s))).map(([name]) => name);
  assertEquals(missing, [], "requirements with no sentence in the contract");
});

Deno.test("the badge table has exactly the four declared rows", () => {
  const { content } = contractEntry();
  // Asserted as four ROWS with their meanings, not as "a table exists" — the
  // vocabulary is the deliverable, and a table with three rows or five would
  // satisfy a looser check while meaning something different.
  const rows: ReadonlyArray<[string, string]> = [
    ["🟢", "Success"],
    ["🔵", "Information"],
    ["🟠", "Warning"],
    ["🔴", "Failure"],
  ];
  for (const [glyph, meaning] of rows) {
    const line = content.split("\n").find((l) => l.startsWith(`| ${glyph} |`));
    assert(line, `no table row for ${glyph}`);
    assert(line!.includes(meaning), `the ${glyph} row does not say ${meaning}: ${line}`);
  }
  const glyphRows = content.split("\n").filter((l) => /^\| (🟢|🔵|🟠|🔴) \|/.test(l));
  assertEquals(glyphRows.length, 4, "the badge table must carry exactly four rows");
});

// ---------------------------------------------------------------------------
// § XI — the precondition, then the sweep
// ---------------------------------------------------------------------------

/**
 * FR-027 is the precondition; this is the second layer.
 *
 * § XI protects an OPEN set — any unrelated project's name, vendor or host —
 * which no deny-list can close over. What CAN be closed over is the shape a leak
 * takes. The sweep is only sufficient because the contract carries no example
 * with anywhere to put one; asserting the sweep without the precondition would
 * be borrowing the instrument and leaving the reason behind.
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

// ---------------------------------------------------------------------------
// Single-sourcing
// ---------------------------------------------------------------------------

/** Every authored core template plus every always-on harness static. */
function authoredSurfaces(): Array<{ id: string; content: string }> {
  const out = CORE_BUNDLE.map((e) => ({ id: id(e), content: e.content }));
  for (const [harness, files] of Object.entries(HARNESS_STATIC)) {
    for (const [dest, f] of Object.entries(files)) {
      out.push({ id: `${harness}:${dest}`, content: f.content });
    }
  }
  return out;
}

Deno.test("nothing restates the contract's prose", () => {
  // AC 2: referenced, never restated. Sentences distinctive enough that an
  // accidental match would itself be a restatement.
  const distinctive = [
    "A badge describes the state at the time of reading",
    "A summary badge is the worst of what it summarises",
    "Brevity removes restatement — never substance",
  ];
  for (const sentence of distinctive) {
    const carriers = authoredSurfaces()
      .filter((s) => flat(s.content).includes(flat(sentence)))
      .map((s) => s.id);
    assertEquals(carriers, [SOURCE], `"${sentence}" must appear in the contract and nowhere else`);
  }
});

Deno.test("the selection rule is stated once and pointed at everywhere else", () => {
  // FR-038. SC-002 as originally written asked only whether the CONTRACT's own
  // sentences appear once — it would have gone green on six spellings of a rule
  // the contract owns. This sweeps for the rule's SHAPE instead.
  // The shapes were originally `/one question at a time/i` plus a
  // multiple-choice variant — a GUESS at how the rule gets written, and it
  // missed six occurrences that say "questions ... asked one at a time" with the
  // words in the other order. A guess at a shape is the same defect as a
  // hand-written list. Match the phrase itself and let the pointer exemption do
  // the discriminating.
  const SHAPES = [/one at a time/i, /multiple[- ]choice/i];
  // The phrase alone over-matches: "process tickets one at a time" is an
  // unrelated use of it. The rule is about QUESTIONS, so the line must be about
  // questions too. A tighter word, not an exclusion recording a decision nobody
  // took.
  const ABOUT_QUESTIONS = /question|ask/i;
  const offenders: string[] = [];
  for (const surface of authoredSurfaces()) {
    if (surface.id === SOURCE) continue;
    for (const line of surface.content.split("\n")) {
      if (!SHAPES.some((re) => re.test(line))) continue;
      if (!ABOUT_QUESTIONS.test(line)) continue;
      // A line may name the rule only while pointing at its owner.
      if (line.includes(CONTRACT)) continue;
      offenders.push(`${surface.id}: ${line.trim().slice(0, 90)}`);
    }
  }
  assertEquals(offenders, [], "the selection rule is restated instead of pointed at");
});

// ---------------------------------------------------------------------------
// Which surfaces must point here — derived, with every departure written down
// ---------------------------------------------------------------------------

/**
 * FR-034. The REQUIRED set is fully derived and needs no list: the always-on
 * harness context files plus the root `AGENTS.md` fence. Those are what make the
 * contract reach a turn nobody invoked.
 *
 * Anything else that points here, or that looks like an entry point and
 * deliberately does not, is a DECISION — and a decision carries a written
 * reason. An entry with an empty reason is not an exclusion.
 */
const POINTED_BY_DECISION: ReadonlyMap<string, string> = new Map([
  [
    "skill/specnaut",
    "the workflow router — #575 names it as an anchor; it has room and every phase it dispatches answers a person",
  ],
  [
    "skill/ship",
    "the production verb — it asks a disambiguation question when the repository cannot resolve the intent, so questions-as-selections is load-bearing rather than incidental; and unlike /board it has ~6,500 characters of Windsurf headroom, so the pointer costs nothing it needs",
  ],
  [
    "skill/using-specnaut",
    "the on-demand route for copilot and opencode, whose only static entry is .specnaut/harness-tools.md",
  ],
  [
    "skill/brainstorming",
    "owned the selection rule until #575; it now points at the owner instead of restating it",
  ],
  [
    "phase/specnaut/plan.md",
    "same — two restatements of the selection rule replaced by pointers",
  ],
]);

/** An entry-point skill that deliberately does NOT point here. */
const WITHHELD_BY_DECISION: ReadonlyMap<string, string> = new Map([
  [
    "board",
    "settled at #575's plan stop: its worst-case Windsurf render leaves 38 characters and the pointer costs 98. /board is reached by the always-on leg, which is in force before the skill fires.",
  ],
  ...(["a11y-audit", "arch-audit", "dep-audit", "perf-audit", "sec-audit", "code-audit"].map((
    n,
  ) =>
    [
      n,
      "a thin dispatcher — the expert seat it dispatches answers the user, and reaches the contract by the same always-on leg",
    ] as [string, string]
  )),
  [
    "status-audit",
    "read-only reporter over a log file; reached by the always-on leg like any other turn",
  ],
]);

/**
 * A user-facing entry point, derived from CONTENT: a skill whose frontmatter
 * declares `argument-hint`, which is what a harness reads to offer it as a
 * command the user types with arguments. Derived from a field this feature does
 * not edit, so it cannot go stale in step with the edit.
 */
function entryPointSkills(): string[] {
  return CORE_BUNDLE
    .filter((e) => (e.category === "skill" || e.category === "backlog-skill") && e.suffix === null)
    .filter((e) => /^argument-hint:/m.test(e.content))
    .map((e) => e.name);
}

Deno.test("every surface pointing at the contract is required or has a written reason", () => {
  // Only CORE_BUNDLE is walked here. The always-on harness statics live in
  // HARNESS_STATIC and are keyed by destination path, so they can never appear
  // in this set — an earlier revision filtered against them anyway, which was a
  // clause that could not fire and read as coverage it did not provide.
  const undeclared = CORE_BUNDLE
    .filter((e) => id(e) !== SOURCE && e.content.includes(CONTRACT))
    .map(id)
    // The root AGENTS.md fence is required, not a decision.
    .filter((x) => x !== "project-root/root/AGENTS.md")
    .filter((x) => !POINTED_BY_DECISION.get(x)?.trim());
  assertEquals(undeclared, [], "surfaces pointing at the contract with no recorded reason");
});

Deno.test("every entry-point skill either points here or says why not", () => {
  const silent = entryPointSkills()
    .filter((name) => {
      const e = CORE_BUNDLE.find((x) => x.name === name && x.suffix === null);
      return !e?.content.includes(CONTRACT);
    })
    .filter((name) => !WITHHELD_BY_DECISION.get(name)?.trim());
  assertEquals(silent, [], "entry-point skills that neither point at the contract nor excuse it");
});

Deno.test("a carve-out cannot outlive its subject", () => {
  // The fossil this prevents: an exclusion naming a file that was deleted or
  // that stopped being an entry point two releases ago, still sitting in the
  // list, still reading as a considered decision.
  const entryPoints = new Set(entryPointSkills());
  const stale = [...WITHHELD_BY_DECISION.keys()].filter((n) => !entryPoints.has(n));
  assertEquals(stale, [], "withheld entries naming something that is no longer an entry point");

  // A register is not a gate. This asked only whether the key still named a
  // file — so deleting the pointer it records left the whole suite green, twice
  // over, measured. An entry is a claim that the surface POINTS; assert the
  // claim, not the filename.
  const byId = new Map(CORE_BUNDLE.map((e) => [id(e), e]));
  const notPointing = [...POINTED_BY_DECISION.keys()]
    .filter((x) => !byId.get(x)?.content.includes(CONTRACT));
  assertEquals(
    notPointing,
    [],
    "recorded pointers naming a file that is gone, or that no longer points at the contract",
  );
});

Deno.test("the AGENTS.md template carries a pointer, never the contract's prose", () => {
  const root = CORE_BUNDLE.find((e) => e.category === "project-root" && e.suffix === "AGENTS.md");
  assert(root, "no project-root AGENTS.md entry");
  assert(root!.content.includes(CONTRACT), "AGENTS.md does not reference the contract");
  const body = flat(root!.content);
  for (const [, sentence] of NORMATIVE) {
    assert(
      !body.includes(flat(sentence)),
      `AGENTS.md restates the contract instead of pointing at it: "${sentence}"`,
    );
  }
});
