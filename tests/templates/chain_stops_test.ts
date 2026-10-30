import { assert, assertStringIncludes } from "@std/assert";
import { flat, phase, rootAgents } from "./task_docs.ts";

/**
 * #458 — the chain must not stall between phases. Since autopilot became the
 * default it stops at most once, at the plan, and only for a question the user
 * alone can answer (#630); the review verdict is a second stop only
 * under `merge: manual`.
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

// The five sentences that have actually been used to stall the chain, each refused in writing —
// quoting one lets a model recognise its own reasoning. One home since cli#679: auto-chain.md.
const EXCUSES: ReadonlyArray<[label: string, fragment: string]> = [
  ["task count", "lot of tasks"],
  ["MVP fork", "MVP"],
  ["real code", "real code gets written"],
  ["audit scope", "re-confirm scope"],
  ["checkpointing", "checkpointing each step"],
];

Deno.test("the scaffolded AGENTS.md carries the stop rule — it is the always-loaded carrier", () => {
  const { content } = rootAgents();
  assertStringIncludes(content, "runs on autopilot after the plan");
  // Both stops named, and the second tied to the opt-in that creates it.
  assertStringIncludes(content, "The end of `plan`");
  assertStringIncludes(content, "The review verdict — only under `merge: manual`");
  assertStringIncludes(content, ".specnaut/workflow.yml");
  // D3 (spec 036): a hook enforces the file; a "yes" or an earlier "merge it" does not release it.
  assertStringIncludes(content, "The file is enforced, not just read");
  assertStringIncludes(content, "naming the word to reply");
  // Under the default the merge and the push are not asked for.
  assertStringIncludes(content, "`merge` and the push are automatic");
  // The positive instruction, not just the prohibition.
  assertStringIncludes(content, "in the same turn");
  // Blocked-is-not-stopped, and the exit criterion.
  assertStringIncludes(content, "Genuinely blocked");
  assertStringIncludes(content, "CRITICAL or HIGH");
  // Standing merge authorisation is not re-collected.
  assertStringIncludes(content, "without a second confirmation");
});

Deno.test("the excuse catalogue has one home, and it is not the always-on file (cli#679)", () => {
  const { content } = rootAgents();
  assert(!content.includes("| The excuse |"), "AGENTS.md restates the excuse table");
  for (const [label, fragment] of EXCUSES) {
    assert(!content.includes(fragment), `AGENTS.md restates the "${label}" excuse`);
  }
});

Deno.test("auto-chain.md carries the same rule for the phase that is already running", () => {
  const content = flat(phase("auto-chain").content);
  assertStringIncludes(content, "Autopilot is the default. There is ONE stop");
  // D4: the mode has one reader, at the review→merge boundary.
  assertStringIncludes(content, "read here and nowhere else");
  // D5: the per-run override comes first.
  assertStringIncludes(content, "`--manual-merge`");
  // D3 (spec 036): the per-run override moves the chain, never the hook; STOP 2 names the word.
  assertStringIncludes(content, "a hook holds the landing whatever the run said");
  assertStringIncludes(content, "Reply `merge` to land it");
  // D2: remote mode keeps its merge gate whatever the mode — and the check stays here (spec 041).
  assertStringIncludes(content, "remote mode keeps its gate under either mode");
  assertStringIncludes(content, "`specnaut gate status` exits 0), read `phases/remote-gates.md`");
  // D1: autopilot is not a licence to press on through a blocker.
  for (const halt of ["a FAIL verdict", "a missing review seat", "a refused push"]) {
    assertStringIncludes(content, halt);
  }
  for (const [label, fragment] of EXCUSES) {
    assertStringIncludes(content, fragment, `auto-chain.md must refuse the "${label}" excuse`);
  }
  // The triage rule that terminates the review loop.
  assertStringIncludes(content, "does not terminate");
  assertStringIncludes(content, "would hurt a user");
});

Deno.test("remote-gates.md raises both approvals and never proceeds without one", () => {
  const content = flat(phase("remote-gates").content);
  assertStringIncludes(content, "Remote mode keeps its gate under either mode");
  assertStringIncludes(content, "--type plan_approval");
  assertStringIncludes(content, "--type merge_approval");
  assertStringIncludes(content, "Never proceed to `implement` without an explicit approval.");
  assertStringIncludes(content, "Never merge without an explicit approval.");
});

Deno.test("every chaining phase ends by invoking the next one itself", () => {
  // The gap this closes: the instruction used to live only in auto-chain.md,
  // which a running phase may never load.
  for (const [name, next] of [["plan", "implement"], ["implement", "review"]] as const) {
    const content = flat(phase(name).content);
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

Deno.test("the plan stop announces that nothing after it asks again", () => {
  const content = flat(phase("plan").content);
  assertStringIncludes(content, "the chain's last chance to ask");
  assertStringIncludes(content, "ask here what autopilot would otherwise settle alone");
  // D10: what autopilot would decide alone is named, and discovery needs an acceptance check.
  assertStringIncludes(content, "always: the base branch, anything irreversible or");
  assertStringIncludes(content, "how acceptance is checked");
});
