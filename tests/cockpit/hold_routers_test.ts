import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { phaseOf } from "../../mods/specnaut-cockpit/hooks/core/chain.ts";
import { holdFor } from "../../mods/specnaut-cockpit/hooks/core/hold.ts";
import type { Window } from "../../mods/specnaut-cockpit/hooks/core/usage.ts";

/**
 * The two functions behind the quota hold's deny (cli#702), composed as
 * `register.tsx` composes them today: `phaseOf` names the phase of a Skill call,
 * `holdFor` holds it past the threshold. This is the cockpit's quota hold, not
 * the landing hold v9.1.0 removed.
 *
 * Checked: the four router names written below, before `merge`, the two pre-7.2
 * ones before `implement` and `review` too, and that a look-alike name or an
 * unguarded phase goes through. A name these functions stop recognising fails
 * open: the chain runs into the limit with nothing said.
 *
 * Not checked: the hook itself. `mods/specnaut-cockpit/tests/cockpit.test.tsx`
 * runs it, under `claude plugin test`, which `deno task test` does not run, so a
 * `register.tsx` that stopped calling these two would stay green here.
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
