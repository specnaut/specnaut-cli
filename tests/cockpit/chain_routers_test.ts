import { assertEquals } from "@std/assert";
import { phaseOf } from "../../mods/specnaut-cockpit/hooks/core/chain.ts";

/**
 * Which router calls the cockpit's quota hold recognises (cli#683). The `/task`
 * router carries the pipeline since 7.2; the pre-7.2 `specnaut` router is
 * still recognised because an older plugin runs the chain there, and a quota
 * hold that stops matching fails open. Split out of core_test.ts, which was
 * over its size target when cli#683 had to add to it.
 */

Deno.test("a task Skill call names its phase, flags and plugin scope aside", () => {
  assertEquals(phaseOf("task", "implement"), "implement");
  assertEquals(phaseOf("task", "--manual merge --no-close"), "merge");
  assertEquals(phaseOf("specnaut-plugin:task", "merge"), "merge");
  assertEquals(phaseOf("task", "audit --security"), null);
  assertEquals(phaseOf("task", "groom"), null);
  assertEquals(phaseOf("someone-else:task", "merge"), null, "another plugin's skill of that name");
});

Deno.test("the pre-7.2 specnaut router still names its phase — an older plugin runs the chain there", () => {
  assertEquals(phaseOf("specnaut", "implement"), "implement");
  assertEquals(phaseOf("specnaut", "--manual merge --no-close"), "merge");
  assertEquals(phaseOf("specnaut-plugin:specnaut", "review"), "review");
  assertEquals(phaseOf("specnaut", "audit security"), null);
  assertEquals(phaseOf("specnaut", ""), null);
  assertEquals(phaseOf("board", "merge"), null);
  assertEquals(phaseOf("not-specnaut", "merge"), null);
  assertEquals(
    phaseOf("someone-else:specnaut", "merge"),
    null,
    "another plugin's skill of that name",
  );
});
