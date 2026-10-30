import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";

/**
 * A `/goal` example ships into every user project, so it names nothing of
 * Specnaut's own (cli#687): the AGENTS.md example once read "the Ready column
 * on the Specnaut Project is empty and deno task test exits 0". Swept over every
 * bundled file rather than the one that held it, so a copy landing anywhere
 * else is caught too; no version either (constitution § VIII).
 */

const GOAL_SPAN = /`\/goal ([^`]+)`/g;
const SPECNAUT_OWN = /specnaut|deno task|ready column|\bboard\b|v?\d+\.\d+/i;

const shipped = (): Array<{ where: string; content: string }> => [
  ...CORE_BUNDLE.map((e) => ({ where: `${e.category}/${e.name}/${e.suffix}`, content: e.content })),
  ...Object.entries(HARNESS_STATIC).flatMap(([h, files]) =>
    Object.entries(files).map(([dest, f]) => ({ where: `${h}:${dest}`, content: f.content }))
  ),
];

Deno.test("every bundled /goal example is generic", () => {
  const examples: string[] = [];
  const leaks: string[] = [];
  for (const { where, content } of shipped()) {
    for (const [, condition] of content.matchAll(GOAL_SPAN)) {
      // `<condition>` and the bare sub-commands are syntax, not examples.
      if (condition.startsWith("<") || !condition.includes(" ")) continue;
      examples.push(condition);
      if (SPECNAUT_OWN.test(condition)) leaks.push(`${where}: /goal ${condition}`);
    }
  }
  // The sweep found the examples it judges, so a green run is not an empty one.
  assert(examples.length > 0, "no /goal example in the bundle: the sweep saw nothing");
  assertEquals(leaks, []);
});
