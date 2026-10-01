import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * #458 — the chain must not stall between phases. Since autopilot became the
 * default it stops once, at the plan; the review verdict is a second stop only
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

Deno.test("the scaffolded AGENTS.md carries the stop rule — it is the always-loaded carrier", () => {
  const { content } = rootAgents();
  assertStringIncludes(content, "runs on autopilot after the plan");
  // Both stops named, and the second tied to the opt-in that creates it.
  assertStringIncludes(content, "The end of `plan`");
  assertStringIncludes(content, "The review verdict — only under `merge: manual`");
  assertStringIncludes(content, ".specnaut/workflow.yml");
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

Deno.test("AGENTS.md refuses every excuse that has been used to stall the chain", () => {
  const { content } = rootAgents();
  for (const [label, fragment] of EXCUSES) {
    assertStringIncludes(content, fragment, `AGENTS.md must refuse the "${label}" excuse`);
  }
});

Deno.test("auto-chain.md carries the same rule for the phase that is already running", () => {
  const { content } = phase("auto-chain");
  assertStringIncludes(content, "Autopilot is the default. There is ONE stop");
  // D4: the mode has one reader, at the review→merge boundary.
  assertStringIncludes(content, "read **here and nowhere\n   else**");
  // D5: the per-run override comes first.
  assertStringIncludes(content, "`--manual-merge`");
  // D2: remote mode keeps its merge gate whatever the mode.
  assertStringIncludes(content, "remote mode keeps its gate under either mode");
  // D1: autopilot is not a licence to press on through a blocker.
  for (const halt of ["a FAIL verdict", "a missing review\nseat", "a refused push"]) {
    assertStringIncludes(content, halt);
  }
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

Deno.test("review, merge and merge-close follow the merge mode instead of always asking", () => {
  const review = phase("review").content;
  assertStringIncludes(
    review,
    "under `auto` (the default) invoke `/specnaut merge` in the same turn",
  );
  const merge = phase("merge").content;
  // D6: merge never asks about the push; D4: it does not read the mode itself.
  assertStringIncludes(merge, "push without asking, in either merge mode");
  assert(!merge.includes("workflow.yml"), "merge.md must not read the merge mode (one reader)");
  // D7: a rejected push is never forced or rebased, and nothing closes.
  assertStringIncludes(merge, "never `--force`, never an automatic rebase");
  assertStringIncludes(merge, "the close below does not run");
  // The multi-branch case lost its "no" answer; --no-close replaces it.
  assertStringIncludes(merge, "`--no-close`");
  const close = phase("merge-close").content;
  assertStringIncludes(close, "**Do not ask.** The push was the authorisation");
});

Deno.test("the plan stop announces that nothing after it asks again", () => {
  const { content } = phase("plan");
  assertStringIncludes(content, "the chain's one\nmandatory stop");
  assertStringIncludes(content, "ask here what autopilot would otherwise settle alone");
  // D10: what autopilot would decide alone is named, and discovery needs an acceptance check.
  assertStringIncludes(content, "the base branch, anything irreversible or destructive");
  assertStringIncludes(content, "how acceptance is checked");
});

Deno.test("the router parses --manual-merge without making it a chain flag", () => {
  const router = CORE_BUNDLE.find((x) => x.category === "skill" && x.name === "specnaut");
  if (!router) throw new Error("missing /specnaut router");
  assertStringIncludes(router.content, "[--manual] [--manual-merge] <phase> [rest]");
  assertStringIncludes(router.content, "It does not stop the chain\n   anywhere else.");
});

/**
 * The reader is a shell snippet inside a phase doc, so its contract is only
 * real if the snippet runs. Extract it from auto-chain.md and execute it
 * against each shape of `.specnaut/workflow.yml` (D3).
 */
Deno.test("the merge-mode reader in auto-chain.md resolves every file shape (D3)", async () => {
  const content = phase("auto-chain").content;
  const block = content.match(/```\n {3}(v=\$\(sed[\s\S]*?esac)\n {3}```/);
  if (!block) throw new Error("merge-mode reader block not found in auto-chain.md");
  const script = block[1].replaceAll("\n   ", "\n");
  const cases: ReadonlyArray<[file: string | null, want: string]> = [
    [null, "auto"],
    ["other: 1\n", "auto"],
    ["# merge: manual\n", "auto"],
    ["merge: auto\n", "auto"],
    ["merge: manual\n", "manual"],
    ["merge:manual  # a comment\n", "manual"],
    ["merge: manul\n", "manual (unrecognised: manul)"],
  ];
  for (const [file, want] of cases) {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/.specnaut`);
      if (file !== null) await Deno.writeTextFile(`${dir}/.specnaut/workflow.yml`, file);
      const out = await new Deno.Command("bash", { args: ["-c", script], cwd: dir }).output();
      assertEquals(
        new TextDecoder().decode(out.stdout).trim(),
        want,
        `file: ${JSON.stringify(file)}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("workflow.yml ships with merge: auto as the scaffolded default", () => {
  const e = CORE_BUNDLE.find((x) => x.category === "spec-root" && x.suffix === "workflow.yml");
  if (!e) throw new Error("missing .specnaut/workflow.yml entry");
  assert(/^merge: auto$/m.test(e.content), "workflow.yml must default to `merge: auto`");
  assertStringIncludes(e.content, "merge: manual");
});
