import { assertEquals } from "@std/assert";
import { phaseOf, phaseOfPrompt } from "../../mods/specnaut-cockpit/hooks/core/chain.ts";

/**
 * Which routers the cockpit's chain tracker recognises (cli#683). The `/task`
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

Deno.test("a typed /task prompt names its phase", () => {
  assertEquals(phaseOfPrompt('/task plan "Add OAuth2 login"'), "plan");
  assertEquals(phaseOfPrompt("/specnaut-plugin:task merge"), "merge");
  assertEquals(phaseOfPrompt("/task"), null);
  assertEquals(phaseOfPrompt("please run /task plan"), null);
  assertEquals(phaseOfPrompt("/tasks plan"), null);
  assertEquals(phaseOfPrompt("/taskx merge"), null);
});

Deno.test("a typed pre-7.2 /specnaut prompt names its phase", () => {
  assertEquals(phaseOfPrompt('/specnaut plan "Add OAuth2 login"'), "plan");
  assertEquals(phaseOfPrompt("/specnaut-plugin:specnaut merge"), "merge");
  assertEquals(phaseOfPrompt("/specnaut"), null);
  assertEquals(phaseOfPrompt("please run /specnaut plan"), null);
  assertEquals(phaseOfPrompt("/specnautx plan"), null);
  assertEquals(phaseOfPrompt("/someone-else:specnaut merge"), null);
});
