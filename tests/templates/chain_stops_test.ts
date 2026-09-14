import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * #458 — the chain has exactly two stops, and it must not stall between phases.
 *
 * The rule is written in TWO places on purpose, and the reason is mechanical:
 * a phase file is only read once that phase is already running, so the rule
 * arrives *after* the decision to stop. The scaffolded `AGENTS.md` is always in
 * context, and is the only place the rule can PREVENT the stall rather than
 * describe it. A future reader will mistake this for duplication — these locks
 * are what stop them acting on that.
 *
 * The observed failure was specific: the chain stops just before implementing,
 * to ask permission it was already given at the plan stop.
 */

function phase(name: string): CoreEntry {
  const e = CORE_BUNDLE.find((x) => x.category === "phase" && skillDocName(x) === name);
  if (!e) throw new Error(`missing phase entry: ${name}`);
  return e;
}

function rootAgents(): CoreEntry {
  const e = CORE_BUNDLE.find(
    (x) => x.category === "project-root" && x.suffix === "AGENTS.md",
  );
  if (!e) throw new Error("missing root AGENTS.md entry");
  return e;
}

// The five sentences that have actually been used to stall the chain. Each must
// be refused in writing, in BOTH carriers — quoting the excuse is what lets a
// model recognise its own reasoning instead of rationalising past a generality.
const EXCUSES: ReadonlyArray<[label: string, fragment: string]> = [
  ["task count", "lot of tasks"],
  ["MVP fork", "MVP"],
  ["real code", "real code gets written"],
  ["audit scope", "re-confirm scope"],
  ["checkpointing", "checkpointing each step"],
];

Deno.test("the scaffolded AGENTS.md carries the two-stop rule — it is the always-loaded carrier", () => {
  const { content } = rootAgents();
  assertStringIncludes(content, "exactly two stops");
  assertStringIncludes(content, "no third");
  // Both stops named, so neither can be quietly dropped.
  assertStringIncludes(content, "The end of `plan`");
  assertStringIncludes(content, "The review verdict");
  assertStringIncludes(content, "no separate pre-merge stop");
  // The positive instruction, not just the prohibition.
  assertStringIncludes(content, "in the same turn");
  // Blocked-is-not-stopped, and the exit criterion.
  assertStringIncludes(content, "Genuinely blocked");
  assertStringIncludes(content, "CRITICAL or HIGH");
  // Standing merge authorisation is not re-collected.
  assertStringIncludes(content, "without a second confirmation");
});

Deno.test("AGENTS.md refuses every excuse that has been used to stall the chain", () => {
  const { content } = rootAgents();
  for (const [label, fragment] of EXCUSES) {
    assertStringIncludes(content, fragment, `AGENTS.md must refuse the "${label}" excuse`);
  }
});

Deno.test("auto-chain.md carries the same rule for the phase that is already running", () => {
  const { content } = phase("auto-chain");
  assertStringIncludes(content, "EXACTLY TWO stops");
  for (const [label, fragment] of EXCUSES) {
    assertStringIncludes(content, fragment, `auto-chain.md must refuse the "${label}" excuse`);
  }
  // The triage rule that terminates the review loop.
  assertStringIncludes(content, "does not terminate");
  assertStringIncludes(content, "would hurt a user");
});

Deno.test("every chaining phase ends by invoking the next one itself", () => {
  // The gap this closes: the instruction used to live only in auto-chain.md,
  // which a running phase may never load.
  for (const [name, next] of [["tasks", "implement"], ["implement", "review"]] as const) {
    const { content } = phase(name);
    assertStringIncludes(
      content,
      `INVOKE \`${next}\``,
      `${name}.md must end by invoking ${next} itself`,
    );
    assertStringIncludes(content, "same turn", `${name}.md must say "same turn"`);
    assert(
      content.includes("is not a stop"),
      `${name}.md must state that its closing boundary is not a stop`,
    );
  }
});

Deno.test("review.md does not re-ask between fix cycles and reports harm, not labels", () => {
  const { content } = phase("review");
  assertStringIncludes(content, "Do not ask the user between cycles");
  assertStringIncludes(content, "harm, not labels");
  assertStringIncludes(content, "valid and valuable verdict");
  assertStringIncludes(content, "does not terminate");
});
