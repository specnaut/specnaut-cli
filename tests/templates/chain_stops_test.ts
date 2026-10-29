import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, fromFileUrl } from "@std/path";
import { walk } from "@std/fs";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

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

/** A pipeline phase doc — `/task`'s since cli#683. */
function phase(name: string): CoreEntry {
  const e = CORE_BUNDLE.find((x) =>
    x.category === "phase" && x.name === "task" && skillDocName(x) === name
  );
  if (!e) throw new Error(`missing phase entry: ${name}`);
  return e;
}

/** A document's text with every whitespace run folded to one space, so a lock pins the words of a
 * rule and not where a line happened to wrap. */
const flat = (text: string) => text.replace(/\s+/g, " ");

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

Deno.test("AGENTS.md refuses every excuse that has been used to stall the chain", () => {
  const { content } = rootAgents();
  for (const [label, fragment] of EXCUSES) {
    assertStringIncludes(content, fragment, `AGENTS.md must refuse the "${label}" excuse`);
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

Deno.test("review, merge and merge-close follow the merge mode instead of always asking", () => {
  const review = phase("review").content;
  assertStringIncludes(
    review,
    "under `auto` (the default) invoke `/task merge` in the same turn",
  );
  const merge = phase("merge").content;
  // The base branch has one home (spec 036); merge.md asks it and never assumes main.
  assertStringIncludes(merge, "bash .specnaut/scripts/bash/base-branch.sh");
  assertStringIncludes(merge, "never assume `main`");
  // D6: merge never asks about the push; D4: it does not read the mode itself.
  // Spec 042: the push runs inside land-feature.sh; the doc still says it is not asked.
  assertStringIncludes(merge, "pushes without asking, in either merge mode");
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
  const content = flat(phase("plan").content);
  assertStringIncludes(content, "the chain's last chance to ask");
  assertStringIncludes(content, "ask here what autopilot would otherwise settle alone");
  // D10: what autopilot would decide alone is named, and discovery needs an acceptance check.
  assertStringIncludes(content, "always: the base branch, anything irreversible or");
  assertStringIncludes(content, "how acceptance is checked");
});

Deno.test("the router parses --manual-merge without making it a chain flag", () => {
  const router = CORE_BUNDLE.find((x) => x.category === "backlog-skill" && x.name === "task");
  if (!router) throw new Error("missing /task router");
  assertStringIncludes(router.content, "[--manual] [--manual-merge] <verb> [rest]");
  assertStringIncludes(router.content, "`--manual` is the only chain flag");
  assertStringIncludes(router.content, "It does not\n   stop the chain anywhere else.");
});

/**
 * The mode has one reader, `.specnaut/scripts/bash/merge-mode.sh` (FR-002):
 * auto-chain.md calls it and the landing hook calls it with `--strict`. The
 * phase doc used to carry its own `sed`; a second parser is how the two
 * askers would come to disagree, so the doc must name the script and carry no
 * parser, and the script must resolve every file shape (D3).
 */
Deno.test("auto-chain.md asks merge-mode.sh, and no template parses `merge:` itself (FR-002)", async () => {
  const content = phase("auto-chain").content;
  assertStringIncludes(content, "bash .specnaut/scripts/bash/merge-mode.sh");
  assert(!content.includes("sed -n"), "auto-chain.md must not carry its own merge-mode parser");
  const templates = new URL("../../templates/", import.meta.url);
  const parsers: string[] = [];
  for await (const e of walk(templates, { includeDirs: false })) {
    if (basename(e.path) === "merge-mode.sh") continue; // `\` on Windows, never `/`
    if ((await Deno.readTextFile(e.path)).includes("^merge:")) parsers.push(e.path);
  }
  assertEquals(parsers, [], "a second `^merge:` parser exists");
});

Deno.test("merge-mode.sh resolves every file shape the chain reads (D3)", async () => {
  const script = fromFileUrl(
    new URL("../../templates/core/specnaut/scripts/bash/merge-mode.sh", import.meta.url),
  );
  const cases: ReadonlyArray<[file: string | null, want: string, note?: string]> = [
    [null, "auto"],
    ["other: 1\n", "auto"],
    ["# merge: manual\n", "auto"],
    ["merge: auto\n", "auto"],
    ["merge: manual\n", "manual"],
    ["merge:manual  # a comment\n", "manual"],
    ["merge: manul\n", "manual", "unrecognised: manul"],
    // Saved on Windows, or checked out with core.autocrlf: the \r is no part of the value.
    ["merge: manual\r\n", "manual"],
    ["merge: auto\r\n", "auto"],
  ];
  for (const [file, want, note] of cases) {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/.specnaut`);
      if (file !== null) await Deno.writeTextFile(`${dir}/.specnaut/workflow.yml`, file);
      const out = await new Deno.Command("bash", { args: [script], cwd: dir }).output();
      const dec = new TextDecoder();
      assertEquals(dec.decode(out.stdout), `${want}\n`, `file: ${JSON.stringify(file)}`);
      if (note) assertStringIncludes(dec.decode(out.stderr), note);
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

/**
 * #630 — technical forks are settled by the expert seats, not put to the user.
 * The rule lives in plan-audits.md ("Who decides"); plan.md, auto-chain.md and
 * the always-loaded AGENTS.md block point at it, and review.md applies it to
 * the fix loop.
 */
Deno.test("technical forks are decided by the expert seats, never asked (#630)", () => {
  // `plan-audits.md` was folded into `plan.md` (spec 041): the rule moved, the lock followed it.
  const plan = flat(phase("plan").content);
  assertStringIncludes(plan, "**Who decides — the seats, not the user.**");
  assertStringIncludes(plan, "**never asked**");
  // The tie-break between seats is stated, in order.
  assertStringIncludes(
    plan,
    "security, then maintainability, then performance, then speed of delivery",
  );
  // A performance seat joins when the plan has a hot path.
  assertStringIncludes(plan, "`performance-expert` too when the change has a hot path");
  assertStringIncludes(plan, "**A technical fork is never a question**");
  assertStringIncludes(plan, "**Nothing open → no stop**");
  assertStringIncludes(plan, "a new external service, vendor or cost");
  // The intent the seats decide against.
  assertStringIncludes(plan, "clean, SOLID, secure by default");

  const chain = flat(phase("auto-chain").content);
  assertStringIncludes(chain, "**only if something only the user can answer is open**");

  const review = phase("review").content;
  assertStringIncludes(review, "Choosing *between* technical fixes is never the user's call");

  const { content: agents } = rootAgents();
  assertStringIncludes(agents, "never put to a vote. Nothing open → no stop.");
  assertStringIncludes(agents, "**long-lived** software — clean, SOLID, secure by default");
});

Deno.test("the plan-time audits run on every plan, and each seat states its own questions", () => {
  // Security audit of spec 041: the slim brief must not make the audit optional, and the
  // questions that left `plan-audits.md` must live where the seat reads them.
  const plan = flat(phase("plan").content);
  assertStringIncludes(plan, "**They run on every plan, brief or full**");
  assertStringIncludes(plan, "`architect-expert` and `security-expert` on `plan.md`");
  const seat = (name: string) => {
    const e = CORE_BUNDLE.find((x) => x.category === "agent" && x.name === name);
    if (!e) throw new Error(`missing agent ${name}`);
    const text = flat(e.content);
    const at = text.indexOf("## Mode 3");
    assert(at >= 0, `${name} has no Mode 3`);
    return text.slice(at);
  };
  const questions: Record<string, string[]> = {
    "architect-expert": [
      "Is the decision table complete?",
      "Is each home the right home?",
      "What is the blast radius?",
      "Do the touched files hold their size?",
      "What would a reviewer find in this design three cycles from now?",
    ],
    "security-expert": [
      "Which new surface accepts input, and where does it stop?",
      "Who is allowed, and where is that decided?",
      "What identifiers and what bytes become reachable?",
      "What does this let an authenticated stranger do to somebody else's account?",
    ],
    "performance-expert": [
      "What grows with the data?",
      "What runs per request, or per item?",
      "What does the plan do at 100× today's set?",
    ],
  };
  for (const [name, qs] of Object.entries(questions)) {
    const mode3 = seat(name);
    assertStringIncludes(mode3, "Spawned by `phases/plan.md`", `${name} names its dispatcher`);
    let from = 0;
    for (const q of qs) {
      const at = mode3.indexOf(q, from);
      assert(at >= 0, `${name} Mode 3 lost, or reordered, "${q}"`);
      from = at;
    }
  }
  assertStringIncludes(seat("security-expert"), "crosses the threshold: <which>");
});
