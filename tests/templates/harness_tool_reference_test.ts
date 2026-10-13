import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import type { Harness } from "../../src/application/ports.ts";

/**
 * `using-specnaut/SKILL.md` tells the agent to read a tool-name mapping before
 * invoking anything. For a long time it named `references/<harness>-tools.md`,
 * files that were authored but never registered — so every scaffolded project
 * shipped an instruction pointing at nothing (#441).
 *
 * The fix hinges on a fact the old text obscured: `specnaut init --ai <harness>`
 * fixes the harness at scaffold time, so exactly ONE mapping is ever relevant.
 * It ships at a harness-neutral path, `.specnaut/harness-tools.md`, which also
 * sidesteps the folder/flat split — Copilot flattens a skill into a single
 * file and have nowhere to put a `references/` directory.
 *
 * The plugin distribution is the other case: there the harness is unknown, so
 * all five references ship side by side and the agent detects its own. Both
 * paths are described in the skill, and both must actually resolve.
 */

const SCAFFOLDED_PATH = ".specnaut/harness-tools.md";

/** Harnesses with a recorded tool mapping. */
const MAPPED = ["claude", "codex", "copilot", "cursor", "opencode"] as const;

/**
 * What a harness actually writes into a project. Asserting on HARNESS_STATIC
 * instead would be testing the wrong layer: four harnesses did not read it at
 * all, so an entry could be registered, pass every check, and reach nobody.
 */
function scaffolded(h: Harness): Record<string, { content: string }> {
  return h.mapBundle([], { backend: "local" } as never) as Record<
    string,
    { content: string }
  >;
}

function harness(key: string): Harness {
  const h = HARNESSES.find((x) => x.key === key);
  assert(h, `harness ${key} is not registered`);
  return h;
}

function skill(name: string) {
  const e = CORE_BUNDLE.find(
    (x) => (x.category === "skill" || x.category === "backlog-skill") && x.name === name,
  );
  assert(e, `skill ${name} missing from CORE_BUNDLE`);
  return e;
}

Deno.test("every mapped harness scaffolds its tool reference", () => {
  for (const h of MAPPED) {
    const file = scaffolded(harness(h))[SCAFFOLDED_PATH];
    assert(file, `${h} must scaffold ${SCAFFOLDED_PATH}`);
    assert(file.content.length > 0, `${h}'s tool reference is empty`);
  }
});

Deno.test("each harness gets its own mapping, not another's", () => {
  // A copy-paste in the manifest would be invisible otherwise: the file would
  // ship, the guard would pass, and the agent would read the wrong tool names.
  for (const h of MAPPED) {
    const content = scaffolded(harness(h))[SCAFFOLDED_PATH].content;
    const others = MAPPED.filter((o) => o !== h);
    const matchesOwn = new RegExp(h, "i").test(content);
    assert(matchesOwn, `${h}'s scaffolded reference does not mention ${h}`);
    // The baseline (claude) is legitimately cited by the others as the
    // reference point they map away from, so only assert the reverse.
    if (h === "claude") {
      for (const o of others) {
        assert(
          !new RegExp(`^#\\s.*${o}`, "im").test(content),
          `claude's reference is titled for ${o}`,
        );
      }
    }
  }
});

Deno.test("harnesses with no mapping ship none, and the skill says so", () => {
  // Antigravity has no recorded mapping. Shipping nothing is
  // correct — what would be wrong is an instruction to read a file that is not
  // there, which is the original defect.
  const unmapped = HARNESSES.map((h) => h.key).filter(
    (k) => !(MAPPED as readonly string[]).includes(k),
  );
  assert(unmapped.length > 0, "expected at least one unmapped harness");
  for (const k of unmapped) {
    assert(
      !scaffolded(harness(k))[SCAFFOLDED_PATH],
      `${k} has no recorded mapping and must not ship one`,
    );
  }

  const body = skill("using-specnaut").content;
  assertStringIncludes(
    body,
    "If neither path yields a file",
    "the skill must state what to do when no mapping exists, or an unmapped " +
      "harness is left with a dangling instruction — the original defect",
  );
});

Deno.test("the skill names both distributions' paths", () => {
  const body = skill("using-specnaut").content;
  // Scaffolded: one file, already correct for this project.
  assertStringIncludes(body, SCAFFOLDED_PATH);
  // Plugin: all five side by side, agent detects its own.
  assertStringIncludes(body, "references/{claude,codex,cursor,opencode,copilot}-tools.md");
});

Deno.test("the skill no longer points at an unqualified references/ path", () => {
  // The original defect was `references/<harness>-tools.md` written as though
  // it always resolved. Every surviving mention must sit in the plugin branch.
  const body = skill("using-specnaut").content;
  const mentions = [...body.matchAll(/`references\/[^`]+`/g)].map((m) => m[0]);
  assertEquals(
    mentions,
    ["`references/{claude,codex,cursor,opencode,copilot}-tools.md`"],
    "a references/ path is named outside the plugin-distribution branch",
  );
});
