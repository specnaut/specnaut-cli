import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { phaseOf } from "../../mods/specnaut-cockpit/hooks/core/chain.ts";
import { holdFor } from "../../mods/specnaut-cockpit/hooks/core/hold.ts";
import type { Window } from "../../mods/specnaut-cockpit/hooks/core/usage.ts";

/**
 * The quota hold's deny, from the Skill call the engine hands the hook to the
 * reason it refuses with, for every router the chain runs under (cli#702).
 *
 * `register.tsx` denies a Skill call when `phaseOf(skill, args)` names a phase
 * and `holdFor` holds it. `mods/specnaut-cockpit/tests/cockpit.test.tsx` runs
 * that hook for real, but only under `claude plugin test`, which `deno task
 * test` does not run; this is the same decision, composed exactly as the hook
 * composes it, so the plugin-scoped and pre-7.2 router names cannot fall out
 * of the hold unseen. A router the hold stops matching fails open: the chain
 * runs into the limit with nothing said.
 */

const NOW = Date.parse("2026-10-06T12:00:00Z");
const OVER: Window[] = [{
  kind: "five_hour",
  percentUsed: 93,
  resetsAt: new Date(NOW + 65 * 60_000).toISOString(),
}];

/** What the Skill hook answers: the deny reason, or `null` when the call goes through. */
function denyOf(skill: string, args: string): string | null {
  const phase = phaseOf(skill, args);
  return phase === null ? null : holdFor(phase, OVER, 90, {}, NOW)?.reason ?? null;
}

Deno.test("every chain router is held before merge, its plugin scope and flags aside", () => {
  for (const skill of ["task", "specnaut-plugin:task", "specnaut", "specnaut-plugin:specnaut"]) {
    for (const args of ["merge", "--manual merge --no-close"]) {
      const deny = denyOf(skill, args);
      assert(deny !== null, `${skill} ${args}: not held — the chain would run into the limit`);
      assertStringIncludes(deny, "quota hold before `merge`");
    }
  }
});

Deno.test("the pre-7.2 router is held before implement and review too", () => {
  for (const phase of ["implement", "review"]) {
    assertStringIncludes(denyOf("specnaut", phase) ?? "", `quota hold before \`${phase}\``);
    assertStringIncludes(
      denyOf("specnaut-plugin:specnaut", phase) ?? "",
      `quota hold before \`${phase}\``,
    );
  }
});

Deno.test("another plugin's skill of a chain router's name is never denied", () => {
  for (const skill of ["someone-else:task", "someone-else:specnaut", "board", "tasks"]) {
    assertEquals(denyOf(skill, "merge"), null, skill);
  }
  assertEquals(denyOf("specnaut-plugin:task", "plan"), null, "plan is never guarded");
  assertEquals(denyOf("specnaut-plugin:task", "audit --security"), null);
});
