import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";

/**
 * cli#679 (FR-008) — the keep-list for the always-on file.
 *
 * The cut that slimmed `AGENTS.md` removed reference prose and a catalogue of
 * excuses; it was not allowed to remove a rule. The rules below are written as
 * sentences, and a sentence is invisible to a grep for scripts or headings — so
 * each is pinned by its words, in the file as the two design-target harnesses
 * actually receive it, not in the template before rendering.
 *
 * The version-pin absence is here because the always-on file is read every
 * session: a harness version written into it is a claim that goes stale on the
 * harness's own release schedule, not on Specnaut's (constitution § VIII).
 */

const KEEP: ReadonlyArray<[rule: string, words: string]> = [
  ["the plan stop's scope", "irreversible, destructive, public-breaking or costly"],
  [
    "the merge: manual hook",
    "under `merge: manual` a hook holds every landing on the base branch until the user's own " +
    "prompt in that turn says `merge`",
  ],
  ["no stale release", 'a "yes", or a "merge it" from an earlier turn, does not release it'],
  ["the hook is not bypassed", "When the hook refuses, say what to type; never route around it."],
  ["the review loop ends", "Only a CRITICAL or HIGH finding buys another fix cycle"],
];

/** Wrapping is not wording: a lock pins the words of a rule, never where a line broke. */
const flat = (text: string) => text.replace(/\s+/g, " ").replaceAll("**", "");

function rendered(harnessKey: string): string {
  const harness = HARNESSES.find((h) => h.key === harnessKey);
  if (!harness) throw new Error(`unknown harness ${harnessKey}`);
  const file = harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    specAutogen: false,
  })["AGENTS.md"];
  if (!file) throw new Error(`${harnessKey} scaffolds no AGENTS.md`);
  return file.content;
}

for (const harness of ["claude", "codex"]) {
  Deno.test(`the ${harness} AGENTS.md keeps every must-hold rule of the chain`, () => {
    const text = flat(rendered(harness));
    for (const [rule, words] of KEEP) {
      assertStringIncludes(text, words, `${harness}: "${rule}" left the always-on file`);
    }
  });

  Deno.test(`the ${harness} AGENTS.md pins no version`, () => {
    const pins = rendered(harness).match(/v[0-9]+\.[0-9]+/g) ?? [];
    assert(pins.length === 0, `${harness}: version pins in AGENTS.md: ${pins.join(", ")}`);
  });
}
