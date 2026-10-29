import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * Locks the two grounding mechanisms that need no catalogue.
 *
 * Four mechanisms make an expert seat answerable for what it ships. Two of
 * them require something to point at — cite the leaf, read its negative
 * section before each finding — and belong to whichever catalogue the seat
 * has. The other two work against *whatever* source a seat has, including a
 * project's own constitution, so they apply everywhere and are asserted here
 * for the whole set at once.
 *
 * The wording is byte-identical across these seats on purpose: a sixth seat
 * should be able to copy it rather than paraphrase it, and a paraphrase is how
 * "drop it to LOW and label it" quietly becomes "mention it".
 *
 * `architect-expert` and `security-expert` carry semantically equivalent
 * phrasings from the earlier programme, worded around their own artefact
 * ("leaf", "domain file"). Harmonising those two is deliberately not done
 * here — rebuilding what that programme shipped is explicitly out of scope,
 * and both already fail their own guards if the mechanism disappears.
 */

/** The seats grounded without a catalogue of their own to key the wording to. */
const SEATS = ["performance-expert", "accessibility-expert", "dependency-expert"] as const;

/**
 * The canonical text. Presence of a heading proves nothing — a seat can carry
 * "state your sources" and never say what that means. These are the sentences
 * that make the mechanism actionable, so these are what get asserted.
 */
const MECHANISMS: Record<string, readonly string[]> = {
  "declare which sources were read": [
    "**State which sources you read**, once, at the top of the report.",
    "A skipped\nread is otherwise invisible, and the reader cannot tell a judgement from a\nguess.",
  ],
  "downgrade what cannot be cited": [
    "**Downgrade what you cannot cite.**",
    "Drop it to LOW and open its rationale with\n`Suspicion —` rather than shipping it at full confidence.",
  ],
};

function agent(name: string): string {
  const entry = CORE_BUNDLE.find((e) => e.category === "agent" && e.name === name);
  assert(entry, `${name} is missing from the bundle`);
  return entry.content;
}

Deno.test("every catalogue-free seat carries both mechanisms, with their substance", () => {
  for (const seat of SEATS) {
    const body = agent(seat);
    for (const [label, sentences] of Object.entries(MECHANISMS)) {
      for (const sentence of sentences) {
        assertStringIncludes(
          body,
          sentence,
          `${seat} is missing the "${label}" mechanism, or has paraphrased it. ` +
            `The wording is shared across seats so it can be copied, not reworded.`,
        );
      }
    }
  }
});

Deno.test("the shared block is identical across the seats, not merely similar", () => {
  const block = (body: string) => {
    const start = body.indexOf("### The two rules that need no catalogue");
    assert(start >= 0, "shared block heading is missing");
    const end = body.indexOf("\n**If ", start);
    assert(end >= 0, "shared block must be followed by the plugin-fallback line");
    return body.slice(start, end);
  };
  const [first, ...rest] = SEATS.map((s) => block(agent(s)));
  for (let i = 0; i < rest.length; i++) {
    assert(
      rest[i] === first,
      `${SEATS[i + 1]} has drifted from the canonical block. Diff:\n` +
        `--- canonical ---\n${first}\n--- ${SEATS[i + 1]} ---\n${rest[i]}`,
    );
  }
});

Deno.test("performance-expert carries the false positive that dominates its axis", () => {
  // #494 measured it: performance has one wrong finding that outnumbers the
  // rest — a recognised shape reported as a cost with nothing establishing
  // that it costs anything here. It gets its own gate rather than a catalogue.
  const body = agent("performance-expert");
  assertStringIncludes(body, "### Before every finding — did you measure?");
  for (
    const question of [
      "Is this path hot?",
      "Is the collection bounded?",
      "Is there a measurement?",
    ]
  ) {
    assertStringIncludes(
      body,
      question,
      `the measure gate must ask "${question}" — a gate with no questions is a heading`,
    );
  }
  assertStringIncludes(body, "unmeasured risk");
});

Deno.test("performance-expert is grounded in the project rather than a catalogue", () => {
  // The survey recommended against a performance catalogue: no external
  // normative source exists and the axis is the most stack-dependent of the
  // five. The seat is grounded in what the repository itself records instead.
  const body = agent("performance-expert");
  assertStringIncludes(body, "## Step 0");
  assertStringIncludes(body, "docs/constitution.md");
  assertStringIncludes(body, "standalone plugin");
  const stray = CORE_BUNDLE.filter((e) => (e.suffix ?? "").startsWith("memory/performance"));
  assert(
    stray.length === 0,
    `performance-expert is grounded in the project, not in a catalogue; ` +
      `found ${stray.length} entries under memory/performance/`,
  );
});

Deno.test("no seat still tells the reviewer to ship unmeasured findings quietly", () => {
  // The old catch-all — "surface it at LOW rather than dropping it" — is not
  // the same instruction as "drop it to LOW and label it a suspicion". Only
  // one of them lets the reader see what they are looking at, and leaving both
  // means the seat contradicts itself.
  for (const seat of SEATS) {
    assert(
      !agent(seat).includes("surface the finding at LOW rather than dropping it"),
      `${seat} still carries the pre-mechanism catch-all, which contradicts the ` +
        `downgrade rule it now also carries`,
    );
  }
});
